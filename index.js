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

// Spansh system search
async function fetchSpanshSystem(systemName) {
const res = await fetch(`https://spansh.co.uk/api/systems/search/`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
filters: { name: { value: [systemName] } },
page: 0,
size: 1
})
});

if (!res.ok) throw new Error(`Spansh fetch error: ${res.status}`);
const data = await res.json();
console.log('Spansh search response:', data); // <-- then use it

if (!data.results || data.results.length === 0 || data.count === 0) {
throw new Error(`❌ Spansh nije našao sustav: ${systemName}. Upit je case-sensitive - provjeri je li naziv u potpunosti točan (velika/mala slova, razmaci...).`);
}

return data.results[0];
}


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
'Primjer: `/factionmap B.I.G. - Balkan Intergalactic Guerilla, Enigma Dyson Syndicate`'
);
}

const loadingMsg = await message.reply(`📝 Generiram analizu za **${factionName}** vs **${rivalName}**... može potrajati ~10s`);

try {
// ---------------- FETCH FUNCTIONS ----------------

// Spansh search for systems where the faction is present
async function fetchFactionSystems(name) {
const url = "https://spansh.co.uk/api/systems/search/";
let allSystems = [];
let page = 0;
const size = 50; // batch size

while (true) {
const body = {
filters: {
minor_faction_presences: { value: [name] }
},
page,
size
};

const res = await fetch(url, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(body)
});

if (!res.ok) throw new Error(`Spansh search error: ${res.status}`);

const data = await res.json();
if (!data.results || data.results.length === 0) break;

allSystems = allSystems.concat(data.results);

if (data.results.length < size) break; // last page
page++;
}

return allSystems.map(s => s.name);
}

// Fetch system data from Spansh (instead of EliteBGS) and include coordinates + controlling faction
async function fetchAllSystemData(systems) {
const allDocs = [];
const size = 50; // batch size

for (let i = 0; i < systems.length; i += size) {
const batch = systems.slice(i, i + size);
let page = 0;

while (true) {
const body = {
filters: {
name: { value: batch }
},
size,
page
};

const res = await fetch("https://spansh.co.uk/api/systems/search/", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(body)
});

if (!res.ok) throw new Error(`Spansh fetch error: ${res.status}`);
const data = await res.json();
if (!data.results || data.results.length === 0) break;

// Map relevant info
allDocs.push(
...data.results.map(s => ({
name: s.name,
x: s.x,
y: s.y,
z: s.z,
controllingFaction: s.controlling_minor_faction || ""
}))
);

if (data.results.length < size) break;
page++;
}
}

return allDocs;
}


