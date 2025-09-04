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

client.once('ready', () => {
  console.log(`✅ Prijavljen kao ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // 🚀 /traffic command
  if (content.toLowerCase().startsWith('/traffic')) {
    const parts = content.split(/\s+/);
    const systemName = parts.slice(1).join(' ');

    if (!systemName) {
      return message.reply('⚠️ Unesi naziv sustava. Primjer: `/traffic Sol`');
    }

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
        .setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.2` })
        .setTimestamp();

      message.reply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      message.reply('❌ Nije moguće dohvatiti podatke s EDSM-a.');
    }

    return;
  }

  // 📏 /distance command
  if (content.toLowerCase().startsWith('/distance')) {
    const rawParams = content.slice(9).trim();
    const [system1, system2] = rawParams.split(',').map(s => s.trim());

    if (!system1 || !system2) {
      return message.reply('⚠️ Unesi **dva sustava odvojena zarezom**. Primjer: `/distance Sol, Alpha Centauri`');
    }

    const fetchCoords = async (name) => {
      const url = `https://www.edsm.net/api-v1/system?systemName=${encodeURIComponent(name)}&showCoordinates=1`;
      const res = await fetch(url);
      const json = await res.json();
      console.log(`Coords response for "${name}":`, json);

      if (json.error) return null;
      return json.coords || null;
    };

    try {
      const [coords1, coords2] = await Promise.all([
        fetchCoords(system1),
        fetchCoords(system2)
      ]);

      if (!coords1 || !coords2) {
        return message.reply('❌ Koordinate za jedan ili oba sustava nisu pronađene.');
      }

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
        .setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.2` });

      message.reply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      message.reply('⚠️ Greška pri dohvaćanju podataka s EDSM-a.');
    }

    return;
  }

  // 🌌 /system command
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
      const economyText = systemInfo.secondEconomy 
        ? `${systemInfo.economy} / ${systemInfo.secondEconomy}` 
        : systemInfo.economy;

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

      const embed = {
        title: `🌌 Informacije o sustavu: ${systemData.name}`,
        url: systemData.url,
        color: 0x00bfff,
        fields: [
          { name: "🆔 ID sustava", value: `${systemInfo.id}`, inline: true },
          { name: "🏛️ Vlada", value: systemInfo.government, inline: true },
          { name: "⚖️ Pripadnost", value: systemInfo.allegiance, inline: true },
          { name: "🔒 Sigurnost", value: systemInfo.security, inline: true },
          { name: "👥 Populacija", value: `${typeof systemInfo.population === 'number' ? systemInfo.population.toLocaleString() : systemInfo.population}`, inline: true },
          { name: "💰 Ekonomija", value: economyText, inline: true },
          { name: "🛡️ Frakcije i utjecaj", value: factionText, inline: false }
        ],
        footer: { text: `v1.3.2` },
        timestamp: new Date()
      };

      message.reply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      message.reply('❌ Greška pri dohvaćanju podataka o sustavu ili frakcijama.');
    }

    return;
  }

});

client.login(process.env.DISCORD_BOT_TOKEN);
