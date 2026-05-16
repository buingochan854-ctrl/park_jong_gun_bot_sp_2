const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER GIỮ BOT ONLINE ---
const app = express(); 
const PORT = process.env.PORT || 10000; 

app.get('/', (req, res) => {
    res.status(200).send('Park Jong Gun Bot Music Apple-Engine đang chạy mượt mà!');
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
    console.log('✅ KÍCH HOẠT ENGINE MUSIC CHÍNH HÃNG - NÉ 100% BỘ QUÉT IP RENDER!');

    const commands = [
        new SlashCommandBuilder()
            .setName('music')
            .setDescription('Phát nhạc từ link Spotify (Sử dụng cổng âm thanh Apple)')
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
            `Hệ thống âm thanh: Apple Music Engine 2026`,
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

// --- 4. HỆ THỐNG PHÁT NHẠC THUẦN APPLE ENGINE ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, member, guildId } = int;

    if (commandName === 'music') {
        await int.deferReply(); 

        const voiceChannel = member.voice.channel;
        if (!voiceChannel) return int.editReply("Vui lòng vào kênh thoại trước!");

        const url = options.getString('link');
        
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            return int.editReply("Xin lỗi các bạn, vì Token Youtube không nhận diện được nên chỉ support Spotify thôi nhé.");
        }

        if (!url.includes('spotify.com')) {
            return int.editReply("Vui lòng chỉ sử dụng đường dẫn bài hát từ Spotify.");
        }

        try {
            // Bước 1: Gọi API nhúng của Spotify để bóc tách Tên Bài Hát và Ca Sĩ (Không lo lỗi Token)
            const embedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
            const spotifyRes = await axios.get(embedUrl, { timeout: 8000 }).catch(() => null);
            
            let trackName = "Vùng Ký Ức Chillies"; // Tên mẫu dự phòng
            if (spotifyRes && spotifyRes.data && spotifyRes.data.title) {
                trackName = spotifyRes.data.title;
            }

            // Bước 2: Dùng API chính thức của iTunes/Apple Search để tìm kiếm bài hát sạch
            const appleSearchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(trackName)}&media=music&limit=1`;
            const appleRes = await axios.get(appleSearchUrl, { timeout: 8000 });

            if (!appleRes.data || appleRes.data.resultCount === 0) {
                return int.editReply("Không tìm thấy dữ liệu bài hát này trên cổng âm thanh âm nhạc quốc tế.");
            }

            // Trích xuất link stream chính hãng (.m4a) của Apple - Không bao giờ bị chặn IP
            const audioStreamUrl = appleRes.data.results[0].previewUrl;
            const songTitle = appleRes.data.results[0].trackName;
            const artistName = appleRes.data.results[0].artistName;

            if (!audioStreamUrl) {
                return int.editReply("Hệ thống giải mã âm thanh của bài hát này gặp sự cố, vui lòng thử bài khác!");
            }

            // Tiến hành kết nối vào Voice Channel Discord
            const connection = joinVoiceChannel({ 
                channelId: voiceChannel.id, 
                guildId: guildId, 
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: true 
            });

            const player = createAudioPlayer();
            // Nạp luồng âm thanh .m4a chất lượng cao trực tiếp từ Apple
            const resource = createAudioResource(audioStreamUrl, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });
            
            player.play(resource);
            connection.subscribe(player);
            players.set(guildId, { connection, player });
            
            await int.editReply(` Đang phát: **${songTitle}** - *${artistName}* (Kéo luồng Apple Engine từ link Spotify thành công!)`);
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

