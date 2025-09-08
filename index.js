import fetch from 'node-fetch';
import { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { createCanvas } from "canvas";
import dotenv from 'dotenv';
import FormData from 'form-data';

dotenv.config();

// Keep everything starting from "ColonisationShip", ignoring leading junk
// Remove everything before and including $EXT_PANEL_ if present, keep the rest
// Clean $EXT_PANEL_ prefix from station names
function cleanStationName(name) {
  if (!name) return "Unknown";
  return name.replace(/^\$EXT_PANEL_/i, '').trim();
}


// 🔍 Helper: Validate EDSM system response
function validateSystem(systemData, systemName, message) {
  if (!systemData || !systemData.name) {
    message.reply(`❌ Sustav **${systemName}** nije pronađen.`);
    return false;
  }
  return true;
}

// Capitalize each word normally
function capitalizeWords(str) {
  return str ? str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : str;
}

// Capitalize all letters
function capitalizeAll(str) {
  return str ? str.split(' ').map(w => w.toUpperCase()).join(' ') : str;
}

// Safe value to string or fallback
const safe = v => v != null ? String(v) : "Unknown";

// Determine simple pad indicator for stations
function simplePads(station) {
  const L = station.padsL || 0;
  const M = station.padsM || 0;
  const S = station.padsS || 0;
  if (L > 0) return "[L]";
  if (L === 0 && M > 0) return "[M]";
  if (L === 0 && M === 0 && S > 0) return "[S]";
  return "";
};


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

  // 🗺️ /factionmap FACTION, RIVAL
  if (content.toLowerCase().startsWith('/factionmap')) {
    const rawParams = content.slice(12).trim();
    const [factionName, rivalName] = rawParams.split(',').map(s => s.trim());

    if (!factionName || !rivalName) {
      return message.reply(
        '⚠️ Unesi (case-sensitive!) nazive fakcije razdvojena zarezom`\n' +
        'Example: `/factionmap B.I.G. - Balkan Intergalactic Guerilla, Enigma Dyson Syndicate`'
      );
    }

    await message.reply(`📝 Generiram analizu za **${factionName}** vs **${rivalName}**... može potrajati ~10s`);

    try {
      // ---------------- FETCH FUNCTIONS ----------------
      async function fetchFactionSystems(name) {
        const res = await fetch(`https://elitebgs.app/api/ebgs/v5/factions?name=${encodeURIComponent(name)}`);
        const data = await res.json();
        if (!data.docs || data.docs.length === 0) throw new Error(`❌ Fakcija "${name}" nije nađena`);
        return data.docs[0].faction_presence.map(p => p.system_name);
      }

      async function fetchAllSystemData(systems) {
        const allDocs = [];
        const systemParams = new URLSearchParams();
        systems.forEach(name => systemParams.append("name", name));

        let currentPage = 1;
        const limit = 10;
        while (true) {
          const params = new URLSearchParams(systemParams.toString());
          params.append("limit", limit);
          params.append("page", currentPage);
          const response = await fetch(`https://elitebgs.app/api/ebgs/v5/systems?${params.toString()}`);
          const data = await response.json();
          allDocs.push(...data.docs);
          if (!data.hasNextPage) break;
          currentPage = data.nextPage;
        }

        return allDocs
          .filter(s => s.controlling_minor_faction)
          .map(s => ({
            name: s.name,
            x: s.x,
            y: s.y,
            z: s.z,
            controllingFaction: s.controlling_minor_faction_cased
          }));
      }

      // ---------------- CONFIG ----------------
      const factions = {
        FACTION: { name: factionName, prefix: "* " },
        RIVAL: { name: rivalName, prefix: "* " }
      };

      const nearbyLimit = 30;

      // ---------------- MAIN ----------------
      const factionSystems = await fetchFactionSystems(factionName);
      const rivalSystems = await fetchFactionSystems(rivalName);
      const factionData = await fetchAllSystemData(factionSystems);
      const rivalData = await fetchAllSystemData(rivalSystems);


      // ---------------- CANVAS SCALE ----------------
      const canvasWidth = 2000;
      const canvasHeight = 2000;
      const dotRadius = 5;
      const labelDistance = 10; // ly minimum distance to other systems to label
      const allCoords = [...factionData, ...rivalData];
      const xs = allCoords.map(s => s.x), zs = allCoords.map(s => s.z);
      const rawMinX = Math.min(...xs), rawMaxX = Math.max(...xs);
      const rawMinZ = Math.min(...zs), rawMaxZ = Math.max(...zs);
      const padX = (rawMaxX - rawMinX) * 0.1;
      const padZ = (rawMaxZ - rawMinZ) * 0.1;
      const minX = rawMinX - padX, maxX = rawMaxX + padX;
      const minZ = rawMinZ - padZ, maxZ = rawMaxZ + padZ;
      const scaleX = canvasWidth / (maxX - minX);
      const scaleZ = canvasHeight / (maxZ - minZ);
      const scale = Math.min(scaleX, scaleZ);
      const offsetX = (canvasWidth - (maxX - minX) * scale) / 2;
      const offsetZ = (canvasHeight - (maxZ - minZ) * scale) / 2;

      // ---------------- CANVAS ----------------
      const canvas = createCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Grid
      const gridInterval = 50;
      for (let xVal = Math.floor(minX / gridInterval) * gridInterval; xVal <= maxX; xVal += gridInterval) {
        const xPos = offsetX + (xVal - minX) * scale;
        ctx.strokeStyle = "#555"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xPos, 0); ctx.lineTo(xPos, canvasHeight); ctx.stroke();
        ctx.fillStyle = "#FFFFFF"; ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(`${xVal}`, xPos, 2);
      }
      for (let zVal = Math.floor(minZ / gridInterval) * gridInterval; zVal <= maxZ; zVal += gridInterval) {
        const zPos = offsetZ + (maxZ - zVal) * scale;
        ctx.strokeStyle = "#555"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, zPos); ctx.lineTo(canvasWidth, zPos); ctx.stroke();
        ctx.fillStyle = "#FFFFFF"; ctx.font = "14px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(`${zVal}`, 2, zPos);
      }

      // Axis lines & Sol
      const solX = offsetX + (0 - minX) * scale;
      const solZ = offsetZ + (maxZ - 0) * scale;
      ctx.strokeStyle = "#8888FF"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(solX, 0); ctx.lineTo(solX, canvasHeight); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, solZ); ctx.lineTo(canvasWidth, solZ); ctx.stroke();

      ctx.beginPath();
      ctx.arc(solX, solZ, dotRadius + 2, 0, Math.PI*2);
      ctx.fillStyle = "#FFFF00";
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("Sol", solX, solZ + dotRadius + 2);

      const allSystems = [...factionData, ...rivalData];

      // ---------------- HELPERS ----------------
      const getSystemColor = (system, type) => {
        if (type === "FACTION") return system.controllingFaction === factions.FACTION.name ? factions.FACTION.colorControlled : factions.FACTION.colorUncontrolled;
        return system.controllingFaction === factions.RIVAL.name ? factions.RIVAL.colorControlled : factions.RIVAL.colorUncontrolled;
      };

      const isNearbyEnemy = (system, enemyData) => enemyData.some(e => Math.sqrt((system.x - e.x)**2 + (system.y - e.y)**2 + (system.z - e.z)**2) <= nearbyLimit);

      // ---------------- DRAW SYSTEMS ----------------
      function drawSystems(data, type) {
        data.forEach(s => {
          const x = offsetX + (s.x - minX) * scale;
          const z = offsetZ + (maxZ - s.z) * scale;
          const color = getSystemColor(s, type);

          ctx.beginPath();
          ctx.arc(x, z, dotRadius, 0, Math.PI*2);
          ctx.fillStyle = color;
          ctx.fill();

          const minDist = allSystems.filter(o => o !== s).map(o => Math.hypot(s.x - o.x, s.y - o.y, s.z - o.z)).reduce((a,b)=>Math.min(a,b), Infinity);
          const nearbyEnemies = type === "FACTION" ? isNearbyEnemy(s, rivalData) : rivalData.filter(r => Math.hypot(s.x - r.x, s.y - r.y, s.z - r.z) <= nearbyLimit).length > 0;

          if (minDist >= labelDistance || nearbyEnemies) {
            ctx.fillStyle = color;
            ctx.font = "10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(s.name, x, z + dotRadius + 2);
          }

          if (nearbyEnemies) {
            ctx.beginPath();
            ctx.arc(x, z, dotRadius + 4, 0, Math.PI*2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        });
      }

      drawSystems(factionData, "FACTION");
      drawSystems(rivalData, "RIVAL");

      // ---------------- LEGEND ----------------
      const legendPadding = 20;
      const circleRadius = 10;
      const lineHeight = 30;
      ctx.font = "18px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const legendItems = [
        { text: `${factions.FACTION.name} controlled`, color: factions.FACTION.colorControlled },
        { text: `${factions.FACTION.name} uncontrolled`, color: factions.FACTION.colorUncontrolled },
        { text: `${factions.RIVAL.name} controlled`, color: factions.RIVAL.colorControlled },
        { text: `${factions.RIVAL.name} uncontrolled`, color: factions.RIVAL.colorUncontrolled },
      ];

      let startX = canvasWidth - 300 - legendPadding;
      let startY = canvasHeight - (legendItems.length * lineHeight) - legendPadding;

      legendItems.forEach((item, i) => {
        const y = startY + i * lineHeight;
        ctx.beginPath();
        ctx.arc(startX + circleRadius, y, circleRadius, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(item.text, startX + circleRadius * 2 + 8, y);
      });
      
      // ---------------- ANALYSIS ----------------
      const factionWithRival = factionData
        .filter(f => rivalData.some(r => r.name === f.name))
        .map(s => s.name);

      const nearbyRivalMap = {};
      rivalData.forEach(rivalSys => {
        if (factionWithRival.includes(rivalSys.name)) return;
        const nearbyFaction = factionData
          .map(f => ({
            name: f.name,
            dist: Math.sqrt(
              (f.x - rivalSys.x) ** 2 +
              (f.y - rivalSys.y) ** 2 +
              (f.z - rivalSys.z) ** 2
            )
          }))
          .filter(f => f.dist <= nearbyLimit)
          .sort((a, b) => a.dist - b.dist);

        if (nearbyFaction.length > 0) {
          nearbyRivalMap[rivalSys.name] = nearbyFaction;
        }
      });

      const fields = [];

      function formatSystemListLimited(systems, maxChars = 1000) {
        if (!systems || systems.length === 0) return "* No systems";
        let text = "", count = 0;
        for (const s of systems) {
          const line = `${s}\n`;
          if (text.length + line.length > maxChars) break;
          text += line;
          count++;
        }
        const remaining = systems.length - count;
        if (remaining > 0) text += `... ${remaining} more`;
        return text;
      }

      const nearbyLines = Object.entries(nearbyRivalMap).map(([rName, nearby]) => {
        let text = `**${rName}**\n`;
        const first = nearby[0];
        text += `${factions.RIVAL.prefix}${first.name} - **${first.dist.toFixed(1)} ly**\n`;
        if (nearby.length > 1) {
          text += `${factions.RIVAL.prefix}... ${nearby.length - 1} more`;
        }
        return text;
      });

      fields.push({
        name: `${factions.FACTION.name} system(s) ≤${nearbyLimit} ly to ${factions.RIVAL.name}'s:`,
        value: nearbyLines.length > 0 ? formatSystemListLimited(nearbyLines, 1000) : "* No systems",
        inline: false
      });

      fields.push({
        name: `${factions.FACTION.name}-controlled systems with ${factions.RIVAL.name} present:`,
        value: factionWithRival.length > 0 ? formatSystemListLimited(factionWithRival.map(s => `${factions.FACTION.prefix}${s}`)) : "* No systems",
        inline: false
      });


      // Build the embed
      const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'BIG_map.png' });

      const embed = new EmbedBuilder()
        .setTitle(`${factions.FACTION.name} vs ${factions.RIVAL.name} map`)
        .setColor(0xFFA500)
        .addFields(fields)
        .setImage('attachment://BIG_map.png')
        .setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.0` })
        .setTimestamp();

      // Send directly via Discord.js
      await message.reply({ embeds: [embed], files: [attachment] });



    } catch (err) {
      console.error(err);
      return message.reply(`❌ Error: ${err.message}`);
    }
  }


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

  if (!data || !data.traffic) {
    return message.reply(`❌ Sustav **${systemName}** nije pronađen ili nema podataka o prometu.`);
  }


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
        .setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.0` });

      message.reply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      message.reply('⚠️ Greška pri dohvaćanju podataka s EDSM-a.');
    }

    return;
  }

  // 🌌 /system command
