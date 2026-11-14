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

function calculateExpiry(daysInput) {
    if (daysInput.toLowerCase() === 'forever') return null;
    const days = parseInt(daysInput);
    if (isNaN(days) || days < 1) return undefined;
    return new Date(Date.now() + days * 86400000).toISOString();
}

const commands = [
    new SlashCommandBuilder().setName('link').setDescription('Link your Luarix API Key').addStringOption(opt => opt.setName('api_key').setDescription('Your LXR-... API Key').setRequired(true)).addRoleOption(opt => opt.setName('manager_role').setDescription('Manager role').setRequired(false)),
    new SlashCommandBuilder().setName('unlink').setDescription('Unlink your Luarix API Key'),
    new SlashCommandBuilder().setName('createkey').setDescription('Generate a new script key').addStringOption(opt => opt.setName('days').setDescription('Days until expiry or "forever"').setRequired(true)),
    new SlashCommandBuilder().setName('setpanel').setDescription('Create a key redemption panel').addStringOption(opt => opt.setName('project').setDescription('Select project').setRequired(true).setAutocomplete(true)).addRoleOption(opt => opt.setName('manager_role').setDescription('Manager role').setRequired(true)).addRoleOption(opt => opt.setName('buyer_role').setDescription('Buyer role').setRequired(true)),
    new SlashCommandBuilder().setName('whitelist').setDescription('Whitelist a user').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('project').setDescription('Select project').setRequired(true).setAutocomplete(true)).addStringOption(opt => opt.setName('days').setDescription('Days or "forever"').setRequired(true)),
    new SlashCommandBuilder().setName('blacklist').setDescription('Blacklist a user').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('project').setDescription('Select project').setRequired(true).setAutocomplete(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)).addStringOption(opt => opt.setName('days').setDescription('Days or "forever"').setRequired(true)),
    new SlashCommandBuilder().setName('masswhitelist').setDescription('Whitelist everyone with a role').addRoleOption(opt => opt.setName('role').setDescription('Role to whitelist').setRequired(true)).addStringOption(opt => opt.setName('project').setDescription('Select project').setRequired(true).setAutocomplete(true)).addStringOption(opt => opt.setName('days').setDescription('Days or "forever"').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded commands.');
    } catch (error) { console.error(error); }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        if (['setpanel', 'whitelist', 'blacklist', 'masswhitelist'].includes(interaction.commandName)) {
            const focusedValue = interaction.options.getFocused();
            const { data: user } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).limit(1);
            if (!user || user.length === 0) return interaction.respond([{ name: "❌ Please use /link first", value: "none" }]);

            const { data: scripts } = await supabase.from('scripts').select('id, name').eq('api_key', user[0].api_key);
            if (!scripts || scripts.length === 0) return interaction.respond([{ name: "❌ No projects found", value: "none" }]);

            const filtered = scripts.filter(c => c.name.toLowerCase().includes(focusedValue.toLowerCase())).map(c => ({ name: c.name, value: c.id })).slice(0, 25);
            await interaction.respond(filtered);
        }
    }

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'link') {
            const apiKey = interaction.options.getString('api_key');
            const roleId = interaction.options.getRole('manager_role')?.id || null;
            const { data: users } = await supabase.from('users').select('*').eq('api_key', apiKey).limit(1);
            
            if (users && users.length > 0) {
                await supabase.from('users').update({ discord_id: interaction.user.id, manager_role_id: roleId }).eq('api_key', apiKey);
                return interaction.reply({ content: `✅ Successfully linked to API Key \`${apiKey}\`.`, ephemeral: true });
            } else {
                await supabase.from('users').insert({ api_key: apiKey, discord_id: interaction.user.id, manager_role_id: roleId, email: `discord_${interaction.user.id}@luarix.com` });
                return interaction.reply({ content: `✅ Created new account and linked to API Key \`${apiKey}\`.`, ephemeral: true });
            }
        }

        if (interaction.commandName === 'unlink') {
            const { error } = await supabase.from('users').update({ discord_id: null }).eq('discord_id', interaction.user.id);
            if (error) return interaction.reply({ content: "❌ Failed to unlink.", ephemeral: true });
            return interaction.reply({ content: `✅ Successfully unlinked your Discord account.`, ephemeral: true });
        }

        if (interaction.commandName === 'createkey') {
            const days = interaction.options.getString('days');
            const expiresAt = calculateExpiry(days);
            if (expiresAt === undefined) return interaction.reply({ content: "❌ Invalid days.", ephemeral: true });

            const { data: users } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).limit(1);
            if (!users || users.length === 0) return interaction.reply({ content: "You need to `/link` your API key first!", ephemeral: true });

            const { data: scripts } = await supabase.from('scripts').select('id, name').eq('api_key', users[0].api_key);
            if (!scripts || scripts.length === 0) return interaction.reply({ content: "You don't have any projects.", ephemeral: true });

            const selectMenu = new StringSelectMenuBuilder().setCustomId(`createkey_select_${days}`).setPlaceholder('Select a project').addOptions(scripts.map(s => ({ label: s.name, value: s.id })));
            interaction.reply({ content: '👇 **Select the project:**', components: [new ActionRowBuilder().addComponents(selectMenu)], ephemeral: true });
        }

        if (interaction.commandName === 'setpanel') {
            const scriptId = interaction.options.getString('project');
            const buyerRole = interaction.options.getRole('buyer_role');
            if (scriptId === "none") return interaction.reply({ content: "Please select a valid project.", ephemeral: true });

            await supabase.from('scripts').update({ buyer_role_id: buyerRole.id, panel_channel_id: interaction.channel.id }).eq('id', scriptId);
            const { data: script } = await supabase.from('scripts').select('name').eq('id', scriptId).single();

            const embed = new EmbedBuilder()
                .setTitle(`${script.name} Control Panel`)
                .setDescription(`This control panel is for the project: **${script.name}**\nIf you're a buyer, click on the buttons below to redeem your key, get the script or get your role.`)
                .setColor(0xf5c518).setFooter({ text: `Sent by ${interaction.user.username}` });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`panel_redeem_${scriptId}`).setLabel('Redeem Key').setEmoji('🗝️').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`panel_script_${scriptId}`).setLabel('Get Script').setEmoji('📜').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`panel_role_${scriptId}`).setLabel('Get Role').setEmoji('👤').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`panel_reset_${scriptId}`).setLabel('Reset HWID').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`panel_stats_${scriptId}`).setLabel('Get Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary)
            );

            await interaction.channel.send({ embeds: [embed], components: [row] });
            interaction.reply({ content: "✅ Panel successfully created!", ephemeral: true });
        }

        if (interaction.commandName === 'whitelist') {
            const targetUser = interaction.options.getUser('user');
            const scriptId = interaction.options.getString('project');
            const days = interaction.options.getString('days');
            const expiresAt = calculateExpiry(days);
            if (scriptId === "none" || expiresAt === undefined) return interaction.reply({ content: "❌ Invalid project or days.", ephemeral: true });

            const { data: scriptData } = await supabase.from('scripts').select('panel_channel_id').eq('id', scriptId).single();
            const panelChannel = scriptData?.panel_channel_id ? `<#${scriptData.panel_channel_id}>` : "the panel channel";

            await supabase.from('whitelists').insert({ discord_id: targetUser.id, script_id: scriptId, expires_at: expiresAt });
            await interaction.channel.send(`<@${targetUser.id}> **You have been whitelisted!**\nYou can access the script via this message --> ${panelChannel}`);
            interaction.reply({ content: "✅ User whitelisted successfully.", ephemeral: true });
        }

        if (interaction.commandName === 'blacklist') {
            const targetUser = interaction.options.getUser('user');
            const scriptId = interaction.options.getString('project');
            const reason = interaction.options.getString('reason');
            const days = interaction.options.getString('days');
            const expiresAt = calculateExpiry(days);
            if (scriptId === "none" || expiresAt === undefined) return interaction.reply({ content: "❌ Invalid project or days.", ephemeral: true });

            const { data: scriptData } = await supabase.from('scripts').select('panel_channel_id').eq('id', scriptId).single();
            const panelChannel = scriptData?.panel_channel_id ? `<#${scriptData.panel_channel_id}>` : "the panel channel";

            await supabase.from('blacklists').insert({ discord_id: targetUser.id, script_id: scriptId, reason: reason, expires_at: expiresAt });
            await interaction.channel.send(`<@${targetUser.id}> **You have been blacklisted!** ⛔\nTo find out why, go to ${panelChannel} and click on **Stats** button`);
            interaction.reply({ content: "✅ User blacklisted successfully.", ephemeral: true });
        }

        if (interaction.commandName === 'masswhitelist') {
            const targetRole = interaction.options.getRole('role');
            const scriptId = interaction.options.getString('project');
            const days = interaction.options.getString('days');
            const expiresAt = calculateExpiry(days);
            if (scriptId === "none" || expiresAt === undefined) return interaction.reply({ content: "❌ Invalid project or days.", ephemeral: true });
            if (targetRole.id === interaction.guild.id) return interaction.reply({ content: "❌ Cannot whitelist @everyone.", ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            try {
                const allMembers = await interaction.guild.members.fetch();
                const membersWithRole = allMembers.filter(member => member.roles.cache.has(targetRole.id));
                if (membersWithRole.size === 0) return interaction.editReply({ content: `❌ No members found with the role **${targetRole.name}**.` });

                const whitelistData = membersWithRole.map(member => ({ discord_id: member.id, script_id: scriptId, expires_at: expiresAt }));
                await supabase.from('whitelists').insert(whitelistData);
                interaction.editReply({ content: `✅ Successfully mass-whitelisted **${membersWithRole.size}** users!` });
            } catch (err) { interaction.editReply({ content: `❌ Error: ${err.message}` }); }
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('createkey_select_')) {
        const days = interaction.customId.replace('createkey_select_', '');
        const expiresAt = calculateExpiry(days);
        const scriptId = interaction.values[0];

        const key = "LXR-KEY-" + crypto.randomBytes(4).toString('hex').toUpperCase();
        await supabase.from('script_keys').insert({ key, script_id: scriptId, expires_at: expiresAt });

        const embed = new EmbedBuilder().setTitle('🔑 Key Generated').setColor(0xf5c518)
            .addFields({ name: 'Key', value: `\`${key}\`` }, { name: 'Expires In', value: expiresAt ? `${days} days` : 'Forever' });
        interaction.update({ content: null, embeds: [embed], components: [] });
    }

    if (interaction.isButton()) {
        const parts = interaction.customId.split('_');
        if (parts[0] === 'panel') {
            const action = parts[1];
            const scriptId = parts[2];

            if (action === 'redeem') {
                const modal = new ModalBuilder().setCustomId(`modal_redeem_${scriptId}`).setTitle('Redeem a key');
                const keyInput = new TextInputBuilder().setCustomId('key_input').setLabel("Enter script key below:").setPlaceholder('LXR-KEY-...').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
                return interaction.showModal(modal);
            }

            const { data: blacklists } = await supabase.from('blacklists').select('*').eq('discord_id', interaction.user.id).eq('script_id', scriptId);
            const activeBlacklist = blacklists?.find(b => !b.expires_at || new Date(b.expires_at) > new Date());

            if (activeBlacklist) {
                const banMsg = `You are blacklisted from this project with the reason:\n\`\`\`\n${activeBlacklist.reason}\n\`\`\`\n⚠️ This ban will expire **${activeBlacklist.expires_at ? new Date(activeBlacklist.expires_at).toLocaleDateString() : 'Never'}**`;
                if (action === 'script') return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Unable to send script').setColor(0xef4444).setDescription(banMsg)], ephemeral: true });
                if (action === 'role') return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Unable to give role').setColor(0xef4444).setDescription(banMsg)], ephemeral: true });
                if (action === 'reset') return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Unable to reset HWID!').setColor(0xef4444).setDescription(`User is temporarily blacklisted.`)], ephemeral: true });
            }

            const { data: userKeys } = await supabase.from('script_keys').select('*').eq('script_id', scriptId).eq('discord_id', interaction.user.id).limit(1);
            const userKey = userKeys && userKeys.length > 0 ? userKeys[0] : null;

            const { data: userWhitelists } = await supabase.from('whitelists').select('*').eq('script_id', scriptId).eq('discord_id', interaction.user.id);
            const isWhitelisted = userWhitelists && userWhitelists.some(w => !w.expires_at || new Date(w.expires_at) > new Date());

            const { data: script } = await supabase.from('scripts').select('buyer_role_id, name').eq('id', scriptId).single();

            if (action === 'script') {
                if (!userKey && !isWhitelisted) {
                    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Not whitelisted!').setColor(0xef4444).setDescription(`You need to be whitelisted to get this script.\nIf you have a script key, click on the **Redeem** button below to redeem it.`)], ephemeral: true });
                }
                
                let finalKey = userKey ? userKey.key : null;
                if (!finalKey && isWhitelisted) {
                    finalKey = "LXR-VIP-" + crypto.randomBytes(4).toString('hex').toUpperCase();
                    await supabase.from('script_keys').insert({ key: finalKey, script_id: scriptId, discord_id: interaction.user.id, expires_at: null });
                }

                // NEW DIRECT LOADER FORMAT
                const loader = `script_key="${finalKey}";\nloadstring(game:HttpGet("https://getluarix.vercel.app/api/loader/${scriptId}"))()`;
                return interaction.reply({ content: `Here is your loader for **${script.name}**:\n\`\`\`lua\n${loader}\n\`\`\``, ephemeral: true });
            }

            if (action === 'role') {
                if (!userKey && !isWhitelisted) return interaction.reply({ content: "You need to redeem a key or be whitelisted first!", ephemeral: true });
                if (!script.buyer_role_id) return interaction.reply({ content: "The owner hasn't set a buyer role.", ephemeral: true });

                try {
                    await interaction.member.roles.add(script.buyer_role_id);
                    interaction.reply({ content: "✅ Role successfully given!", ephemeral: true });
                } catch (err) { interaction.reply({ content: "❌ Failed to give role.", ephemeral: true }); }
            }

            if (action === 'reset') {
                if (!userKey && !isWhitelisted) return interaction.reply({ content: "You need to redeem a key first!", ephemeral: true });
                
                let keyToReset = userKey ? userKey.key : null;
                if (!keyToReset && isWhitelisted) {
                    const { data: vipKey } = await supabase.from('script_keys').select('key').eq('script_id', scriptId).eq('discord_id', interaction.user.id).limit(1);
                    if (vipKey && vipKey.length > 0) keyToReset = vipKey[0].key;
                }

                if (keyToReset) {
                    await supabase.from('script_keys').update({ hwid: null, resets: (userKey?.resets || 0) + 1, last_reset: new Date().toISOString() }).eq('key', keyToReset);
                }
                interaction.reply({ content: "✅ Your HWID has been successfully reset!", ephemeral: true });
            }

            if (action === 'stats') {
                if (!userKey && !isWhitelisted) return interaction.reply({ content: "You need to redeem a key first!", ephemeral: true });

                let statsKey = userKey;
                if (!statsKey && isWhitelisted) {
                    const { data: vipKey } = await supabase.from('script_keys').select('*').eq('script_id', scriptId).eq('discord_id', interaction.user.id).limit(1);
                    if (vipKey && vipKey.length > 0) statsKey = vipKey[0];
                }

                const isBanned = activeBlacklist ? `Yes ❌ (Reason: ${activeBlacklist.reason})` : 'No ✅';
                const embed = new EmbedBuilder().setTitle('Stats').setColor(0x2b2d31).setDescription(`
**Total Executions:** \`${statsKey?.executions || 0}\` 🧠
**HWID Status:** ${statsKey?.hwid ? 'Assigned ✅' : 'Not Assigned ❌'}
**Key:** ||${statsKey?.key || 'None'}|| 🔒
**Total HWID Resets:** \`${statsKey?.resets || 0}\` ⚙️
**Last Reset:** ${statsKey?.last_reset ? new Date(statsKey.last_reset).toLocaleDateString() : 'Never'} 📅
**Expires At:** ${statsKey?.expires_at ? new Date(statsKey.expires_at).toLocaleDateString() : 'Forever'} 📅
**Blacklisted:** ${isBanned}`).setFooter({ text: `Today at ${new Date().toLocaleTimeString()}` });

                interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_redeem_')) {
            const scriptId = interaction.customId.split('_')[2];
            const inputKey = interaction.fields.getTextInputValue('key_input').trim();

            const { data: keyData } = await supabase.from('script_keys').select('*').eq('key', inputKey).eq('script_id', scriptId).limit(1);
            if (!keyData || keyData.length === 0) return interaction.reply({ content: "❌ Invalid key for this project.", ephemeral: true });

            const key = keyData[0];
            if (key.discord_id && key.discord_id !== interaction.user.id) return interaction.reply({ content: "❌ This key has already been redeemed.", ephemeral: true });

            await supabase.from('script_keys').update({ discord_id: interaction.user.id }).eq('key', inputKey);
            const { data: script } = await supabase.from('scripts').select('buyer_role_id').eq('id', scriptId).single();
            if (script.buyer_role_id) { try { await interaction.member.roles.add(script.buyer_role_id); } catch(err) {} }

            interaction.reply({ content: "✅ Successfully redeemed key! You now have access to the script.", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