// ---------------- CONFIG ----------------
// ---------------- SYSTEM LABELS & COLORS ----------------
const factions = {
FACTION: {
name: factionName,
colorControlled: "#7CFC00",    // LawnGreen – bright but readable
colorUncontrolled: "#228B22",  // ForestGreen – darker, readable
prefix: "* "
},
RIVAL: {
name: rivalName,
colorControlled: "#FF6347",    // Tomato – bright red-orange
colorUncontrolled: "#B22222",  // DarkRed – darker, readable
prefix: "* "
}
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
const dotRadius = 2;
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
// mapping helpers
const mapX = x => offsetX + (x - minX) * scale;
const mapZ = z => offsetZ + (maxZ - z) * scale;

// grid interval in LY
const gridInterval = 50;

// compute galaxy coords at canvas edges (exact)
const leftX  = minX + (0 - offsetX) / scale;                    // at pixel x=0
const rightX = minX + (canvasWidth - offsetX) / scale;         // at pixel x=canvasWidth
const topZ   = maxZ - (0 - offsetZ) / scale;                   // at pixel y=0  => maxZ + offsetZ/scale
const bottomZ= maxZ - (canvasHeight - offsetZ) / scale;        // at pixel y=canvasHeight

// make sure values are finite
const L = Number.isFinite(leftX) ? leftX : minX;
const R = Number.isFinite(rightX) ? rightX : maxX;
const T = Number.isFinite(topZ) ? topZ : maxZ;
const B = Number.isFinite(bottomZ) ? bottomZ : minZ;

// round start/end to grid multiples
const startXVal = Math.floor(L / gridInterval) * gridInterval;
const endXVal   = Math.ceil(R  / gridInterval) * gridInterval;
const startZVal = Math.floor(B / gridInterval) * gridInterval;
const endZVal   = Math.ceil(T  / gridInterval) * gridInterval;

// draw vertical grid lines (X)
for (let xVal = startXVal; xVal <= endXVal; xVal += gridInterval) {
const xPos = mapX(xVal);
// skip lines that map off-canvas (tiny tolerance)
if (!Number.isFinite(xPos) || xPos < -10 || xPos > canvasWidth + 10) continue;

ctx.strokeStyle = "#555";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(xPos, 0);
ctx.lineTo(xPos, canvasHeight);
ctx.stroke();

ctx.fillStyle = "#FFFFFF";
ctx.font = "14px sans-serif";
ctx.textAlign = "center";
ctx.textBaseline = "top";
ctx.fillText(`${xVal}`, xPos, 2);
}

// draw horizontal grid lines (Z)
for (let zVal = startZVal; zVal <= endZVal; zVal += gridInterval) {
const zPos = mapZ(zVal);
if (!Number.isFinite(zPos) || zPos < -10 || zPos > canvasHeight + 10) continue;

ctx.strokeStyle = "#555";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(0, zPos);
ctx.lineTo(canvasWidth, zPos);
ctx.stroke();

ctx.fillStyle = "#FFFFFF";
ctx.font = "14px sans-serif";
ctx.textAlign = "left";
ctx.textBaseline = "middle";
ctx.fillText(`${zVal}`, 6, zPos);
}

// draw a faint border so the canvas edges are obvious
ctx.strokeStyle = "#333";
ctx.lineWidth = 4;
ctx.strokeRect(0.5, 0.5, canvasWidth - 1, canvasHeight - 1);

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

// Draw system dot
ctx.beginPath();
ctx.arc(x, z, dotRadius, 0, Math.PI * 2);
ctx.fillStyle = color;
ctx.fill();

// Compute distance to nearest other system for labeling
const minDist = allSystems
.filter(o => o !== s)
.map(o => Math.hypot(s.x - o.x, s.y - o.y, s.z - o.z))
.reduce((a, b) => Math.min(a, b), Infinity);

// Draw label if far enough from others
if (minDist >= labelDistance) {
ctx.fillStyle = color;
ctx.font = "10px sans-serif";
ctx.textAlign = "center";
ctx.textBaseline = "top";
ctx.fillText(s.name, x, z + dotRadius + 2);
}

// Circle rival systems: controlled by rival AND near any faction system
if (
type === "RIVAL" &&
s.controllingFaction === factions.RIVAL.name &&
isNearbyEnemy(s, factionData)
) {
ctx.beginPath();
ctx.arc(x, z, dotRadius + 4, 0, Math.PI * 2);
ctx.strokeStyle = color;
ctx.lineWidth = 1.5;
ctx.stroke();
}

// Circle faction systems: near any rival-controlled system
if (
type === "FACTION" &&
isNearbyEnemy(s, rivalData.filter(r => r.controllingFaction === factions.RIVAL.name))
) {
ctx.beginPath();
ctx.arc(x, z, dotRadius + 4, 0, Math.PI * 2);
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
const  lineHeight = 30;
ctx.font = "18px sans-serif";
ctx.textAlign = "left";
ctx.textBaseline = "middle";

// Legend items
const legendItems = [
{ text: `${factions.FACTION.name} controlled`, color: factions.FACTION.colorControlled },
{ text: `${factions.FACTION.name} uncontrolled`, color: factions.FACTION.colorUncontrolled },
{ text: `${factions.RIVAL.name} controlled`, color: factions.RIVAL.colorControlled },
{ text: `${factions.RIVAL.name} uncontrolled`, color: factions.RIVAL.colorUncontrolled },
];

// Place legend on left, accounting for Z labels
// (shift right ~50px so it doesn’t overlap Z axis numbers)
const axisLabelOffset = 50;
let startX = legendPadding + axisLabelOffset;
let startY = canvasHeight - (legendItems.length * lineHeight) - legendPadding;

// Draw legend
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

const factionWithRivalControlled = factionData
.filter(f =>
f.controllingFaction === factions.FACTION.name && // ✅ your faction controls
rivalData.some(r => r.name === f.name)            // ✅ rival is present
)
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
text += `${factions.RIVAL.prefix}... ${nearby.length - 1} more\n`;
}
return text;
});

fields.push({
name: `${factions.FACTION.name} sustav(i) unutar ${nearbyLimit} ly od ${factions.RIVAL.name} CONTROL sustava:`,
value: nearbyLines.length > 0 ? formatSystemListLimited(nearbyLines, 1000) : "* Nema sustava",
inline: false
});

