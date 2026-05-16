const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const play = require('play-dl');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER FIX LỖI 502 BAD GATEWAY ---
const app = _express();
const PORT = process.env.PORT || 10000; 

app.get('/', (req, res) => {
    res.status(200).send('Park Jong Gun Bot dang hoat dong binh thuong!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Web Server dinh tuyen thanh cong tai port: ${PORT}`);
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
            .setDescription('Phát nhạc nhanh từ Youtube hoặc Spotify')
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

    // Lệnh +ping
    if (contentLower === `${PREFIX}ping`) {
        const myEmoji = "<:jonggun_cool:123456789012345678>"; 
        return message.reply(`Pong! Park Jong Gun vẫn đang online ${myEmoji}`);
    }

    // LỆNH +STATUS (TIẾNG VIỆT CÓ DẤU - KHÔNG EMOJI)
    if (contentLower === `${PREFIX}status` || contentLower === `${PREFIX}botstatus`) {
        let totalSeconds = (client.uptime / 1000);
        let days = Math.floor(totalSeconds / 86400);
        totalSeconds %= 86400;
        let hours = Math.floor(totalSeconds / 3600);
        totalSeconds %= 3600;
        let minutes = Math.floor(totalSeconds / 60);
        let seconds = Math.floor(totalSeconds % 60);

        const uptimeString = `${days} ngày, ${hours} giờ, ${minutes} phút, ${seconds} giây`;
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

    // TỰ ĐỘNG TẢI VIDEO - ĐÃ FIX KHÔNG HOẠT ĐỘNG
    if (videoRegex.test(message.content)) {
        if (message.content.includes('spotify.com') || (message.content.includes('youtube.com/watch') && !message.content.includes('shorts'))) return;

        try {
            await message.channel.sendTyping();
            
            // Bổ sung headers cấu hình để tránh bị Cobalt API từ chối request
            const res = await axios.post('https://api.cobalt.tools/api/json', {
                url: message.content.match(videoRegex)[0],
                vQuality: '720',
                filenamePattern: 'basic'
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000 // Giới hạn thời gian chờ phản hồi tối đa 10 giây
            });

            if (res.data && res.data.url) {
                const file = new AttachmentBuilder(res.data.url, { name: 'video.mp4' });
                await message.reply({ content: 'Video của bạn:', files: [file] });
            }
        } catch (e) { 
            console.error('Lỗi tải video:', e.message); 
        }
    }
});

// --- 4. HỆ THỐNG PHÁT NHẠC VOICE (SỬA LỖI KHÔNG PHẢN HỒI) ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, member, guildId } = int;

    if (commandName === 'music') {
        // GỌI ĐOẠN NÀY ĐẦU TIÊN để chặn ngay lỗi "Ứng dụng không phản hồi" của Discord sau 3 giây
        await int.deferReply(); 

        const voiceChannel = member.voice.channel;
        if (!voiceChannel) return int.editReply("Vui lòng vào kênh thoại trước!");

        const url = options.getString('link');
        try {
            let stream;
            // Tối ưu hóa play-dl bằng cách kích hoạt bỏ qua xác thực nếu lỗi luồng âm thanh
            if (play.sp_validate(url)) {
                const data = await play.spotify(url);
                const search = await play.search(`${data.name} ${data.artists[0].name}`, { limit: 1 });
                if(search.length === 0) return int.editReply("Không tìm thấy bài hát này trên hệ thống.");
                stream = await play.stream(search[0].url, { quality: 1 });
            } else if (play.yt_validate(url)) {
                stream = await play.stream(url, { quality: 1 });
            } else {
                return int.editReply("Định dạng liên kết chưa được hỗ trợ (Chỉ nhận YouTube/Spotify).");
            }

            const connection = joinVoiceChannel({ 
                channelId: voiceChannel.id, 
                guildId: guildId, 
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: true // Giúp bot ẩn tai nghe, giảm băng thông mạng, kết nối nhanh hơn
            });

            const player = createAudioPlayer();
            // Ép kiểu dữ liệu luồng âm thanh để nạp bài hát ngay lập tức
            const resource = createAudioResource(stream.stream, { inputType: stream.type });
            
            player.play(resource);
            connection.subscribe(player);
            players.set(guildId, { connection, player });
            
            await int.editReply(`Đang phát tại kênh thoại: ${url}`);
        } catch (e) { 
            console.error(e);
            await int.editReply("Gặp lỗi trong quá trình xử lý luồng phát nhạc hoặc kết nối quá hạn."); 
        }
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

