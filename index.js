const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER GIỮ BOT ONLINE ---
const app = express(); 
const PORT = process.env.PORT || 10000; 

app.get('/', (req, res) => {
    res.status(200).send('Park Jong Gun Bot Music FIX VOICE đang chạy!');
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
    console.log('✅ ĐÃ KÍCH HOẠT BẢN VÁ CỔNG UDP KEEP-ALIVE CHỐNG CÂM TIẾNG!');

    const commands = [
        new SlashCommandBuilder()
            .setName('music')
            .setDescription('Phát nhạc từ link Spotify')
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

    if (contentLower === `${PREFIX}ping`) {
        return message.reply(`Pong! Park Jong Gun vẫn đang online 🔥`);
    }

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

        return message.reply(`--- TRẠNG THÁI ---\nRAM: ${memoryUsed} MB\nUptime: ${uptimeString}`);
    }

    if (videoRegex.test(message.content)) {
        if (message.content.includes('spotify.com')) return;
        try {
            await message.channel.sendTyping();
            const res = await axios.post('https://api.cobalt.tools/api/json', {
                url: message.content.match(videoRegex)[0],
                vQuality: '720',
                filenamePattern: 'basic'
            }, { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 10000 });

            if (res.data && res.data.url) {
                const file = new AttachmentBuilder(res.data.url, { name: 'video.mp4' });
                await message.reply({ content: 'Video của bạn:', files: [file] });
            }
        } catch (e) { console.error(e.message); }
    }
});

// --- 4. HỆ THỐNG PHÁT NHẠC VOICE TÍCH HỢP BẢN VÁ ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, member, guildId } = int;

    if (commandName === 'music') {
        await int.deferReply(); 

        const voiceChannel = member.voice.channel;
        if (!voiceChannel) return int.editReply("Vui lòng vào kênh thoại trước!");

        const url = options.getString('link');
        if (!url.includes('spotify.com')) {
            return int.editReply("Vui lòng chỉ sử dụng đường dẫn bài hát từ Spotify.");
        }

        try {
            const embedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
            const spotifyRes = await axios.get(embedUrl, { timeout: 8000 }).catch(() => null);
            
            let trackName = "Vô Tình Xesi";
            if (spotifyRes && spotifyRes.data && spotifyRes.data.title) {
                trackName = spotifyRes.data.title;
            }

            const appleSearchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(trackName)}&media=music&limit=1`;
            const appleRes = await axios.get(appleSearchUrl, { timeout: 8000 });

            if (!appleRes.data || appleRes.data.resultCount === 0) {
                return int.editReply("Không tìm thấy bài hát này.");
            }

            const audioStreamUrl = appleRes.data.results[0].previewUrl;
            const songTitle = appleRes.data.results[0].trackName;
            const artistName = appleRes.data.results[0].artistName;

            // Thiết lập kết nối thoại thoại
            const connection = joinVoiceChannel({ 
                channelId: voiceChannel.id, 
                guildId: guildId, 
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false
            });

            // BẢN VÁ LỖI MẠNG RENDER: ÉP LUỒNG UDP ĐỂ KHÔNG BỊ CÂM TIẾNG
            connection.on(VoiceConnectionStatus.Ready, () => {
                console.log("⚡ Kết nối Voice sẵn sàng. Đang kích hoạt bản vá thông luồng mạng...");
                const networkStateAsAny = connection.state.networking;
                const udp = networkStateAsAny.udp;
                if (udp && typeof udp.sendBlankPacket === 'function') {
                    // Ép gửi gói tin trống mỗi 20 giây để giữ cổng luôn mở
                    const keepAliveInterval = setInterval(() => {
                        if (connection.state.status === VoiceConnectionStatus.Ready) {
                            udp.sendBlankPacket();
                        } else {
                            clearInterval(keepAliveInterval);
                        }
                    }, 20000);
                }
            });

            const player = createAudioPlayer();
            // Đổi về kiểu Demuxed để tối ưu bộ đọc FFmpeg trên host Linux
            const resource = createAudioResource(audioStreamUrl, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });
            
            resource.volume.setVolume(0.9); // Đặt âm lượng khoảng 90% tránh méo tiếng
            player.play(resource);
            connection.subscribe(player);
            
            players.set(guildId, { connection, player });
            
            await int.editReply(`🎵 Đang phát: **${songTitle}** - *${artistName}*`);
        } catch (e) { 
            console.error(e.message);
            await int.editReply("Gặp lỗi mạng khi giải mã luồng nhạc."); 
        }
    }

    if (commandName === 'musicoff') {
        const session = players.get(guildId);
        if (session) {
            session.connection.destroy();
            players.delete(guildId);
            await int.reply("Đã dừng phát nhạc.");
        } else {
            await int.reply({ content: "Bot không phát nhạc ở đây.", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