fields.push({
name: `${factions.FACTION.name} CONTROL sustavi u kojima je prisutan ${factions.RIVAL.name}:`,
value: factionWithRivalControlled.length > 0
? formatSystemListLimited(factionWithRivalControlled.map(s => `${factions.FACTION.prefix}${s}`))
: "* Nema sustava",
inline: false
});


// Build the embed
const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'BIG_map.png' });

const embed = new EmbedBuilder()
.setTitle(`🗺️ ${factions.FACTION.name} vs ${factions.RIVAL.name} map`)
.setColor(0xFFA500)
.addFields(fields)
.setImage('attachment://BIG_map.png')
.setFooter({ text: `Zatražio/la: ${message.author.tag} | v1.3.0` })
.setTimestamp();

// Replace the loading message with the final embed + image
await loadingMsg.edit({ content: null, embeds: [embed], files: [attachment] });



} catch (err) {
console.error(err);
// Delete the loading message if there was an error
await loadingMsg.delete().catch(() => {});
return message.reply(`❌ Greška: ${err.message}`);
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
const parts = content.split(/\s+/);
const systemName = parts.slice(1).join(' ');

if (!systemName) {
return message.reply('⚠️ Unesi naziv sustava. Primjer: `/xsystem Grudi`');
}

const encodedName = encodeURIComponent(systemName);
const EDSM_SYSTEM_URL = `https://www.edsm.net/api-v1/system?systemName=${encodedName}&showInformation=1&showId=1&showPrimaryStar=1`;
const EDSM_FACTIONS_URL = `https://www.edsm.net/api-system-v1/factions?systemName=${encodedName}`;
const EDASTRO_URL = `https://edastro.com/api/starsystem?q=${encodedName}`;

                 // === Safe EDASTRO fetch ===
                    async function fetchEDAstroSafe(url) {
                        try {
                            const res = await fetch(url);
                            let text = await res.text();

                            // Remove leading/trailing junk (common MySQL warnings)
                            text = text.trim();
                            const start = text.indexOf('{') >= 0 ? text.indexOf('{') : 0;
                            const end = text.lastIndexOf('}') >= 0 ? text.lastIndexOf('}') + 1 : text.length;
                            text = text.substring(start, end);

                            // Parse JSON safely
                            let data;
                            try {
                                data = JSON.parse(text);
                                if (Array.isArray(data)) data = data[0] || {};
                                return data;
                            } catch (e) {
                                console.warn('EDAstro JSON parse error:', e.message);
                                return {};
                            }

                        } catch (err) {
                            console.error('EDAstro fetch error:', err.message);
                            return {};
                        }
                    }
              
try {
// Fetch all data in parallel
const [systemRes, factionRes, spanshData, edastroData] = await Promise.all([
fetch(EDSM_SYSTEM_URL),
fetch(EDSM_FACTIONS_URL),
//fetch(EDASTRO_URL),
fetchSpanshSystem(systemName),
fetchEDAstroSafe(EDASTRO_URL) // sanitized
]);

const systemData = await systemRes.json() || {};
if (!validateSystem(systemData, systemName, message)) return;

const factionData = await factionRes.json() || {};

const astro = edastroData || {};

// === System Info ===
const systemInfo = {
government: systemData.government ?? systemData.information?.government ?? 'Unknown',
allegiance: systemData.allegiance ?? systemData.information?.allegiance ?? 'Unknown',
security: systemData.security ?? systemData.information?.security ?? 'Unknown',
population: systemData.population ?? systemData.information?.population ?? 'Unknown',
economy: systemData.information?.economy ?? 'Unknown',
secondEconomy: systemData.information?.secondEconomy ?? null
};

// === Stars & Planets ===
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

// === Starports / Settlements ===
const stations = astro.stations || [];
const starports = stations
.filter(s => {
const type = (s.type || '').toLowerCase();
return ['coriolis','orbis','ocellus','starport','outpost'].some(t => type.includes(t));
})
.sort((a, b) => (a.distanceToArrival ?? Infinity) - (b.distanceToArrival ?? Infinity));

const starportText = starports.length
? starports.map(s => {
const pads = simplePads(s);
const planetInfo = s.type === "Planetary Outpost" && s.bodyName ? `[PLANETARY, ${s.bodyName}]` : '';
const dist = s.distanceToArrival != null ? Math.round(s.distanceToArrival) + " ls" : "Unknown";
const cleanedName = cleanStationName(s.name);
return `* ${cleanedName} ${pads}${planetInfo ? ' ' + planetInfo : ''} - *${dist}*`;
}).join('\n')
: "Nema orbitalnih ili planetarnih starporta";

// Odyssey Settlements
const odysseySettlements = stations.filter(s => (s.type || '').toLowerCase().includes('odyssey'));
const totalOdy = odysseySettlements.length;
let odysseyText = "Nema settlementa";
if (totalOdy > 0) {
const countL = odysseySettlements.filter(s => (s.padsL || 0) > 0).length;
const countM = odysseySettlements.filter(s => (s.padsM || 0) > 0).length;
odysseyText = `* Settlementi s L pad: ${countL}\n* Settlementi samo s M pad: ${countM}`;
}

// Carriers
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
return docking ? `${carrierLabel}` : carrierLabel;
});
if (carriers.length > maxDisplay) displayed.push(`* ...${carriers.length - maxDisplay} more`);
return displayed.join('\n');
})()
: "Nema carriera";

