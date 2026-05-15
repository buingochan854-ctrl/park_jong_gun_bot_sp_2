const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const play = require('play-dl');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER FIX LỖI 502 BAD GATEWAY ---
const app = express();
const PORT = process.env.PORT || 10000; 

app.get('/', (req, res) => {
    res.status(200).send('Park Jong Gun Bot đang hoạt động bình thường!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Web Server định tuyến thành công tại port: ${PORT}`);
});

// --- 2. CẤU HÌNH BOT DISCORD ---
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
const videoRegex = /https?:\/\/(www\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/\S+/i;

client.on('clientReady', async () => {
    console.log(`🚀 Bot Online: ${client.user.tag}`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('music')
            .setDescription('Phát nhạc từ Youtube hoặc Spotify')
            .addStringOption(opt => opt.setName('link').setDescription('Liên kết bài hát').setRequired(true)),
        new SlashCommandBuilder()
            .setName('musicoff')
            .setDescription('Tắt nhạc và rời khỏi kênh thoại')
    ];

    try {
        await client.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Đã cập nhật xong hệ thống lệnh Slash');
    } catch (err) { console.error('Lỗi nạp lệnh Slash:', err); }
});

// --- 3. LỆNH PREFIX & TỰ ĐỘNG TẢI VIDEO ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const contentLower = message.content.toLowerCase();

    // Lệnh +ping (Có thể giữ lại emoji riêng của bạn)
    if (contentLower === `${PREFIX}ping`) {
        const myEmoji = "<:jonggun_cool:123456789012345678>"; 
        return message.reply(`Pong! Park Jong Gun vẫn đang online ${myEmoji}`);
    }

    // LỆNH +STATUS (TIẾNG VIỆT CÓ DẤU - KHÔNG EMOJI)
    if (contentLower === `${PREFIX}status` || contentLower === `${PREFIX}botstatus`) {
        // Tính toán thời gian hoạt động (Uptime)
        let totalSeconds = (client.uptime / 1000);
        let days = Math.floor(totalSeconds / 86400);
        totalSeconds %= 86400;
        let hours = Math.floor(totalSeconds / 3600);
        totalSeconds %= 3600;
        let minutes = Math.floor(totalSeconds / 60);
        let seconds = Math.floor(totalSeconds % 60);

        const uptimeString = `${days} ngày, ${hours} giờ, ${minutes} phút, ${seconds} giây`;
        
        // Tính toán lượng RAM sử dụng
        const memoryUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

        const statusMessage = [
            "--- TRẠNG THÁI HOẠT ĐỘNG ---",
            `Tên Bot: ${client.user.tag}`,
            `Thời gian online: ${uptimeString}`,
            `Bộ nhớ RAM đang dùng: ${memoryUsed} MB`,
            `Số lượng server hỗ trợ: ${client.guilds.cache.size}`,
            `Trạng thái kết nối: Ổn định`,
            "----------------------------"
        ].join('\n');

        return message.reply(statusMessage);
    }

    // Nhận diện và tải video tự động
    if (videoRegex.test(message.content)) {
        if (message.content.includes('spotify.com') || (message.content.includes('youtube.com/watch') && !message.content.includes('shorts'))) return;

        try {
            await message.channel.sendTyping();
            const res = await axios.post('https://api.cobalt.tools/api/json', { url: message.content.match(videoRegex)[0], vQuality: '720' });
            if (res.data?.url) {
                const file = new AttachmentBuilder(res.data.url, { name: 'video.mp4' });
                await message.reply({ content: 'Video của bạn:', files: [file] });
            }
        } catch (e) { console.log('Lỗi nhận diện hoặc tải video thất bại.'); }
    }
});

// --- 4. HỆ THỐNG PHÁT NHẠC VOICE ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, member, guildId } = int;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) return int.reply({ content: "Vui lòng vào kênh thoại trước!", ephemeral: true });

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
            } else {
                return int.editReply("Định dạng liên kết chưa được hỗ trợ.");
            }

            const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guildId, adapterCreator: voiceChannel.guild.voiceAdapterCreator });
            const player = createAudioPlayer();
            player.play(createAudioResource(stream.stream, { inputType: stream.type }));
            connection.subscribe(player);
            players.set(guildId, { connection, player });
            await int.editReply(`Đang phát tại kênh thoại: ${url}`);
        } catch (e) { await int.editReply("Gặp lỗi trong quá trình xử lý luồng phát nhạc."); }
    }

    if (commandName === 'musicoff') {
        const session = players.get(guildId);
        if (session) {
            session.connection.destroy();
            players.delete(guildId);
            await int.reply("Đã dừng phát nhạc và ngắt kết nối.");
        } else {
            await int.reply({ content: "Bot hiện không phát nhạc ở server này.", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
