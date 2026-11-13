require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const express = require('express');

// 1. Setup Express Web Server (Keeps the bot alive on Render)
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Luarix Bot is Online!'));
app.listen(port, () => console.log(`Web server running on port ${port}`));

// 2. Setup Supabase (Uses Environment Variables for security)
// You will add these variables in the Render dashboard
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 3. Setup Discord Bot
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// 4. Define Slash Commands
const commands = [
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

// 5. Register Commands when Bot Starts
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error(error);
    }
});

// 6. Handle Slash Commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // CREATE KEY COMMAND
    if (interaction.commandName === 'createkey') {
        const scriptId = interaction.options.getString('script_id');
        const days = interaction.options.getInteger('days');
        
        // Generate a random 16-character key
        const key = crypto.randomBytes(8).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

        // Save to Supabase Database
        const { error } = await supabase.from('script_keys').insert({ 
            key: key, 
            script_id: scriptId, 
            expires_at: expiresAt 
        });

        if (error) {
            return interaction.reply({ content: "Database error: " + error.message, ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔑 Key Generated')
            .setColor(0xf5c518)
            .addFields(
                { name: 'Key', value: `\`${key}\`` },
                { name: 'Expires In', value: `${days} days` }
            )
            .setFooter({ text: 'Luarix Key System' });
            
        interaction.reply({ embeds: [embed] });
    }

    // RESET HWID COMMAND
    if (interaction.commandName === 'resethwid') {
        const key = interaction.options.getString('key');
        
        // Update the key in Supabase to remove the HWID
        const { data, error } = await supabase
            .from('script_keys')
            .update({ hwid: null })
            .eq('key', key)
            .select();

        if (error || data.length === 0) {
            return interaction.reply({ content: "Key not found or already reset!", ephemeral: true });
        }

        interaction.reply({ 
            content: `✅ HWID successfully reset for key \`${key}\`. They can now use it on a new device.`, 
            ephemeral: true 
        });
    }
});

// 7. Log in to Discord
client.login(process.env.DISCORD_TOKEN);
