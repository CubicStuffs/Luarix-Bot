require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// 🚨 IMPORTANT: Put your Discord Server ID here so commands appear INSTANTLY
// (Right-click your server icon -> Copy Server ID)
const GUILD_ID = "YOUR_SERVER_ID_HERE";

// ==========================================
// 3. DEFINE SLASH COMMANDS
// ==========================================
const commands = [
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Luarix API Key to your Discord account')
        .addStringOption(opt => opt.setName('api_key').setDescription('Your LXR-... API Key').setRequired(true)),
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
// 4. REGISTER COMMANDS ON STARTUP (GLOBAL)
// ==========================================
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Started refreshing GLOBAL application (/) commands.');
        
        // THIS IS GLOBAL: Works for everyone who invites the bot
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        
        console.log('Successfully reloaded global (/) commands.');
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
        const { data: user, error } = await supabase.from('users').select('*').eq('api_key', apiKey).single();

        if (error && error.code !== 'PGRST116') return interaction.reply({ content: "Database error.", ephemeral: true });

        if (user) {
            await supabase.from('users').update({ discord_id: interaction.user.id }).eq('api_key', apiKey);
            return interaction.reply({ content: `✅ Successfully linked your account to API Key \`${apiKey}\`.`, ephemeral: true });
        } else {
            await supabase.from('users').insert({ api_key: apiKey, discord_id: interaction.user.id });
            return interaction.reply({ content: `✅ Successfully linked and created your account with API Key \`${apiKey}\`.`, ephemeral: true });
        }
    }

    // --- /PROJECTS COMMAND ---
    if (interaction.commandName === 'projects') {
        const { data: user } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).single();
        if (!user) return interaction.reply({ content: "You need to `/link` your API key first!", ephemeral: true });

        const { data: scripts } = await supabase.from('scripts').select('id, name, keyless').eq('api_key', user.api_key);
        if (!scripts || scripts.length === 0) return interaction.reply({ content: "You don't have any projects yet. Create one on the website!", ephemeral: true });

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
        const key = crypto.randomBytes(8).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

        const { error } = await supabase.from('script_keys').insert({ key, script_id: scriptId, expires_at: expiresAt });
        if (error) return interaction.reply({ content: "Database error: " + error.message, ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('🔑 Key Generated')
            .setColor(0xf5c518)
            .addFields({ name: 'Key', value: `\`${key}\`` }, { name: 'Expires In', value: `${days} days` });
        interaction.reply({ embeds: [embed] });
    }

    // --- /RESETHWID COMMAND ---
    if (interaction.commandName === 'resethwid') {
        const key = interaction.options.getString('key');
        const { data, error } = await supabase.from('script_keys').update({ hwid: null }).eq('key', key).select();
        
        if (error || data.length === 0) return interaction.reply({ content: "Key not found!", ephemeral: true });
        interaction.reply({ content: `✅ HWID reset for key \`${key}\`.`, ephemeral: true });
    }
});

// ==========================================
// 6. LOG IN
// ==========================================
client.login(process.env.DISCORD_TOKEN);
