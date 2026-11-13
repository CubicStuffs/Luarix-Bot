require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const express = require('express');

// Web server to keep Render awake
const app = express();
app.get('/', (req, res) => res.send('Luarix Bot is Online!'));
app.listen(process.env.PORT || 3000);

// Supabase setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Luarix API Key to your Discord account')
        .addStringOption(opt => opt.setName('api_key').setDescription('Your LXR-... API Key').setRequired(true)),
    new SlashCommandBuilder()
        .setName('projects')
        .setDescription('View your Luarix projects'),
    new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reset the HWID of a key')
        .addStringOption(opt => opt.setName('key').setDescription('The script key').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // 1. LINK COMMAND
    if (interaction.commandName === 'link') {
        const apiKey = interaction.options.getString('api_key');
        
        // Check if key exists in users table, or create it
        const { data: user, error } = await supabase.from('users').select('*').eq('api_key', apiKey).single();

        if (error && error.code !== 'PGRST116') {
            return interaction.reply({ content: "Database error.", ephemeral: true });
        }

        if (user) {
            // Update existing user with Discord ID
            await supabase.from('users').update({ discord_id: interaction.user.id }).eq('api_key', apiKey);
            return interaction.reply({ content: `✅ Successfully linked your account to API Key \`${apiKey}\`.`, ephemeral: true });
        } else {
            // Create a new user record if they are the first to link it
            await supabase.from('users').insert({ api_key: apiKey, discord_id: interaction.user.id });
            return interaction.reply({ content: `✅ Successfully linked and created your account with API Key \`${apiKey}\`.`, ephemeral: true });
        }
    }

    // 2. PROJECTS COMMAND
    if (interaction.commandName === 'projects') {
        // Find user's API key by Discord ID
        const { data: user } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).single();
        
        if (!user) return interaction.reply({ content: "You need to `/link` your API key first!", ephemeral: true });

        // Fetch scripts belonging to this API key
        const { data: scripts } = await supabase.from('scripts').select('id, name, keyless').eq('api_key', user.api_key);

        if (!scripts || scripts.length === 0) {
            return interaction.reply({ content: "You don't have any projects yet. Create one on the dashboard!", ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('📁 Your Luarix Projects')
            .setColor(0xf5c518)
            .setDescription(scripts.map(s => `**${s.name}**\nID: \`${s.id}\`\nKeyless: ${s.keyless ? '✅' : '❌'}`).join('\n\n'));

        interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // 3. RESET HWID COMMAND
    if (interaction.commandName === 'resethwid') {
        const key = interaction.options.getString('key');

        const { data: user } = await supabase.from('users').select('api_key').eq('discord_id', interaction.user.id).single();
        if (!user) return interaction.reply({ content: "You need to `/link` your API key first!", ephemeral: true });

        // Check if the key belongs to a script owned by this user
        const { data: keyData } = await supabase.from('script_keys').select('script_id').eq('key', key).single();
        if (!keyData) return interaction.reply({ content: "Key not found.", ephemeral: true });

        const { data: script } = await supabase.from('scripts').select('api_key').eq('id', keyData.script_id).single();
        if (script.api_key !== user.api_key) return interaction.reply({ content: "This key doesn't belong to your account!", ephemeral: true });

        // Reset HWID
        await supabase.from('script_keys').update({ hwid: null }).eq('key', key);
        interaction.reply({ content: `✅ HWID reset for \`${key}\`.`, ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
