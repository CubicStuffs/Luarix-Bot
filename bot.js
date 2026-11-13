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
    ButtonStyle
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const express = require('express');

// 1. Keep Render Alive
const app = express();
app.get('/', (req, res) => res.send('Luarix Bot is Online!'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running.'));

// 2. Setup Supabase & Discord
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// 3. Define Slash Commands
const commands = [
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Luarix API Key to your Discord account')
        .addStringOption(opt => opt.setName('api_key').setDescription('Your LXR-... API Key').setRequired(true))
        .addRoleOption(opt => opt.setName('manager_role').setDescription('The role allowed to generate keys').setRequired(false)),
    new SlashCommandBuilder()
        .setName('projects')
        .setDescription('View your Luarix projects'),
    new SlashCommandBuilder()
        .setName('createkey')
        .setDescription('Generate a new script key')
        .addIntegerOption(opt => opt.setName('days').setDescription('Days until expiry').setRequired(true)),
    new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reset the HWID of a key')
        .addStringOption(opt => opt.setName('key').setDescription('The script key').setRequired(true)),
    // NEW: /setpanel command with Autocomplete
    new SlashCommandBuilder()
        .setName('setpanel')
        .setDescription('Create a key redemption panel for a project')
        .addStringOption(opt => 
            opt.setName('project')
                .setDescription('Select your project')
                .setRequired(true)
                .setAutocomplete(true) // Enables dynamic dropdown
        )
        .addRoleOption(opt => 
            opt.setName('manager_role')
                .setDescription('The role that manages this project')
                .setRequired(true)
        )
        .addRoleOption(opt => 
            opt.setName('buyer_role')
                .setDescription('The role given to buyers after redeeming')
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

// 4. Register Commands
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded commands.');
    } catch (error) { console.error(error); }
});

// 5. Handle Commands & Interactions
client.on('interactionCreate', async interaction => {
    
    // ==========================================
    // AUTOCOMPLETE HANDLER (For /setpanel)
    // ==========================================
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'setpanel') {
            const focusedValue = interaction.options.getFocused();
            
            // Get user's API key
            const { data: user } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).maybeSingle();
            if (!user) return interaction.respond([{ name: "Please use /link first", value: "none" }]);

            // Fetch their projects
            const { data: scripts } = await supabase.from('scripts').select('id, name').eq('api_key', user.api_key);
            if (!scripts || scripts.length === 0) return interaction.respond([{ name: "No projects found", value: "none" }]);

            // Filter based on what they type
            const filtered = scripts
                .filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(choice => ({ name: choice.name, value: choice.id }))
                .slice(0, 25); // Discord only allows 25 choices max

            await interaction.respond(filtered);
        }
    }

    // ==========================================
    // SLASH COMMAND HANDLER
    // ==========================================
    if (interaction.isChatInputCommand()) {

        // --- /LINK COMMAND ---
        if (interaction.commandName === 'link') {
            const apiKey = interaction.options.getString('api_key');
            const role = interaction.options.getRole('manager_role');
            const roleId = role ? role.id : null;

            const { data: users, error: fetchErr } = await supabase.from('users').select('*').eq('api_key', apiKey).limit(1);
            if (fetchErr) return interaction.reply({ content: `Database Error: ${fetchErr.message}`, ephemeral: true });

            const user = users && users.length > 0 ? users[0] : null;

            if (user) {
                await supabase.from('users').update({ discord_id: interaction.user.id, manager_role_id: roleId }).eq('api_key', apiKey);
                return interaction.reply({ content: `✅ Successfully linked to API Key \`${apiKey}\`.`, ephemeral: true });
            } else {
                await supabase.from('users').insert({ api_key: apiKey, discord_id: interaction.user.id, manager_role_id: roleId });
                return interaction.reply({ content: `✅ Created new account and linked to API Key \`${apiKey}\`.`, ephemeral: true });
            }
        }

        // --- /PROJECTS COMMAND ---
        if (interaction.commandName === 'projects') {
            const { data: users, error } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).limit(1);
            if (error) return interaction.reply({ content: `Database Error: ${error.message}`, ephemeral: true });
            
            const user = users && users.length > 0 ? users[0] : null;
            if (!user) return interaction.reply({ content: "You need to `/link` your API key first!", ephemeral: true });

            const { data: scripts } = await supabase.from('scripts').select('id, name, keyless').eq('api_key', user.api_key);
            if (!scripts || scripts.length === 0) return interaction.reply({ content: `Linked to \`${user.api_key}\` but you don't have any projects yet.`, ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle('📁 Your Luarix Projects')
                .setColor(0xf5c518)
                .setDescription(scripts.map(s => `**${s.name}**\nID: \`${s.id}\`\nKeyless: ${s.keyless ? '✅' : '❌'}`).join('\n\n'));

            interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // --- /CREATEKEY COMMAND ---
        if (interaction.commandName === 'createkey') {
            const days = interaction.options.getInteger('days');

            const { data: users, error: userErr } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).limit(1);
            if (userErr) return interaction.reply({ content: `Database Error: ${userErr.message}`, ephemeral: true });
            
            const user = users && users.length > 0 ? users[0] : null;
            if (!user) return interaction.reply({ content: "You need to `/link` your API key first!", ephemeral: true });

            const { data: scripts } = await supabase.from('scripts').select('id, name').eq('api_key', user.api_key);
            if (!scripts || scripts.length === 0) return interaction.reply({ content: "You don't have any projects to generate keys for.", ephemeral: true });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`createkey_select_${days}`)
                .setPlaceholder('Select a project')
                .addOptions(scripts.map(s => ({
                    label: s.name,
                    value: s.id,
                    description: `ID: ${s.id}`
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            interaction.reply({ content: '👇 **Select the project you want to generate a key for:**', components: [row], ephemeral: true });
        }

        // --- /RESETHWID COMMAND ---
        if (interaction.commandName === 'resethwid') {
            const key = interaction.options.getString('key');
            
            const { data: keyData } = await supabase.from('script_keys').select('script_id').eq('key', key).limit(1);
            if (!keyData || keyData.length === 0) return interaction.reply({ content: "Key not found.", ephemeral: true });

            const { data: script } = await supabase.from('scripts').select('api_key').eq('id', keyData[0].script_id).limit(1);
            const { data: owner } = await supabase.from('users').select('discord_id, manager_role_id').eq('api_key', script[0].api_key).limit(1);

            const isOwner = owner && owner.length > 0 && interaction.user.id === owner[0].discord_id;
            const hasManagerRole = owner && owner.length > 0 && owner[0].manager_role_id && interaction.member.roles.cache.has(owner[0].manager_role_id);

            if (!isOwner && !hasManagerRole) return interaction.reply({ content: "❌ You do not have permission.", ephemeral: true });

            await supabase.from('script_keys').update({ hwid: null }).eq('key', key);
            interaction.reply({ content: `✅ HWID reset for key \`${key}\`.`, ephemeral: true });
        }

        // --- /SETPANEL COMMAND ---
        if (interaction.commandName === 'setpanel') {
            const scriptId = interaction.options.getString('project');
            const managerRole = interaction.options.getRole('manager_role');
            const buyerRole = interaction.options.getRole('buyer_role');

            // Verify the user actually owns this project
            const { data: users } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).limit(1);
            if (!users || users.length === 0) return interaction.reply({ content: "You need to /link first!", ephemeral: true });
            
            const { data: script } = await supabase.from('scripts').select('name, api_key').eq('id', scriptId).limit(1);
            if (!script || script.length === 0 || script[0].api_key !== users[0].api_key) {
                return interaction.reply({ content: "❌ You don't own this project.", ephemeral: true });
            }

            // Build the Embed
            const embed = new EmbedBuilder()
                .setTitle(`${script[0].name} Control Panel`)
                .setDescription(`This control panel is for the project: **${script[0].name}**\nIf you're a buyer, click on the buttons below to redeem your key, get the script or get your role.`)
                .setColor(0xf5c518) // Gold line on the left
                .setFooter({ text: `Sent by ${interaction.user.username} • ${new Date().toLocaleDateString()}` });

            // Build the Buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('panel_redeem')
                        .setLabel('Redeem Key')
                        .setEmoji('🗝️')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('panel_script')
                        .setLabel('Get Script')
                        .setEmoji('📜')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('panel_role')
                        .setLabel('Get Role')
                        .setEmoji('👤')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('panel_reset')
                        .setLabel('Reset HWID')
                        .setEmoji('⚙️')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('panel_stats')
                        .setLabel('Get Stats')
                        .setEmoji('📊')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send the panel to the channel
            await interaction.channel.send({ embeds: [embed], components: [row] });
            interaction.reply({ content: "✅ Panel successfully created!", ephemeral: true });
        }
    }

    // ==========================================
    // DROPDOWN MENU & BUTTON HANDLERS
    // ==========================================
    
    // Handle /createkey Dropdown
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('createkey_select_')) {
            const days = parseInt(interaction.customId.replace('createkey_select_', ''));
            const scriptId = interaction.values[0];

            const key = "LXR-KEY-" + crypto.randomBytes(4).toString('hex').toUpperCase();
            const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

            const { error } = await supabase.from('script_keys').insert({ key, script_id: scriptId, expires_at: expiresAt });
            if (error) return interaction.update({ content: "Database error: " + error.message, components: [] });

            const { data: scriptData } = await supabase.from('scripts').select('name').eq('id', scriptId).limit(1);

            const embed = new EmbedBuilder()
                .setTitle('🔑 Key Generated')
                .setColor(0xf5c518)
                .addFields(
                    { name: 'Project', value: scriptData && scriptData[0] ? scriptData[0].name : 'Unknown', inline: true },
                    { name: 'Key', value: `\`${key}\``, inline: true },
                    { name: 'Expires In', value: `${days} days`, inline: false }
                );

            interaction.update({ content: null, embeds: [embed], components: [] });
        }
    }

    // Handle Panel Buttons
    if (interaction.isButton()) {
        // This catches all the buttons on the panel we just made
        if (interaction.customId.startsWith('panel_')) {
            return interaction.reply({ 
                content: "🚧 This feature is currently under construction and will be available soon!", 
                ephemeral: true 
            });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