// Factions
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
{ 
name: "🌐 Region", 
value: `${spanshData.region ?? 'Unknown'}\n${spanshData.distance != null ? spanshData.distance.toFixed(2) + ' ly from Sol' : ''}`, 
inline: true 
},
{ name: "⭐ Main Star", value: mainStar, inline: true },
{ name: "🌕 Planets", value: `${numPlanets}`, inline: true },
{ name: "🌍 ELWs", value: `${numELW}`, inline: true },
{ name: "🔵 Water Worlds", value: `${numWW}`, inline: true },
{ name: "⚪ Gas Giants", value: `${numGasGiants}`, inline: true },
{ name: "👷‍♂️ Colony", value: spanshData.knownpermit || spanshData.is_being_colonised ? 'Yes' : 'No', inline: true },
{ name: "👷‍♂️ Permit only?", value: spanshData.is_colonised || spanshData.is_being_colonised ? 'Yes' : 'No', inline: true },

{ name: "⚖️ Allegiance", value: systemInfo.allegiance, inline: true },
{ name: "🔒 Security", value: systemInfo.security, inline: true },
{ name: "👥 Population", value: `${typeof systemInfo.population === 'number' ? systemInfo.population.toLocaleString() : systemInfo.population}`, inline: true },
{ name: "💰 Economy", value: systemInfo.secondEconomy ? `${systemInfo.economy} / ${systemInfo.secondEconomy}` : systemInfo.economy, inline: true },        
{
                name: "💪 Power",
                value: spanshData.controlling_power
                  ? `⚔️ **${spanshData.controlling_power}**
              **${spanshData.power_state}:** ${
                      spanshData.power_state_control_progress != null
                        ? (spanshData.power_state_control_progress * 100).toFixed(2) + '%'
                        : 'Unknown'
                    }
              Reinforce: ${spanshData.power_state_reinforcement?.toLocaleString() ?? 'Unknown'}
              Undermine: ${spanshData.power_state_undermining?.toLocaleString() ?? 'Unknown'}`
                  : spanshData.power_conflicts && spanshData.power_conflicts.length > 0
                  ? `⚔️ **Contested**
              ${spanshData.power_conflicts
                .map(pc => `${pc.name}: ${(pc.progress * 100).toFixed(2)}%`)
                .join('\n')}`
                  : "Unnocupied",
                inline: true
              },
{ 
name: "💵 Exploration Values", 
value: `Mapping: ${spanshData.estimated_mapping_value?.toLocaleString() ?? 'Unknown'}\nScan: ${spanshData.estimated_scan_value?.toLocaleString() ?? 'Unknown'}`, 
inline: true 
},
{ name: "🏛️ Government", value: systemInfo.government, inline: true },
{ name: "🪐 Rings", value: ringsText, inline: false },
{ name: "🏢 Starports", value: starportText, inline: false },
{ name: `🏠 Odyssey Settlements (Total: ${totalOdy})`, value: odysseyText, inline: false },
{ name: `🛰️ Carriers (Total: ${carriers.length})`, value: carrierText, inline: false },
{ name: "Factions", value: factionText, inline: false },
)
.setFooter({ text: `Zatražio/la: ${message.author.tag} | EDSM+EDASTRO+SPANSH | v1.4.0` })
.setTimestamp();

message.reply({ embeds: [embed] });

} catch (err) {
console.error(err);
message.reply(err.message.includes('Spansh nije našao sustav')
? err.message
: '❌ Greška pri dohvaćanju podataka o sustavu ili frakcijama.');
}
}


});


client.login(process.env.DISCORD_BOT_TOKEN);




