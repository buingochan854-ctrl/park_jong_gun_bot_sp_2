const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER GIỮ BOT ONLINE ---
const app = express(); 
const PORT = process.env.PORT || 10000; 

app.get('/', (req, res) => {
    res.status(200).send('Park Jong Gun Bot Music chuẩn Spotify đang chạy!');
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
    console.log('✅ Đã loại bỏ hoàn toàn play-dl để né bộ quét IP!');

    const commands = [
        new SlashCommandBuilder()
            .setName('music')
            .setDescription('Phát nhạc từ link Spotify chuẩn')
            .addStringOption(opt => opt.setName('link').setDescription('Liên kết bài hát Spotify').setRequired(true)),
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
        return message.reply(`Pong! Park Jong Gun vẫn đang online `);
    }

    // LỆNH +STATUS
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
            `Hệ thống âm thanh: Thuần API mã nguồn mở`,
            "----------------------------"
        ].join('\n');

        return message.reply(statusMessage);
    }

    // TỰ ĐỘNG TẢI VIDEO
    if (videoRegex.test(message.content)) {
        if (message.content.includes('spotify.com/track') || (message.content.includes('youtube.com/watch') && !message.content.includes('shorts'))) return;

        try {
            await message.channel.sendTyping();
            const res = await axios.post('https://api.cobalt.tools/api/json', {
                url: message.content.match(videoRegex)[0],
                vQuality: '720',
                filenamePattern: 'basic'
            }, {
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                timeout: 10000
            });

            if (res.data && res.data.url) {
                const file = new AttachmentBuilder(res.data.url, { name: 'video.mp4' });
                await message.reply({ content: 'Video của bạn:', files: [file] });
            }
        } catch (e) { console.error('Lỗi tải video:', e.message); }
    }
});

// --- 4. HỆ THỐNG PHÁT NHẠC VOICE THUẦN API CHUYÊN DỤNG ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, member, guildId } = int;

    if (commandName === 'music') {
        await int.deferReply(); 

        const voiceChannel = member.voice.channel;
        if (!voiceChannel) return int.editReply("Vui lòng vào kênh thoại trước!");

        const url = options.getString('link');
        
        // Chặn link YouTube ngay lập tức
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            return int.editReply("Xin lỗi các bạn, vì Token Youtube không nhận diện được nên chỉ support Spotify thôi nhé.");
        }

        if (!url.includes('spotify.com')) {
            return int.editReply("Vui lòng chỉ sử dụng đường dẫn bài hát từ Spotify.");
        }

        try {
            // SỬ DỤNG ENGINE GIẢI MÃ NHẠC SPOTIFY TRỰC TIẾP QUA API DOWNLOAD ĐỘC LẬP
            // API này tự động bóc liên kết Spotify thành file phát stream nhạc trực tiếp (.mp3) không thông qua YouTube quét IP
            const encodeUrl = encodeURIComponent(url);
            const downloadApiUrl = `https://api.spotifydownloader.com/download?link=${encodeUrl}`;
            
            const apiResponse = await axios.get(downloadApiUrl, { timeout: 10000 }).catch(() => null);
            
            let audioStreamUrl = null;
            if (apiResponse && apiResponse.data && apiResponse.data.success) {
                audioStreamUrl = apiResponse.data.link; // Trích xuất link stream mp3 trực tiếp từ server nhạc
            }

            // Phương án dự phòng 2 qua API Cobalt âm thanh tự do nếu API trên bảo trì
            if (!audioStreamUrl) {
                const cobaltRes = await axios.post('https://api.cobalt.tools/api/json', {
                    url: url,
                    downloadMode: 'audio',
                    audioFormat: 'mp3'
                }, {
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    timeout: 10000
                }).catch(() => null);

                if (cobaltRes && cobaltRes.data && cobaltRes.data.url) {
                    audioStreamUrl = cobaltRes.data.url;
                }
            }

            if (!audioStreamUrl) {
                return int.editReply("Hệ thống giải mã bài hát này đang bận hoặc link không được hỗ trợ, vui lòng thử lại sau giây lát!");
            }

            // Tiến hành kết nối vào Voice Channel Discord
            const connection = joinVoiceChannel({ 
                channelId: voiceChannel.id, 
                guildId: guildId, 
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: true 
            });

            const player = createAudioPlayer();
            // Nạp trực tiếp luồng URL âm thanh sạch (.mp3) vào Resource phát nhạc
            const resource = createAudioResource(audioStreamUrl, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });
            
            player.play(resource);
            connection.subscribe(player);
            players.set(guildId, { connection, player });
            
            await int.editReply(` Đang giải mã luồng và phát bài hát từ Spotify của bạn!`);
        } catch (e) { 
            console.error('Lỗi hệ thống phát nhạc:', e.message);
            await int.editReply("Gặp lỗi trong quá trình kết nối đến luồng nhạc, vui lòng thử lại bài hát này."); 
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
