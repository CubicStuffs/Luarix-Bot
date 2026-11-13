require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const express = require('express');

// ==========================================
// 1. KEEP RENDER AWAKE
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Luarix Bot is Online!'));
app.listen(process.env.PORT || 3000, () => {
    console.log('Web server running to keep Render alive.');
});

// ==========================================
// 2. SETUP SUPABASE & DISCORD
// ==========================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// We need GuildMembers intent to read what roles a user has
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ==========================================
// 3. DEFINE SLASH COMMANDS
// ==========================================
const commands = [
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Luarix API Key to your Discord account')
        .addStringOption(opt => opt.setName('api_key').setDescription('Your LXR-... API Key').setRequired(true))
        .addRoleOption(opt => opt.setName('manager_role').setDescription('The role allowed to generate keys for your scripts').setRequired(false)),
    new SlashCommandBuilder()
        .setName('projects')
        .setDescription('View your Luarix projects'),
    new SlashCommandBuilder()
        .setName('createkey')
        .setDescription('Generate a new script key')
        .addStringOption(opt => opt.setName('script_id').setDescription('The ID of the script').setRequired(true))
        .addIntegerOption(opt => opt.setName('days').setDescription('Days until expiry').setRequired(true)),
    new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reset the HWID of a key')
        .addStringOption(opt => opt.setName('key').setDescription('The script key').setRequired(true))
].map(cmd => cmd.toJSON());

// ==========================================
// 4. REGISTER COMMANDS ON STARTUP
// ==========================================
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded GLOBAL application (/) commands.');
    } catch (error) {
        console.error("Error registering commands:", error);
    }
});

// ==========================================
// 5. HANDLE COMMANDS
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- /LINK COMMAND ---
    if (interaction.commandName === 'link') {
        const apiKey = interaction.options.getString('api_key');
        const role = interaction.options.getRole('manager_role');
        const roleId = role ? role.id : null;

        const { data: user, error } = await supabase.from('users').select('*').eq('api_key', apiKey).single();

        if (error && error.code !== 'PGRST116') return interaction.reply({ content: "Database error.", ephemeral: true });

        if (user) {
            await supabase.from('users').update({ discord_id: interaction.user.id, manager_role_id: roleId }).eq('api_key', apiKey);
            return interaction.reply({ content: `✅ Successfully linked to API Key \`${apiKey}\`. \nManager Role: ${role ? role.name : "None"}`, ephemeral: true });
        } else {
            await supabase.from('users').insert({ api_key: apiKey, discord_id: interaction.user.id, manager_role_id: roleId });
            return interaction.reply({ content: `✅ Successfully created and linked to API Key \`${apiKey}\`. \nManager Role: ${role ? role.name : "None"}`, ephemeral: true });
        }
    }

    // --- /PROJECTS COMMAND ---
    if (interaction.commandName === 'projects') {
        const { data: user } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).single();
        if (!user) return interaction.reply({ content: "You need to `/link` your API key first!", ephemeral: true });

        const { data: scripts } = await supabase.from('scripts').select('id, name, keyless').eq('api_key', user.api_key);
        if (!scripts || scripts.length === 0) return interaction.reply({ content: "You don't have any projects yet.", ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('📁 Your Luarix Projects')
            .setColor(0xf5c518)
            .setDescription(scripts.map(s => `**${s.name}**\nID: \`${s.id}\`\nKeyless: ${s.keyless ? '✅' : '❌'}`).join('\n\n'));

        interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- /CREATEKEY COMMAND ---
    if (interaction.commandName === 'createkey') {
        const scriptId = interaction.options.getString('script_id');
        const days = interaction.options.getInteger('days');

        // 1. Find who owns this script
        const { data: script } = await supabase.from('scripts').select('api_key').eq('id', scriptId).single();
        if (!script) return interaction.reply({ content: "Script ID not found.", ephemeral: true });

        // 2. Find the owner's Discord info
        const { data: owner } = await supabase.from('users').select('discord_id, manager_role_id').eq('api_key', script.api_key).single();

        // 3. Check permissions
        const isOwner = interaction.user.id === owner.discord_id;
        const hasManagerRole = owner.manager_role_id && interaction.member.roles.cache.has(owner.manager_role_id);

        if (!isOwner && !hasManagerRole) {
            return interaction.reply({ content: "❌ You do not have permission to generate keys for this script.", ephemeral: true });
        }

        // 4. Generate Key
        const key = "LXR-KEY-" + crypto.randomBytes(4).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

        const { error } = await supabase.from('script_keys').insert({ key, script_id: scriptId, expires_at: expiresAt });
        if (error) return interaction.reply({ content: "Database error: " + error.message, ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('🔑 Key Generated')
            .setColor(0xf5c518)
            .addFields({ name: 'Key', value: `\`${key}\`` }, { name: 'Expires In', value: `${days} days` });

        interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- /RESETHWID COMMAND ---
    if (interaction.commandName === 'resethwid') {
        const key = interaction.options.getString('key');

        // 1. Find the script this key belongs to
        const { data: keyData } = await supabase.from('script_keys').select('script_id').eq('key', key).single();
        if (!keyData) return interaction.reply({ content: "Key not found.", ephemeral: true });

        // 2. Find the owner of the script
        const { data: script } = await supabase.from('scripts').select('api_key').eq('id', keyData.script_id).single();
        const { data: owner } = await supabase.from('users').select('discord_id, manager_role_id').eq('api_key', script.api_key).single();

        // 3. Check permissions
        const isOwner = interaction.user.id === owner.discord_id;
        const hasManagerRole = owner.manager_role_id && interaction.member.roles.cache.has(owner.manager_role_id);

        if (!isOwner && !hasManagerRole) {
            return interaction.reply({ content: "❌ You do not have permission to reset this key.", ephemeral: true });
        }

        // 4. Reset HWID
        await supabase.from('script_keys').update({ hwid: null }).eq('key', key);
        interaction.reply({ content: `✅ HWID reset for key \`${key}\`.`, ephemeral: true });
    }
});

// ==========================================
// 6. LOG IN
// ==========================================
client.login(process.env.DISCORD_TOKEN);
