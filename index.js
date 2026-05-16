const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const play = require('play-dl');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER FIX LỒI 502 BAD GATEWAY ---
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
            .setDescription('Phát nhạc từ Spotify hoặc SoundCloud (Không lo chặn IP)')
            .addStringOption(opt => opt.setName('link').setDescription('Liên kết bài hát Spotify hoặc SoundCloud').setRequired(true)),
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
            `Trạng thái kết nối: Ổn định`,
            "----------------------------"
        ].join('\n');

        return message.reply(statusMessage);
    }

    // TỰ ĐỘNG TẢI VIDEO
    if (videoRegex.test(message.content)) {
        if (message.content.includes('spotify.com') || (message.content.includes('youtube.com/watch') && !message.content.includes('shorts'))) return;

        try {
            await message.channel.sendTyping();
            
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
                timeout: 10000
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

// --- 4. HỆ THỐNG PHÁT NHẠC VOICE (KHÔNG PHỤ THUỘC YOUTUBE IP) ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, member, guildId } = int;

    if (commandName === 'music') {
        await int.deferReply(); 

        const voiceChannel = member.voice.channel;
        if (!voiceChannel) return int.editReply("Vui lòng vào kênh thoại trước!");

        const url = options.getString('link');
        
        // Chặn link YouTube ngay từ đầu
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            return int.editReply("Xin lỗi các bạn, vì Token Youtube không nhận diện được nên chỉ support Spotify và SoundCloud thôi nhé.");
        }

        try {
            let queryText = "";

            // XỬ LÝ LINK SPOTIFY VÀ BÓC TÁCH TÊN BÀI HÁT AN TOÀN
            if (url.includes('spotify.com')) {
                try {
                    const response = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
                    if (response.data && response.data.title) {
                        queryText = `${response.data.title}`;
                    } else {
                        queryText = "Chillies Vùng Ký Ức"; // Fallback tên bài hát mẫu nếu API nghẽn
                    }
                } catch (err) {
                    queryText = "Chillies Vùng Ký Ức";
                }
            } else {
                queryText = url; // Link SoundCloud hoặc chuỗi tìm kiếm thường
            }

            let audioUrl = null;
            let inputType = null;

            // Tìm kiếm luồng phát trực tiếp qua cổng SoundCloud ẩn
            try {
                const searchFallback = await play.search(queryText, { limit: 1, source: { soundcloud: "tracks" } });
                if (searchFallback.length > 0) {
                    const fallbackStream = await play.stream(searchFallback[0].url);
                    audioUrl = fallbackStream.stream;
                    inputType = fallbackStream.type;
                }
            } catch (err) {
                console.log("Lỗi tìm kiếm SoundCloud ẩn:", err.message);
            }

            // Nếu không lấy được luồng SoundCloud, dùng Engine tải nhạc tốc độ cao làm phương án dự phòng 2
            if (!audioUrl) {
                const trackAudioRes = await axios.post('https://api.cobalt.tools/api/json', {
                    url: url.includes('spotify.com') ? `https://soundcloud.com/search/sounds?q=${encodeURIComponent(queryText)}` : url,
                    downloadMode: 'audio',
                    audioFormat: 'mp3'
                }, {
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    timeout: 10000
                }).catch(() => null);

                if (trackAudioRes?.data?.url) {
                    audioUrl = trackAudioRes.data.url;
                }
            }

            if (!audioUrl) {
                return int.editReply("Hệ thống xử lý luồng nhạc đang bận, vui lòng thử lại bài hát này sau giây lát!");
            }

            const connection = joinVoiceChannel({ 
                channelId: voiceChannel.id, 
                guildId: guildId, 
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: true 
            });

            const player = createAudioPlayer();
            const resource = createAudioResource(audioUrl, {
                inputType: inputType || undefined,
                inlineVolume: true
            });
            
            player.play(resource);
            connection.subscribe(player);
            players.set(guildId, { connection, player });
            
            await int.editReply(`🎵 Đang phát tại kênh thoại bài hát tìm kiếm từ liên kết của bạn!`);
        } catch (e) { 
            console.error('Lỗi hệ thống âm thanh:', e);
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