if (content.toLowerCase().startsWith('/system')) {
  const parts = content.trim().split(/\s+/);
  const systemName = parts.slice(1).join(' '); // everything after /system

  if (!systemName) {
    return message.reply('⚠️ Unesi naziv sustava. Primjer: `/system Grudi`');
  }

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

    if (!validateSystem(systemData, systemName, message)) return;


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
          { name: "🆔 ID", value: `${systemInfo.id}`, inline: true },
          { name: "🏛️ Government", value: systemInfo.government, inline: true },
          { name: "⚖️ Allegiance", value: systemInfo.allegiance, inline: true },
          { name: "🔒 Security", value: systemInfo.security, inline: true },
          { name: "👥 Population", value: `${typeof systemInfo.population === 'number' ? systemInfo.population.toLocaleString() : systemInfo.population}`, inline: true },
          { name: "💰 Economy", value: economyText, inline: true },
          { name: "Factions", value: factionText, inline: false }
        ],
        footer: { text: `Zatražio/la: ${message.author.tag} | v1.3.0` },
        timestamp: new Date()
      };

      message.reply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      message.reply('❌ Greška pri dohvaćanju podataka o sustavu ili frakcijama.');
    }

    return;
  }

// 🌌 /xsystem command (EDAstro + EDSM full)
if (content.toLowerCase().startsWith('/xsystem')) {

  const parts = content.trim().split(/\s+/);
  const systemName = parts.slice(1).join(' '); // everything after /xsystem

  if (!systemName) {
    return message.reply('⚠️ Unesi naziv sustava. Primjer: `/xsystem Grudi`');
  }

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


    const systemData = await systemRes.json() || {};

  if (!validateSystem(systemData, systemName, message)) return;

    const factionData = await factionRes.json() || {};
    let edastroData = await edastroRes.json() || {};
    if (Array.isArray(edastroData)) edastroData = edastroData[0] || {};
    const astro = edastroData || {};



    // === EDSM Info ===
    const systemInfo = {
      id: systemData.id ?? 'Unknown',
      government: systemData.government ?? systemData.information?.government ?? 'Unknown',
      allegiance: systemData.allegiance ?? systemData.information?.allegiance ?? 'Unknown',
      security: systemData.security ?? systemData.information?.security ?? 'Unknown',
      population: systemData.population ?? systemData.information?.population ?? 'Unknown',
      economy: systemData.information?.economy ?? 'Unknown',
      secondEconomy: systemData.information?.secondEconomy ?? null
    };

    // === Star & Planet Data ===
    const stars = astro.stars || [];
    const mainStar = astro.stars?.[0]?.subType ?? "Unknown";
    const planets = astro.planets || [];
    const numPlanets = planets.length;
    const numELW = planets.filter(p => p.subType?.toLowerCase().includes('earth-like world')).length;
    const numWW = planets.filter(p => p.subType?.toLowerCase().includes('water world')).length;
    const numGasGiants = planets.filter(p => p.subType?.toLowerCase().includes('gas giant')).length;
    const distanceFromSol = astro.sol_dist != null ? astro.sol_dist.toFixed(2) : 'Unknown';

// === Rings ===
const starRings = astro.stars?.flatMap(s => [...(s.rings || []), ...(s.belts || [])]) || [];
const planetRings = planets.flatMap(p => p.rings || []);
const allRings = [...starRings, ...planetRings];
const ringsText = allRings.length
  ? allRings.map(r => `* ${r.name} (${r.type})`).join('\n')
  : "None";

// === Starports ===
const stations = astro.stations || [];
const starports = stations
  .filter(s => {
    const type = (s.type || '').toLowerCase();
    return ['coriolis','orbis','ocellus','starport','outpost'].some(t => type.includes(t));
  })
  .sort((a, b) => {
    const distA = a.distanceToArrival ?? Infinity;
    const distB = b.distanceToArrival ?? Infinity;
    return distA - distB;
  });

const starportText = starports.length
  ? starports.map(s => {
      const pads = simplePads(s);
      // Only show [PLANET bodyName] if type is exactly "Planetary Outpost"
      const planetInfo = s.type === "Planetary Outpost" && s.bodyName ? `[PLANETARY, ${s.bodyName}]` : '';
      const dist = s.distanceToArrival != null ? Math.round(s.distanceToArrival) + " ls" : "Unknown";
      const cleanedName = cleanStationName(s.name); 
      // Conditionally add a space before planetInfo
      return `* ${cleanedName} ${pads}${planetInfo ? ' ' + planetInfo : ''} - *${dist}*`;
    }).join('\n')
  : "Nema orbitalnih ili planetarnih starporta";


    // === Odyssey Settlements ===
    const odysseySettlements = stations.filter(s => (s.type || '').toLowerCase().includes('odyssey'));
    const totalOdy = odysseySettlements.length;

let odysseyText = "Nema settlementa";
if (totalOdy > 0) {
  // Count number of settlements with L and M pads
  const countL = odysseySettlements.filter(s => (s.padsL || 0) > 0).length;
  const countM = odysseySettlements.filter(s => (s.padsM || 0) > 0).length;
  odysseyText = `* Settlementi s L pad: ${countL}\n* Settlementi samo s M pad: ${countM}`;
}

// === Carriers ===
const carriers = astro.carriers || [];
const carrierText = carriers.length
  ? (() => {
      const maxDisplay = 10;
      const displayed = carriers.slice(0, maxDisplay).map(c => {
        const isSquadron = c.callsign && c.callsign.length === 4;
        const docking = !isSquadron
          ? (c.dockingAccess === 'squadronfriends' ? 'Squadron and Friends' : safe(c.dockingAccess))
          : '';
        const carrierLabel = isSquadron
          ? `*  **Squadron Carrier** [${c.callsign}]`
          : `*  ${capitalizeAll(c.name ?? 'Unnamed')} [${c.callsign}]`;
      //  return docking ? `${carrierLabel}\nDocking: ${docking}` : carrierLabel;
      return docking ? `${carrierLabel}` : carrierLabel;
      });
      if (carriers.length > maxDisplay) {
        displayed.push(`* ...${carriers.length - maxDisplay} more`);
      }
      return displayed.join('\n');
    })()
  : "Nema carriera";

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

    // === Build Embed ===
    const embed = new EmbedBuilder()
      .setTitle(`🌌 System ${systemData.name || systemName}`)
      .setURL(systemData.url)
      .setColor(0x00bfff)
      .addFields(
        { name: "🆔 System ID", value: `${systemInfo.id}`, inline: true },
        { name: "🏛️ Government", value: systemInfo.government, inline: true },
        { name: "⚖️ Allegiance", value: systemInfo.allegiance, inline: true },
        { name: "🔒 Security", value: systemInfo.security, inline: true },
        { name: "👥 Population", value: `${typeof systemInfo.population === 'number' ? systemInfo.population.toLocaleString() : systemInfo.population}`, inline: true },
        { name: "💰 Economy", value: systemInfo.secondEconomy ? `${systemInfo.economy} / ${systemInfo.secondEconomy}` : systemInfo.economy, inline: true },
        { name: "⭐ Main Star", value: mainStar, inline: true },
        { name: "📏 Distance from Sol", value: `${distanceFromSol} ly`, inline: true },
        { name: "🌕 Planets", value: `${numPlanets}`, inline: true },
        { name: "🌍 ELWs", value: `${numELW}`, inline: true },
        { name: "🔵 Water Worlds", value: `${numWW}`, inline: true },
        { name: "⚪ Gas Giants", value: `${numGasGiants}`, inline: true },
        { name: "🪐 Rings", value: ringsText, inline: false },
        { name: "🏢 Starports", value: starportText, inline: false },
  { name: `🏠 Odyssey Settlements (Total: ${totalOdy})`, value: odysseyText, inline: false },
        { name: `🛰️ Carriers (Total: ${carriers.length})`, value: carrierText, inline: false },
        { name: "Factions", value: factionText, inline: false }
      )
      .setFooter({ text: `Zatražio/la: ${message.author.tag} | EDSM+EDASTRO | v1.3.0` })
      .setTimestamp();

    message.reply({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    message.reply('❌ Greška pri dohvaćanju podataka o sustavu ili frakcijama.');
  }
}


});


client.login(process.env.DISCORD_BOT_TOKEN);












