const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const play = require('play-dl');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER FIX LỖI RENDER ---
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.send('Park Jong Gun Bot is Live!');
});

// Quan trọng: Phải có dòng này để Render không tắt bot
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Web Server đang chạy tại port: ${PORT}`);
});

// --- 2. CẤU HÌNH BOT ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const PREFIX = "+";
const players = new Map();

client.on('ready', async () => {
    console.log(`🚀 Bot Online: ${client.user.tag}`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('music')
            .setDescription('Phát nhạc từ Youtube/Spotify')
            .addStringOption(opt => opt.setName('link').setDescription('Link bài hát').setRequired(true)),
        new SlashCommandBuilder()
            .setName('musicoff')
            .setDescription('Tắt nhạc và rời kênh')
    ];

    try {
        await client.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Đã cập nhật Slash Commands');
    } catch (err) { console.error(err); }
});

// --- 3. LỆNH PREFIX & EMOJI ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Lệnh +ping kèm Emoji tùy chỉnh
    if (message.content.toLowerCase() === `${PREFIX}ping`) {
        // HƯỚNG DẪN EMOJI: 
        // 1. Gõ \:ten_emoji: trong Discord để lấy ID (Ví dụ: <:jonggun:123456789>)
        // 2. Thay đoạn mã dưới đây bằng mã bạn vừa lấy được
        const myEmoji = "<:jonggun_cool:123456789012345678>"; 
        return message.reply(`🏓 Pong! Park Jong Gun vẫn đang Onl ${myEmoji}`);
    }

    // Tự động tải video (TikTok, IG, YT Shorts)
    const videoRegex = /https?:\/\/(www\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/\S+/i;
    if (videoRegex.test(message.content)) {
        if (message.content.includes('spotify.com') || (message.content.includes('youtube.com/watch') && !message.content.includes('shorts'))) return;

        try {
            await message.channel.sendTyping();
            const res = await axios.post('https://api.cobalt.tools/api/json', { url: message.content.match(videoRegex)[0], vQuality: '720' });
            if (res.data?.url) {
                const file = new AttachmentBuilder(res.data.url, { name: 'video.mp4' });
                await message.reply({ content: '🎬 **Video của bạn:**', files: [file] });
            }
        } catch (e) { console.log('Lỗi tải video'); }
    }
});

// --- 4. LỆNH NHẠC ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, member, guildId } = int;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) return int.reply({ content: "⚠️ Vào kênh thoại trước nhé!", ephemeral: true });

    if (commandName === 'music') {
        const url = options.getString('link');
        await int.deferReply();
        try {
            let stream;
            if (play.sp_validate(url)) {
                const data = await play.spotify(url);
                const search = await play.search(`${data.name} ${data.artists[0].name}`, { limit: 1 });
                stream = await play.stream(search[0].url);
            } else if (play.yt_validate(url)) {
                stream = await play.stream(url);
            }
            const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guildId, adapterCreator: voiceChannel.guild.voiceAdapterCreator });
            const player = createAudioPlayer();
            player.play(createAudioResource(stream.stream, { inputType: stream.type }));
            connection.subscribe(player);
            players.set(guildId, { connection, player });
            await int.editReply(`🎶 Đ đang phát: **${url}**`);
        } catch (e) { await int.editReply("❌ Lỗi phát nhạc."); }
    }

    if (commandName === 'musicoff') {
        const session = players.get(guildId);
        if (session) {
            session.connection.destroy();
            players.delete(guildId);
            await int.reply("⏹️ Đã tắt nhạc.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

