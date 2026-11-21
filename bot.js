require('dotenv').config();
const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, 
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Luarix Bot is Online!'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running.'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function genScriptKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = '';
    for (let i = 0; i < 32; i++) {
        key += chars[crypto.randomInt(0, chars.length)];
    }
    return key;
}

function calculateExpiry(daysInput) {
    if (daysInput.toLowerCase() === 'forever') return null;
    const days = parseInt(daysInput);
    if (isNaN(days) || days < 1) return undefined;
    return new Date(Date.now() + days * 86400000).toISOString();
}

async function getGuildLink(guildId) {
    const { data, error } = await supabase
        .from('guild_links')
        .select('*')
        .eq('guild_id', guildId)
        .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0];
}

async function isManager(interaction) {
    const guildId = interaction.guild?.id;
    if (!guildId) return false;

    const link = await getGuildLink(guildId);
    if (!link) return false;

    if (link.linked_by === interaction.user.id) return true;

    if (link.manager_role_id) {
        const member = interaction.member;
        if (member && member.roles.cache.has(link.manager_role_id)) return true;
    }

    return false;
}

const commands = [
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link a Luarix API Key to this server')
        .addStringOption(opt => opt.setName('api_key').setDescription('Your LXR-... API Key').setRequired(true))
        .addRoleOption(opt => opt.setName('manager_role').setDescription('Manager role for this server').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink the API Key from this server'),

    new SlashCommandBuilder()
        .setName('createkey')
        .setDescription('Generate a new script key')
        .addStringOption(opt => opt.setName('days').setDescription('Days until expiry or "forever"').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setpanel')
        .setDescription('Create a key redemption panel')
        .addStringOption(opt => opt.setName('project').setDescription('Select project').setRequired(true).setAutocomplete(true))
        .addRoleOption(opt => opt.setName('manager_role').setDescription('Manager role').setRequired(true))
        .addRoleOption(opt => opt.setName('buyer_role').setDescription('Buyer role').setRequired(true)),

    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Whitelist a user')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
        .addStringOption(opt => opt.setName('project').setDescription('Select project').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('days').setDescription('Days or "forever"').setRequired(true)),

    new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Blacklist a user')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
        .addStringOption(opt => opt.setName('project').setDescription('Select project').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true))
        .addStringOption(opt => opt.setName('days').setDescription('Days or "forever"').setRequired(true)),

    new SlashCommandBuilder()
        .setName('masswhitelist')
        .setDescription('Whitelist everyone with a role')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to whitelist').setRequired(true))
        .addStringOption(opt => opt.setName('project').setDescription('Select project').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('days').setDescription('Days or "forever"').setRequired(true))
];

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash commands registered.');
    } catch (e) {
        console.error('Failed to register commands:', e);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        // ==================== AUTOCOMPLETE ====================
        if (interaction.isAutocomplete()) {
            if (['setpanel', 'whitelist', 'blacklist', 'masswhitelist'].includes(interaction.commandName)) {
                const focusedValue = interaction.options.getFocused();
                const guildId = interaction.guild?.id;

                if (!guildId) {
                    return interaction.respond([{ name: "❌ Server only command", value: "none" }]);
                }

                const link = await getGuildLink(guildId);
                if (!link) {
                    return interaction.respond([{ name: "❌ Please /link an API key in this server first", value: "none" }]);
                }

                const manager = await isManager(interaction);
                if (!manager) {
                    return interaction.respond([{ name: "❌ You need manager permission", value: "none" }]);
                }

                const { data: scripts } = await supabase
                    .from('scripts')
                    .select('id, name')
                    .eq('api_key', link.api_key);

                if (!scripts || scripts.length === 0) {
                    return interaction.respond([{ name: "❌ No projects found for this server", value: "none" }]);
                }

                const filtered = scripts
                    .filter(c => c.name.toLowerCase().includes(focusedValue.toLowerCase()))
                    .map(c => ({ name: c.name, value: c.id }))
                    .slice(0, 25);

                await interaction.respond(filtered.length > 0 ? filtered : [{ name: "No matching projects", value: "none" }]);
            }
            return;
        }

        // ==================== SLASH COMMANDS ====================
        if (interaction.isChatInputCommand()) {

            // /link
            if (interaction.commandName === 'link') {
                const apiKey = interaction.options.getString('api_key');
                const roleId = interaction.options.getRole('manager_role')?.id || null;
                const guildId = interaction.guild?.id;

                if (!guildId) {
                    return interaction.reply({ content: "❌ This command can only be used in a server.", ephemeral: true });
                }

                const { data: users } = await supabase.from('users').select('*').eq('api_key', apiKey).limit(1);
                if (!users || users.length === 0) {
                    return interaction.reply({ content: "❌ Invalid API Key. Make sure it exists on the Luarix dashboard.", ephemeral: true });
                }

                const { data: existing } = await supabase
                    .from('guild_links')
                    .select('*')
                    .eq('guild_id', guildId)
                    .limit(1);

                if (existing && existing.length > 0) {
                    await supabase
                        .from('guild_links')
                        .update({
                            api_key: apiKey,
                            manager_role_id: roleId,
                            linked_by: interaction.user.id
                        })
                        .eq('guild_id', guildId);
                } else {
                    await supabase.from('guild_links').insert({
                        guild_id: guildId,
                        api_key: apiKey,
                        manager_role_id: roleId,
                        linked_by: interaction.user.id
                    });
                }

                return interaction.reply({
                    content: `✅ Successfully linked API Key \`${apiKey}\` to **this server**.\nManager role: ${roleId ? `<@&${roleId}>` : "None"}`,
                    ephemeral: true
                });
            }

            // /unlink
            if (interaction.commandName === 'unlink') {
                const guildId = interaction.guild?.id;
                if (!guildId) {
                    return interaction.reply({ content: "❌ Server only command.", ephemeral: true });
                }

                const link = await getGuildLink(guildId);
                if (!link) {
                    return interaction.reply({ content: "❌ No API key is linked to this server.", ephemeral: true });
                }

                if (link.linked_by !== interaction.user.id) {
                    return interaction.reply({ content: "❌ Only the person who linked the key can unlink it.", ephemeral: true });
                }

                await supabase.from('guild_links').delete().eq('guild_id', guildId);
                return interaction.reply({ content: "✅ Successfully unlinked the API key from this server.", ephemeral: true });
            }

            // Helper
            async function requireManager() {
                const guildId = interaction.guild?.id;
                if (!guildId) {
                    await interaction.reply({ content: "❌ Server only command.", ephemeral: true });
                    return null;
                }

                const link = await getGuildLink(guildId);
                if (!link) {
                    await interaction.reply({ content: "❌ Please `/link` an API key in this server first.", ephemeral: true });
                    return null;
                }

                const manager = await isManager(interaction);
                if (!manager) {
                    await interaction.reply({ content: "❌ You need the manager role (or be the linker) to use this command.", ephemeral: true });
                    return null;
                }

                return link;
            }

            // /createkey
            if (interaction.commandName === 'createkey') {
                const link = await requireManager();
                if (!link) return;

                const days = interaction.options.getString('days');
                const expiresAt = calculateExpiry(days);
                if (expiresAt === undefined) {
                    return interaction.reply({ content: "❌ Invalid days value. Use a number or `forever`.", ephemeral: true });
                }

                const { data: scripts } = await supabase
                    .from('scripts')
                    .select('id, name')
                    .eq('api_key', link.api_key);

                if (!scripts || scripts.length === 0) {
                    return interaction.reply({ content: "❌ No projects found for this server's API key.", ephemeral: true });
                }

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`createkey_select_${days}`)
                    .setPlaceholder('Select a project')
                    .addOptions(scripts.map(s => ({ label: s.name, value: s.id })));

                return interaction.reply({
                    content: '👇 **Select the project:**',
                    components: [new ActionRowBuilder().addComponents(selectMenu)],
                    ephemeral: true
                });
            }

            // /setpanel
            if (interaction.commandName === 'setpanel') {
                await interaction.deferReply({ ephemeral: true });

                const link = await getGuildLink(interaction.guild?.id);
                if (!link) {
                    return interaction.editReply({ content: "❌ Please `/link` an API key in this server first." });
                }

                const manager = await isManager(interaction);
                if (!manager) {
                    return interaction.editReply({ content: "❌ You need manager permission." });
                }

                try {
                    const scriptId = interaction.options.getString('project');
                    const buyerRole = interaction.options.getRole('buyer_role');
                    const managerRole = interaction.options.getRole('manager_role');

                    if (scriptId === "none" || !buyerRole) {
                        return interaction.editReply({ content: "❌ Please select a valid project and buyer role." });
                    }

                    if (managerRole) {
                        await supabase
                            .from('guild_links')
                            .update({ manager_role_id: managerRole.id })
                            .eq('guild_id', interaction.guild.id);
                    }

                    const { error: updateErr } = await supabase
                        .from('scripts')
                        .update({
                            buyer_role_id: buyerRole.id,
                            panel_channel_id: interaction.channel.id
                        })
                        .eq('id', scriptId)
                        .eq('api_key', link.api_key);

                    if (updateErr) throw updateErr;

                    const { data: script } = await supabase
                        .from('scripts')
                        .select('name')
                        .eq('id', scriptId)
                        .single();

                    if (!script) throw new Error("Script not found.");

                    const embed = new EmbedBuilder()
                        .setTitle(`${script.name} Control Panel`)
                        .setDescription(`This control panel is for the project: **${script.name}**\nIf you're a buyer, click on the buttons below to redeem your key, get the script or get your role.`)
                        .setColor(0xf5c518)
                        .setFooter({ text: `Sent by ${interaction.user.username}` });

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`panel_redeem_${scriptId}`).setLabel('Redeem').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`panel_script_${scriptId}`).setLabel('Get Script').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId(`panel_role_${scriptId}`).setLabel('Get Role').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`panel_stats_${scriptId}`).setLabel('Stats').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`panel_reset_${scriptId}`).setLabel('Reset HWID').setStyle(ButtonStyle.Danger)
                    );

                    await interaction.channel.send({ embeds: [embed], components: [row] });
                    return interaction.editReply({ content: "✅ Panel successfully created!" });
                } catch (err) {
                    console.error("Setpanel Error:", err);
                    return interaction.editReply({ content: `❌ Error creating panel: ${err.message || "Unknown error"}` });
                }
            }

            // /whitelist
            if (interaction.commandName === 'whitelist') {
                await interaction.deferReply({ ephemeral: true });

                const link = await getGuildLink(interaction.guild?.id);
                if (!link) return interaction.editReply({ content: "❌ Please `/link` an API key first." });

                const manager = await isManager(interaction);
                if (!manager) return interaction.editReply({ content: "❌ You need manager permission." });

                try {
                    const targetUser = interaction.options.getUser('user');
                    const scriptId = interaction.options.getString('project');
                    const days = interaction.options.getString('days');
                    const expiresAt = calculateExpiry(days);

                    if (scriptId === "none" || expiresAt === undefined) {
                        return interaction.editReply({ content: "❌ Invalid project or days." });
                    }

                    const { data: scriptCheck } = await supabase
                        .from('scripts')
                        .select('id')
                        .eq('id', scriptId)
                        .eq('api_key', link.api_key)
                        .single();

                    if (!scriptCheck) {
                        return interaction.editReply({ content: "❌ This project does not belong to this server." });
                    }

                    const { data: scriptData } = await supabase
                        .from('scripts')
                        .select('panel_channel_id')
                        .eq('id', scriptId)
                        .single();

                    const panelChannel = scriptData?.panel_channel_id ? `<#${scriptData.panel_channel_id}>` : "the panel channel";

                    await supabase.from('whitelists').insert({
                        discord_id: targetUser.id,
                        script_id: scriptId,
                        expires_at: expiresAt
                    });

                    await interaction.channel.send(`<@${targetUser.id}> You have been whitelisted!\nYou can access the script via this message --> ${panelChannel}`);
                    return interaction.editReply({ content: "✅ User whitelisted successfully." });
                } catch (e) {
                    return interaction.editReply({ content: `❌ Error: ${e.message}` });
                }
            }

            // /blacklist
            if (interaction.commandName === 'blacklist') {
                await interaction.deferReply({ ephemeral: true });

                const link = await getGuildLink(interaction.guild?.id);
                if (!link) return interaction.editReply({ content: "❌ Please `/link` an API key first." });

                const manager = await isManager(interaction);
                if (!manager) return interaction.editReply({ content: "❌ You need manager permission." });

                try {
                    const targetUser = interaction.options.getUser('user');
                    const scriptId = interaction.options.getString('project');
                    const reason = interaction.options.getString('reason');
                    const days = interaction.options.getString('days');
                    const expiresAt = calculateExpiry(days);

                    if (scriptId === "none" || expiresAt === undefined) {
                        return interaction.editReply({ content: "❌ Invalid project or days." });
                    }

                    const { data: scriptCheck } = await supabase
                        .from('scripts')
                        .select('id')
                        .eq('id', scriptId)
                        .eq('api_key', link.api_key)
                        .single();

                    if (!scriptCheck) {
                        return interaction.editReply({ content: "❌ This project does not belong to this server." });
                    }

                    const { data: scriptData } = await supabase
                        .from('scripts')
                        .select('panel_channel_id')
                        .eq('id', scriptId)
                        .single();

                    const panelChannel = scriptData?.panel_channel_id ? `<#${scriptData.panel_channel_id}>` : "the panel channel";

                    await supabase.from('blacklists').insert({
                        discord_id: targetUser.id,
                        script_id: scriptId,
                        reason: reason,
                        expires_at: expiresAt
                    });

                    await interaction.channel.send(`<@${targetUser.id}> You have been blacklisted! ⛔\nTo find out why, go to ${panelChannel} and click on **Stats** button`);
                    return interaction.editReply({ content: "✅ User blacklisted successfully." });
                } catch (e) {
                    return interaction.editReply({ content: `❌ Error: ${e.message}` });
                }
            }

            // /masswhitelist
            if (interaction.commandName === 'masswhitelist') {
                const link = await getGuildLink(interaction.guild?.id);
                if (!link) {
                    return interaction.reply({ content: "❌ Please `/link` an API key first.", ephemeral: true });
                }

                const manager = await isManager(interaction);
                if (!manager) {
                    return interaction.reply({ content: "❌ You need manager permission.", ephemeral: true });
                }

                const targetRole = interaction.options.getRole('role');
                const scriptId = interaction.options.getString('project');
                const days = interaction.options.getString('days');
                const expiresAt = calculateExpiry(days);

                if (scriptId === "none" || expiresAt === undefined) {
                    return interaction.reply({ content: "❌ Invalid project or days.", ephemeral: true });
                }

                if (targetRole.id === interaction.guild.id) {
                    return interaction.reply({ content: "❌ Cannot whitelist @everyone.", ephemeral: true });
                }

                const { data: scriptCheck } = await supabase
                    .from('scripts')
                    .select('id')
                    .eq('id', scriptId)
                    .eq('api_key', link.api_key)
                    .single();

                if (!scriptCheck) {
                    return interaction.reply({ content: "❌ This project does not belong to this server.", ephemeral: true });
                }

                await interaction.deferReply({ ephemeral: true });

                try {
                    const allMembers = await interaction.guild.members.fetch();
                    const membersWithRole = allMembers.filter(member => member.roles.cache.has(targetRole.id));

                    if (membersWithRole.size === 0) {
                        return interaction.editReply({ content: `❌ No members found with the role **${targetRole.name}**.` });
                    }

                    const whitelistData = membersWithRole.map(member => ({
                        discord_id: member.id,
                        script_id: scriptId,
                        expires_at: expiresAt
                    }));

                    await supabase.from('whitelists').insert(whitelistData);
                    return interaction.editReply({ content: `✅ Successfully whitelisted **${membersWithRole.size}** members.` });
                } catch (e) {
                    return interaction.editReply({ content: `❌ Error: ${e.message}` });
                }
            }
        }

        // ==================== SELECT MENUS ====================
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('createkey_select_')) {
                const days = interaction.customId.replace('createkey_select_', '');
                const scriptId = interaction.values[0];
                const expiresAt = calculateExpiry(days);

                const finalKey = genScriptKey();

                await supabase.from('script_keys').insert({
                    key: finalKey,
                    script_id: scriptId,
                    expires_at: expiresAt
                    // note: we do NOT set discord_id here so the key can be given to anyone
                });

                const { data: script } = await supabase.from('scripts').select('name').eq('id', scriptId).single();

                const embed = new EmbedBuilder()
                    .setTitle('🔑 Key Generated')
                    .setColor(0xf5c518)
                    .addFields(
                        { name: 'Project', value: script?.name || 'Unknown', inline: true },
                        { name: 'Key', value: `\`${finalKey}\``, inline: false },
                        { name: 'Expires', value: expiresAt ? `${days} days` : 'Forever', inline: true }
                    )
                    .setFooter({ text: 'Give this key to the buyer. They can redeem it in the panel.' });

                return interaction.update({
                    content: null,
                    embeds: [embed],
                    components: []
                });
            }
        }

        // ==================== BUTTONS ====================
        if (interaction.isButton()) {
            const parts = interaction.customId.split('_');
            if (parts[0] === 'panel') {
                const action = parts[1];
                const scriptId = parts[2];

                // Redeem → Modal
                if (action === 'redeem') {
                    const modal = new ModalBuilder()
                        .setCustomId(`modal_redeem_${scriptId}`)
                        .setTitle('Redeem a key');
                    const keyInput = new TextInputBuilder()
                        .setCustomId('key_input')
                        .setLabel("Enter script key below:")
                        .setPlaceholder('Paste your 32-character key')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);
                    modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
                    return interaction.showModal(modal);
                }

                await interaction.deferReply({ ephemeral: true });

                // Blacklist check
                const { data: blacklists } = await supabase.from('blacklists')
                    .select('*')
                    .eq('discord_id', interaction.user.id)
                    .eq('script_id', scriptId);
                const activeBlacklist = blacklists?.find(b => !b.expires_at || new Date(b.expires_at) > new Date());

                if (activeBlacklist) {
                    const banMsg = `You are blacklisted from this project with the reason:\n\`\`\`\n${activeBlacklist.reason}\n\`\`\`\n⚠️ This ban will expire **${activeBlacklist.expires_at ? new Date(activeBlacklist.expires_at).toLocaleDateString() : 'Never'}**`;
                    
                    if (action === 'script') {
                        return interaction.editReply({ 
                            embeds: [new EmbedBuilder().setTitle('Unable to send script').setColor(0xef4444).setDescription(banMsg)] 
                        });
                    }
                    if (action === 'role') {
                        return interaction.editReply({ 
                            embeds: [new EmbedBuilder().setTitle('Unable to give role').setColor(0xef4444).setDescription(banMsg)] 
                        });
                    }
                    if (action === 'reset') {
                        return interaction.editReply({ 
                            embeds: [new EmbedBuilder().setTitle('Unable to reset HWID!').setColor(0xef4444).setDescription('User is temporarily blacklisted.')] 
                        });
                    }
                }

                // Key + whitelist check
                const { data: userKeys } = await supabase.from('script_keys')
                    .select('*')
                    .eq('script_id', scriptId)
                    .eq('discord_id', interaction.user.id)
                    .limit(1);
                const userKey = userKeys && userKeys.length > 0 ? userKeys[0] : null;

                const { data: userWhitelists } = await supabase.from('whitelists')
                    .select('*')
                    .eq('script_id', scriptId)
                    .eq('discord_id', interaction.user.id);
                const isWhitelisted = userWhitelists && userWhitelists.some(w => !w.expires_at || new Date(w.expires_at) > new Date());

                const { data: script } = await supabase.from('scripts')
                    .select('buyer_role_id, name')
                    .eq('id', scriptId)
                    .single();

// ========== GET SCRIPT ==========
if (action === 'script') {
    if (!userKey && !isWhitelisted) {
        return interaction.editReply({ 
            embeds: [new EmbedBuilder()
                .setTitle('Not whitelisted!')
                .setColor(0xef4444)
                .setDescription('You need to be whitelisted to get this script.\nIf you have a script key, click on the **Redeem** button to redeem it.')
            ] 
        });
    }

    let finalKey = userKey ? userKey.key : null;

    // If user is whitelisted but has no key → create one automatically
    if (!finalKey && isWhitelisted) {
        finalKey = genScriptKey();

        await supabase.from('script_keys').insert({
            key: finalKey,
            script_id: scriptId,
            discord_id: interaction.user.id,
            expires_at: null // forever
        });
    }

    const loader = finalKey
        ? `script_key="${finalKey}";\nloadstring(game:HttpGet("https://getluarix.vercel.app/api/loader/${scriptId}"))()`
        : `loadstring(game:HttpGet("https://getluarix.vercel.app/api/loader/${scriptId}"))()`;

    return interaction.editReply({
        embeds: [new EmbedBuilder()
            .setTitle(`${script?.name || 'Script'} Loader`)
            .setColor(0xf5c518)
            .setDescription('```lua\n' + loader + '\n```')
        ]
    });
}

                // ========== GET ROLE ==========
                if (action === 'role') {
                    if (!userKey && !isWhitelisted) {
                        return interaction.editReply({ content: "You need to redeem a key or be whitelisted first!" });
                    }

                    if (!script?.buyer_role_id) {
                        return interaction.editReply({ content: "❌ No buyer role is set for this project." });
                    }

                    try {
                        let member = interaction.member;
                        if (!member || !member.roles) {
                            member = await interaction.guild.members.fetch(interaction.user.id);
                        }
                        const role = interaction.guild.roles.cache.get(script.buyer_role_id);
                        if (!role) {
                            return interaction.editReply({ content: "❌ Buyer role not found in this server." });
                        }
                        await member.roles.add(role.id);
                        return interaction.editReply({ content: `✅ Role **${role.name}** given successfully!` });
                    } catch (err) {
                        console.error("Give role error:", err);
                        return interaction.editReply({
                            content: `❌ Failed to give role: ${err.message || "Unknown error"}\nMake sure the bot has **Manage Roles** permission and its role is above the buyer role.`
                        });
                    }
                }

                // ========== RESET HWID ==========
                if (action === 'reset') {
                    if (!userKey && !isWhitelisted) {
                        return interaction.editReply({ content: "You need to redeem a key first!" });
                    }
                    
                    let keyToReset = userKey ? userKey.key : null;
                    if (!keyToReset && isWhitelisted) {
                        const { data: vipKey } = await supabase.from('script_keys')
                            .select('key')
                            .eq('script_id', scriptId)
                            .eq('discord_id', interaction.user.id)
                            .limit(1);
                        if (vipKey && vipKey.length > 0) keyToReset = vipKey[0].key;
                    }

                    if (keyToReset) {
                        await supabase.from('script_keys').update({ 
                            hwid: null, 
                            resets: (userKey?.resets || 0) + 1, 
                            last_reset: new Date().toISOString() 
                        }).eq('key', keyToReset);
                    }
                    return interaction.editReply({ content: "✅ Your HWID has been successfully reset!" });
                }

                // ========== GET STATS ==========
                if (action === 'stats') {
                    if (!userKey && !isWhitelisted) {
                        return interaction.editReply({ content: "You need to redeem a key first!" });
                    }

                    let statsKey = userKey;
                    if (!statsKey && isWhitelisted) {
                        const { data: vipKey } = await supabase.from('script_keys')
                            .select('*')
                            .eq('script_id', scriptId)
                            .eq('discord_id', interaction.user.id)
                            .limit(1);
                        if (vipKey && vipKey.length > 0) statsKey = vipKey[0];
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('📊 Your Stats')
                        .setColor(0xf5c518)
                        .addFields(
                            { name: 'Key', value: statsKey ? `\`${statsKey.key}\`` : 'Whitelisted (no key)', inline: false },
                            { name: 'HWID', value: statsKey?.hwid || 'Not set', inline: true },
                            { name: 'Resets', value: String(statsKey?.resets || 0), inline: true },
                            { name: 'Expires', value: statsKey?.expires_at ? new Date(statsKey.expires_at).toLocaleDateString() : 'Never', inline: true }
                        )
                        .setFooter({ text: `Today at ${new Date().toLocaleTimeString()}` });

                    return interaction.editReply({ embeds: [embed] });
                }
            }
        }

        // ==================== MODAL SUBMIT ====================
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_redeem_')) {
                const scriptId = interaction.customId.split('_')[2];
                const inputKey = interaction.fields.getTextInputValue('key_input').trim();

                const { data: keyData } = await supabase.from('script_keys')
                    .select('*')
                    .eq('key', inputKey)
                    .eq('script_id', scriptId)
                    .limit(1);
                    
                if (!keyData || keyData.length === 0) {
                    return interaction.reply({ content: "❌ Invalid key for this project.", ephemeral: true });
                }

                const key = keyData[0];
                if (key.discord_id && key.discord_id !== interaction.user.id) {
                    return interaction.reply({ content: "❌ This key has already been redeemed.", ephemeral: true });
                }

                await supabase.from('script_keys').update({ discord_id: interaction.user.id }).eq('key', inputKey);
                
                let roleMsg = "";
                try {
                    const { data: script } = await supabase.from('scripts').select('buyer_role_id').eq('id', scriptId).single();
                    if (script && script.buyer_role_id) {
                        let member = interaction.member;
                        if (!member || !member.roles) {
                            member = await interaction.guild.members.fetch(interaction.user.id);
                        }
                        await member.roles.add(script.buyer_role_id);
                        roleMsg = " Buyer role has also been given.";
                    }
                } catch (err) {
                    console.error("Auto role on redeem failed:", err.message);
                    roleMsg = " (Could not auto-give role — use Get Role button or check bot permissions.)";
                }

                return interaction.reply({ 
                    content: "✅ Successfully redeemed key! You now have access to the script." + roleMsg, 
                    ephemeral: true 
                });
            }
        }

    } catch (err) {
        console.error("Interaction Error:", err);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: "❌ An error occurred.", ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: "❌ An error occurred.", ephemeral: true }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
