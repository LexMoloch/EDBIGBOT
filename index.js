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
                      console.log(`✅ Logged in as ${client.user.tag}`);
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

						// Build a breakdown text if available
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
								{ name: "🌌 Ukupno", value: `${(t?.total ?? 0).toLocaleString('hr-HR')} brodova`, inline: true },
								{ name: "🗓️ Zadnjih 7 dana", value: `${(t?.week ?? 0).toLocaleString('hr-HR')} brodova`, inline: true },
								{ name: "📅 Zadnjih 24 sata", value: `${(t?.day ?? 0).toLocaleString('hr-HR')} brodova`, inline: true },
								{ name: "Brodovi zadnjih 24 sata", value: breakdownText, inline: false }								

                            )
                            .setFooter({ text: `Zatražio/la: ${message.author.tag}` })
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
                        const rawParams = content.slice(9).trim(); // Remove "/distance"
                        const [system1, system2] = rawParams.split(',').map(s => s.trim());

                        if (!system1 || !system2) {
                          return message.reply('⚠️ Unesi **dva sustava odvojena zarezom**. Primjer: `/distance Sol, Alpha Centauri`');
                        }

                        const fetchCoords = async (name) => {
                          const url = `https://www.edsm.net/api-v1/system?systemName=${encodeURIComponent(name)}&showCoordinates=1`;
                          const res = await fetch(url);
                          const json = await res.json();
                          console.log(`Coords response for "${name}":`, json);

                          if (json.error) {
                            return null;
                          }

                          return json.coords || null;  // <-- Fix here
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
                            .setFooter({ text: `Zatražio/la: ${message.author.tag} • app v1.2.1` });

                          message.reply({ embeds: [embed] });

                        } catch (err) {
                          console.error(err);
                          message.reply('⚠️ Greška pri dohvaćanju podataka s EDSM-a.');
                        }

                        return;
                      }
                    });

                    client.login(process.env.DISCORD_BOT_TOKEN);
