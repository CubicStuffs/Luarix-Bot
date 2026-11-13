require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Luarix Bot is Online!'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running.'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = [
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Luarix API Key to your Discord account')
        .addStringOption(opt => opt.setName('api_key').setDescription('Your LXR-... API Key').setRequired(true))
        .addRoleOption(opt => opt.setName('manager_role').setDescription('The role allowed to manage keys').setRequired(false)),
    new SlashCommandBuilder()
        .setName('createkey')
        .setDescription('Generate a new script key')
        .addIntegerOption(opt => opt.setName('days').setDescription('Days until expiry').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setpanel')
        .setDescription('Create a key redemption panel for a project')
        .addStringOption(opt => opt.setName('project').setDescription('Select your project').setRequired(true).setAutocomplete(true))
        .addRoleOption(opt => opt.setName('manager_role').setDescription('Role that manages keys').setRequired(true))
        .addRoleOption(opt => opt.setName('buyer_role').setDescription('Role given when redeemed').setRequired(true)),
    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Whitelist a user to use a project without a key')
        .addUserOption(opt => opt.setName('user').setDescription('The user to whitelist').setRequired(true))
        .addStringOption(opt => opt.setName('project').setDescription('Select your project').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('days').setDescription('Days until expiry').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('The channel where the panel is located').setRequired(true))
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
    
    // --- AUTOCOMPLETE ---
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'setpanel' || interaction.commandName === 'whitelist') {
            const focusedValue = interaction.options.getFocused();
            const { data: user } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).limit(1);
            
            if (!user || user.length === 0) return interaction.respond([{ name: "❌ Please use /link first", value: "none" }]);

            const { data: scripts } = await supabase.from('scripts').select('id, name').eq('api_key', user[0].api_key);
            if (!scripts || scripts.length === 0) return interaction.respond([{ name: "❌ No projects found on website", value: "none" }]);

            const filtered = scripts
                .filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(choice => ({ name: choice.name, value: choice.id }))
                .slice(0, 25);

            await interaction.respond(filtered);
        }
    }

    // --- SLASH COMMANDS ---
    if (interaction.isChatInputCommand()) {
        
        if (interaction.commandName === 'link') {
            const apiKey = interaction.options.getString('api_key');
            const role = interaction.options.getRole('manager_role');
            const roleId = role ? role.id : null;

            const { data: users } = await supabase.from('users').select('*').eq('api_key', apiKey).limit(1);
            
            if (users && users.length > 0) {
                await supabase.from('users').update({ discord_id: interaction.user.id, manager_role_id: roleId }).eq('api_key', apiKey);
                return interaction.reply({ content: `✅ Successfully linked to API Key \`${apiKey}\`.`, ephemeral: true });
            } else {
                await supabase.from('users').insert({ api_key: apiKey, discord_id: interaction.user.id, manager_role_id: roleId, email: `discord_${interaction.user.id}@luarix.com` });
                return interaction.reply({ content: `✅ Created new account and linked to API Key \`${apiKey}\`.`, ephemeral: true });
            }
        }

        if (interaction.commandName === 'createkey') {
            const days = interaction.options.getInteger('days');
            const { data: users } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).limit(1);
            if (!users || users.length === 0) return interaction.reply({ content: "You need to `/link` your API key first!", ephemeral: true });

            const { data: scripts } = await supabase.from('scripts').select('id, name').eq('api_key', users[0].api_key);
            if (!scripts || scripts.length === 0) return interaction.reply({ content: "You don't have any projects.", ephemeral: true });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`createkey_select_${days}`)
                .setPlaceholder('Select a project')
                .addOptions(scripts.map(s => ({ label: s.name, value: s.id })));

            interaction.reply({ content: '👇 **Select the project:**', components: [new ActionRowBuilder().addComponents(selectMenu)], ephemeral: true });
        }

        if (interaction.commandName === 'setpanel') {
            const scriptId = interaction.options.getString('project');
            const buyerRole = interaction.options.getRole('buyer_role');
            
            if (scriptId === "none") return interaction.reply({ content: "Please select a valid project from the dropdown.", ephemeral: true });

            await supabase.from('scripts').update({ buyer_role_id: buyerRole.id }).eq('id', scriptId);
            const { data: script } = await supabase.from('scripts').select('name').eq('id', scriptId).single();

            const embed = new EmbedBuilder()
                .setTitle(`${script.name} Control Panel`)
                .setDescription(`This control panel is for the project: **${script.name}**\nIf you're a buyer, click on the buttons below to redeem your key, get the script or get your role.`)
                .setColor(0xf5c518)
                .setFooter({ text: `Sent by ${interaction.user.username} • ${new Date().toLocaleDateString()}` });

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

        // FIXED /WHITELIST COMMAND
        if (interaction.commandName === 'whitelist') {
            const targetUser = interaction.options.getUser('user');
            const scriptId = interaction.options.getString('project');
            const days = interaction.options.getInteger('days');
            const channel = interaction.options.getChannel('channel');

            // 1. Safety Check: Does this script actually exist?
            if (scriptId === "none") {
                return interaction.reply({ content: "❌ Invalid project selected. Please make sure you selected it from the dropdown.", ephemeral: true });
            }

            const { data: scriptExists } = await supabase.from('scripts').select('id').eq('id', scriptId).maybeSingle();
            if (!scriptExists) {
                return interaction.reply({ content: "❌ Error: This project ID was not found in the database. Please refresh Discord and try again.", ephemeral: true });
            }

            // 2. Insert into Whitelists
            const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
            const { error } = await supabase.from('whitelists').insert({ 
                discord_id: targetUser.id, 
                script_id: scriptId, 
                expires_at: expiresAt 
            });

            if (error) return interaction.reply({ content: `Database error: ${error.message}`, ephemeral: true });

            // 3. Send the public success message
            const successEmbed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setDescription(`<@${targetUser.id}> **You have been whitelisted!**\nYou can access the script via this message --> ${channel}`);

            await interaction.channel.send({ embeds: [successEmbed] });
            interaction.reply({ content: "✅ User whitelisted successfully.", ephemeral: true });
        }
    }

    // --- DROPDOWN MENU (Create Key) ---
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('createkey_select_')) {
        const days = parseInt(interaction.customId.replace('createkey_select_', ''));
        const scriptId = interaction.values[0];

        const key = "LXR-KEY-" + crypto.randomBytes(4).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

        await supabase.from('script_keys').insert({ key, script_id: scriptId, expires_at: expiresAt });

        const embed = new EmbedBuilder().setTitle('🔑 Key Generated').setColor(0xf5c518)
            .addFields({ name: 'Key', value: `\`${key}\`` }, { name: 'Expires In', value: `${days} days` });
        interaction.update({ content: null, embeds: [embed], components: [] });
    }

    // --- BUTTONS ---
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

            // CHECK IF THEY HAVE A KEY OR ARE WHITELISTED
            const { data: userKeys } = await supabase.from('script_keys').select('*').eq('script_id', scriptId).eq('discord_id', interaction.user.id).limit(1);
            const userKey = userKeys && userKeys.length > 0 ? userKeys[0] : null;

            const { data: userWhitelists } = await supabase.from('whitelists').select('*').eq('script_id', scriptId).eq('discord_id', interaction.user.id);
            const isWhitelisted = userWhitelists && userWhitelists.some(w => !w.expires_at || new Date(w.expires_at) > new Date());

            const { data: script } = await supabase.from('scripts').select('buyer_role_id, name').eq('id', scriptId).single();

            if (action === 'script') {
                if (!userKey && !isWhitelisted) {
                    return interaction.reply({ 
                        embeds: [new EmbedBuilder().setTitle('Not whitelisted!').setColor(0xef4444).setDescription(`You need to be whitelisted to get this script.\nIf you have a script key, click on the **Redeem** button below to redeem it.`)], 
                        ephemeral: true 
                    });
                }
                
                let finalKey = userKey ? userKey.key : null;

                // Auto-generate VIP key for whitelisted users
                if (!finalKey && isWhitelisted) {
                    finalKey = "LXR-VIP-" + crypto.randomBytes(4).toString('hex').toUpperCase();
                    await supabase.from('script_keys').insert({ key: finalKey, script_id: scriptId, discord_id: interaction.user.id, expires_at: null });
                }

                const loader = `script_key="${finalKey}"; loadstring(game:HttpGet("https://luarix-eight.vercel.app/api/loader?id=${scriptId}"))()`;
                return interaction.reply({ content: `Here is your loader for **${script.name}**:\n\`\`\`lua\n${loader}\n\`\`\``, ephemeral: true });
            }

            if (action === 'role') {
                if (!userKey && !isWhitelisted) return interaction.reply({ content: "You need to redeem a key or be whitelisted first!", ephemeral: true });
                if (!script.buyer_role_id) return interaction.reply({ content: "The owner hasn't set a buyer role for this script.", ephemeral: true });

                try {
                    await interaction.member.roles.add(script.buyer_role_id);
                    interaction.reply({ content: "✅ Role successfully given!", ephemeral: true });
                } catch (err) {
                    interaction.reply({ content: "❌ Failed to give role. The bot needs `Manage Roles` permission and its role must be above the buyer role.", ephemeral: true });
                }
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
                
                interaction.reply({ content: "✅ Your HWID has been successfully reset! You can now execute the script on your new device.", ephemeral: true });
            }

            if (action === 'stats') {
                if (!userKey && !isWhitelisted) return interaction.reply({ content: "You need to redeem a key first!", ephemeral: true });

                let statsKey = userKey;
                if (!statsKey && isWhitelisted) {
                    const { data: vipKey } = await supabase.from('script_keys').select('*').eq('script_id', scriptId).eq('discord_id', interaction.user.id).limit(1);
                    if (vipKey && vipKey.length > 0) statsKey = vipKey[0];
                }

                const embed = new EmbedBuilder()
                    .setTitle('Stats')
                    .setColor(0x2b2d31)
                    .setDescription(`
**Total Executions:** \`${statsKey?.executions || 0}\` 🧠
**HWID Status:** ${statsKey?.hwid ? 'Assigned ✅' : 'Not Assigned ❌'}
**Key:** ||${statsKey?.key || 'None'}|| 🔒
**Total HWID Resets:** \`${statsKey?.resets || 0}\` ⚙️
**Last Reset:** ${statsKey?.last_reset ? new Date(statsKey.last_reset).toLocaleDateString() : 'Never'} 📅
**Expires At:** ${statsKey?.expires_at ? new Date(statsKey.expires_at).toLocaleDateString() : 'Never'} 📅
**Banned:** ${statsKey?.banned ? 'Yes ❌' : 'No ✅'}
**Note:** ${statsKey?.note || 'Not specified'}
                    `)
                    .setFooter({ text: `Today at ${new Date().toLocaleTimeString()}` });

                interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    }

    // --- MODAL SUBMIT (Redeem Logic) ---
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_redeem_')) {
            const scriptId = interaction.customId.split('_')[2];
            const inputKey = interaction.fields.getTextInputValue('key_input').trim();

            const { data: keyData } = await supabase.from('script_keys').select('*').eq('key', inputKey).eq('script_id', scriptId).limit(1);
            if (!keyData || keyData.length === 0) return interaction.reply({ content: "❌ Invalid key for this project.", ephemeral: true });

            const key = keyData[0];
            if (key.discord_id && key.discord_id !== interaction.user.id) {
                return interaction.reply({ content: "❌ This key has already been redeemed by someone else.", ephemeral: true });
            }

            await supabase.from('script_keys').update({ discord_id: interaction.user.id }).eq('key', inputKey);

            const { data: script } = await supabase.from('scripts').select('buyer_role_id').eq('id', scriptId).single();
            if (script.buyer_role_id) {
                try { await interaction.member.roles.add(script.buyer_role_id); } catch(err) {}
            }

            interaction.reply({ content: "✅ Successfully redeemed key! You now have access to the script and your buyer role.", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
