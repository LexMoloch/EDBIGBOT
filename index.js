import fetch from 'node-fetch';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// === Helpers ===
function capitalizeWords(str) {
  return str ? str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : str;
}
function capitalizeAll(str) {
  return str ? str.split(' ').map(w => w.toUpperCase()).join(' ') : str;
}
const safe = v => v ? String(v) : "Unknown";
function simplePads(station) {
  const L = station.padsL || 0;
  const M = station.padsM || 0;
  const S = station.padsS || 0;
  if (L > 0) return "[L]";
  if (L === 0 && M > 0) return "[M]";
  if (L === 0 && M === 0 && S > 0) return "[S]";
  return "";
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();

  // === /traffic command ===
  if (content.toLowerCase().startsWith('/traffic')) {
    const parts = content.split(/\s+/);
    const systemName = parts.slice(1).join(' ');

    if (!systemName) return message.reply('⚠️ Unesi naziv sustava. Primjer: `/traffic Sol`');

    const encodedName = encodeURIComponent(systemName);
    const edsmUrl = `https://www.edsm.net/api-system-v1/traffic?systemName=${encodedName}`;
    const systemUrl = `https://www.edsm.net/en/system?systemName=${encodedName}`;

    try {
      const res = await fetch(edsmUrl);
      const data = await res.json();
      const t = data.traffic;

      const breakdown = data.breakdown || {};
      const breakdownText = Object.entries(breakdown)
        .map(([ship, count]) => `• ${ship}: ${count}`)
        .join('\n') || "Nema podataka";

      const embed = new EmbedBuilder()
        .setTitle(`🚀 Izvještaj o prometu u sustavu ${systemName}`)
        .setURL(systemUrl)
        .setColor(0x00bfff)
        .setDescription(`Aktivnost brodova za **${systemName}**:`)
        .addFields(
          { name: "🌌 Ukupno", value: `${(t?.total ?? 0).toLocaleString('hr-HR')}`, inline: true },
          { name: "🗓️ Zadnjih 7 dana", value: `${(t?.week ?? 0).toLocaleString('hr-HR')}`, inline: true },
          { name: "📅 Zadnjih 24 sata", value: `${(t?.day ?? 0).toLocaleString('hr-HR')}`, inline: true },
          { name: "Brodovi zadnjih 24 sata", value: breakdownText, inline: false }
        )
        .setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.0` })
        .setTimestamp();

      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply('❌ Nije moguće dohvatiti podatke s EDSM-a.');
    }

    return;
  }

  // === /distance command ===
  if (content.toLowerCase().startsWith('/distance')) {
    const rawParams = content.slice(9).trim();
    const [system1, system2] = rawParams.split(',').map(s => s.trim());

    if (!system1 || !system2) return message.reply('⚠️ Unesi **dva sustava odvojena zarezom**. Primjer: `/distance Sol, Alpha Centauri`');

    const fetchCoords = async (name) => {
      const url = `https://www.edsm.net/api-v1/system?systemName=${encodeURIComponent(name)}&showCoordinates=1`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) return null;
      return json.coords || null;
    };

    try {
      const [coords1, coords2] = await Promise.all([
        fetchCoords(system1),
        fetchCoords(system2)
      ]);

      if (!coords1 || !coords2) return message.reply('❌ Koordinate za jedan ili oba sustava nisu pronađene.');

      const distance = Math.sqrt(
        Math.pow(coords1.x - coords2.x, 2) +
        Math.pow(coords1.y - coords2.y, 2) +
        Math.pow(coords1.z - coords2.z, 2)
      ).toFixed(2);

      const embed = new EmbedBuilder()
        .setTitle('📏 Udaljenost između sustava')
        .setDescription(`🔹 **${system1}** ↔️ **${system2}**\n📐 ${distance} Ly`)
        .setColor(0x00bfff)
        .setTimestamp()
        .setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.0` });

      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply('⚠️ Greška pri dohvaćanju podataka s EDSM-a.');
    }

    return;
  }

  // === /system command (EDSM basic info) ===
  if (content.toLowerCase().startsWith('/system')) {
    const systemName = content.slice(7).trim();
    if (!systemName) return message.reply('⚠️ Unesi naziv sustava. Primjer: `/system Wazn`');

    const encodedName = encodeURIComponent(systemName);
    const EDSM_SYSTEM_URL = `https://www.edsm.net/api-v1/system?systemName=${encodedName}&showInformation=1&showId=1&showPrimaryStar=1`;
    const EDSM_FACTIONS_URL = `https://www.edsm.net/api-system-v1/factions?systemName=${encodedName}`;

    try {
      const [systemRes, factionRes] = await Promise.all([
        fetch(EDSM_SYSTEM_URL),
        fetch(EDSM_FACTIONS_URL)
      ]);

      const systemData = await systemRes.json();
      const factionData = await factionRes.json();

      const systemInfo = {
        id: systemData.id ?? 'Nepoznato',
        government: systemData.government ?? systemData.information?.government ?? 'Nepoznato',
        allegiance: systemData.allegiance ?? systemData.information?.allegiance ?? 'Nepoznato',
        security: systemData.security ?? systemData.information?.security ?? 'Nepoznato',
        population: systemData.population ?? systemData.information?.population ?? 'Nepoznato',
        economy: systemData.information?.economy ?? 'Nepoznato',
        secondEconomy: systemData.information?.secondEconomy ?? null
      };
      const economyText = systemInfo.secondEconomy ? `${systemInfo.economy} / ${systemInfo.secondEconomy}` : systemInfo.economy;

      const factions = factionData.factions || [];
      const controllingFactionId = factionData.controllingFaction?.id;
      const factionText = factions
        .filter(f => f.influence > 0)
        .map(f => {
          const infPercent = (f.influence * 100).toFixed(2);
          const activeStates = f.activeStates?.map(s => s.state).join(', ');
          let prefix = "";
          if (f.id === controllingFactionId) prefix += "👑 ";
          if (f.isPlayer) prefix += "👥 ";
          return activeStates ? `• ${prefix}${f.name}: ${infPercent}% | ${activeStates}` : `• ${prefix}${f.name}: ${infPercent}%`;
        })
        .join('\n') || "Nema podataka o frakcijama";

      const embed = new EmbedBuilder()
        .setTitle(`🌌 Informacije o sustavu: ${systemData.name}`)
        .setURL(systemData.url)
        .setColor(0x00bfff)
        .addFields(
          { name: "🆔 ID", value: `${systemInfo.id}`, inline: true },
          { name: "🏛️ Goverment", value: systemInfo.government, inline: true },
          { name: "⚖️ Allegiance", value: systemInfo.allegiance, inline: true },
          { name: "🔒 Security", value: systemInfo.security, inline: true },
          { name: "👥 Population", value: `${typeof systemInfo.population === 'number' ? systemInfo.population.toLocaleString() : systemInfo.population}`, inline: true },
          { name: "💰 Economy", value: economyText, inline: true },
          { name: "Factions", value: factionText, inline: false }
        )
        .setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.0` })
        .setTimestamp();

      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply('❌ Greška pri dohvaćanju podataka o sustavu ili frakcijama.');
    }

    return;
  }

  // === /systemx command (EDAstro + EDSM full) ===
  if (content.toLowerCase().startsWith('/systemx')) {
    const systemName = content.slice(8).trim();
    if (!systemName) return message.reply('⚠️ Unesi naziv sustava. Primjer: `/systemx Wazn`');

    const encodedName = encodeURIComponent(systemName);
    const EDSM_SYSTEM_URL = `https://www.edsm.net/api-v1/system?systemName=${encodedName}&showInformation=1&showId=1&showPrimaryStar=1`;
    const EDSM_FACTIONS_URL = `https://www.edsm.net/api-system-v1/factions?systemName=${encodedName}`;
    const EDASTRO_URL = `https://edastro.com/api/starsystem?q=${encodedName}`;

    try {
      const [systemRes, factionRes, edastroRes] = await Promise.all([
        fetch(EDSM_SYSTEM_URL),
        fetch(EDSM_FACTIONS_URL),
        fetch(EDASTRO_URL)
      ]);

      const systemData = await systemRes.json();
      const factionData = await factionRes.json();
      const edastroData = await edastroRes.json();
      const astro = Array.isArray(edastroData) ? edastroData[0] : edastroData;

      // === EDSM Info ===
      const systemInfo = {
        id: systemData.id ?? 'Nepoznato',
        government: systemData.government ?? systemData.information?.government ?? 'Nepoznato',
        allegiance: systemData.allegiance ?? systemData.information?.allegiance ?? 'Nepoznato',
        security: systemData.security ?? systemData.information?.security ?? 'Nepoznato',
        population: systemData.population ?? systemData.information?.population ?? 'Nepoznato',
        economy: systemData.information?.economy ?? 'Nepoznato',
        secondEconomy: systemData.information?.secondEconomy ?? null
      };
      const economyText = systemInfo.secondEconomy 
        ? `${systemInfo.economy} / ${systemInfo.secondEconomy}` 
        : systemInfo.economy;

      // === Star & Planet info ===
      const mainStar = astro.stars?.[0]?.type ?? "Unknown";
      const distanceFromSol = astro.distanceFromSol ? astro.distanceFromSol.toFixed(2) : "Unknown";
      const planets = astro.planets || [];
      const numPlanets = planets.length;
      const numELW = planets.filter(p => p.type === "Earth-like world").length;
      const numWW = planets.filter(p => p.type === "Water world").length;
      const numGasGiants = planets.filter(p => p.subType?.toLowerCase().includes("gas giant")).length;

      // === Rings ===
      let ringsText = "None";
      if (astro.stars?.length) {
        const starRings = astro.stars.flatMap(s => s.belts || s.rings || []);
        if (starRings.length > 0) {
          ringsText = starRings.map(r => `* ${r.name} (${r.type})`).join("\n");
        }
      }

      // === Starports ===
      const stations = astro.stations || [];
      const starports = stations.filter(s => {
        const type = s.type?.toLowerCase() || "";
        return type.includes("coriolis") || type.includes("orbis") || type.includes("ocellus") || type.includes("starport") || type.includes("outpost");
      });
      const starportText = starports.length
        ? starports.map(s => `* ${safe(s.name)} ${simplePads(s)}`).join("\n")
        : "None";

      // === Odyssey Settlements ===
      const odysseySettlements = stations.filter(s => s.type?.toLowerCase() === "odysseysettlement");
      const totalOdyssey = odysseySettlements.length;
      const hasL = odysseySettlements.some(s => s.padsL > 0) ? "✅" : "❌";
      const hasM = odysseySettlements.some(s => s.padsM > 0) ? "✅" : "❌";
      const odysseyText = `**Odyssey Settlements:** ${totalOdyssey} [L${hasL} M${hasM}]`;

      // === Carriers ===
      const carriers = astro.carriers || [];
      const carrierText = carriers.length
        ? carriers.map(c => {
            const isSquadron = c.callsign && c.callsign.length === 4;
            const docking = !isSquadron
              ? (c.dockingAccess === "squadronfriends" ? "Squadron and Friends" : safe(c.dockingAccess))
              : "";

            const carrierLabel = isSquadron
              ? `* **Squadron Carrier** [${c.callsign}]`
              : `* **${capitalizeAll(c.name ?? "Unnamed")}** [${c.callsign}]`;

            return isSquadron
              ? `${carrierLabel}${docking ? `\nDocking: ${docking}` : ""}`
              : `${carrierLabel}${docking ? `\nDocking: ${docking}` : ""}`;
          }).join("\n")
        : "None";

      // === Factions ===
      const factions = factionData.factions || [];
      const controllingFactionId = factionData.controllingFaction?.id;
      const factionText = factions
        .filter(f => f.influence > 0)
        .map(f => {
          const infPercent = (f.influence * 100).toFixed(2);
          const activeStates = f.activeStates?.map(s => s.state).join(', ');
          let prefix = "";
          if (f.id === controllingFactionId) prefix += "👑 ";
          if (f.isPlayer) prefix += "👥 ";
          return activeStates 
            ? `• ${prefix}${f.name}: ${infPercent}% | ${activeStates}`
            : `• ${prefix}${f.name}: ${infPercent}%`;
        })
        .join('\n') || "Nema podataka o frakcijama";

      // === Build embed ===
      const embed = new EmbedBuilder()
        .setTitle(`🌌 Informacije o sustavu: ${systemData.name}`)
        .setURL(systemData.url)
        .setColor(0x00bfff)
        .addFields(
          { name: "🆔 ID", value: `${systemInfo.id}`, inline: true },
          { name: "🏛️ Government", value: systemInfo.government, inline: true },
          { name: "⚖️ Allegiance", value: systemInfo.allegiance, inline: true },
          { name: "🔒 Security", value: systemInfo.security, inline: true },
          { name: "👥 Population", value: `${typeof systemInfo.population === 'number' ? systemInfo.population.toLocaleString() : systemInfo.population}`, inline: true },
          { name: "💰 Economy", value: economyText, inline: true },

          { name: "⭐ Main Star", value: mainStar, inline: true },
          { name: "🛰️ Distance from Sol", value: `${distanceFromSol} ly`, inline: true },
          { name: "🪐 Planets", value: `${numPlanets}`, inline: true },
          { name: "🌍 ELWs", value: `${numELW}`, inline: true },
          { name: "💧 Water Worlds", value: `${numWW}`, inline: true },
          { name: "📊 Gas Giants", value: `${numGasGiants}`, inline: true },

          { name: "💫 Rings", value: ringsText, inline: false },
          { name: "🏛️ Starports", value: starportText, inline: false },
          { name: odysseyText, value: "\u200B", inline: false },
          { name: `🛰️ Carriers (Total: ${carriers.length})`, value: carrierText, inline: false },
          { name: "Frakcije", value: factionText, inline: false }
        )
        .setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.0` })
        .setTimestamp();

      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply('❌ Greška pri dohvaćanju podataka o sustavu, frakcijama ili EDAstro.');
    }

    return;
  }

});

client.login(process.env.DISCORD_BOT_TOKEN);
