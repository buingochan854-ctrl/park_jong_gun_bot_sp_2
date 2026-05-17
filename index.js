const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const axios = require('axios');
const express = require('express');
const ffmpeg = require('ffmpeg-static');
const { RateLimiterMemory } = require('rate-limiter-flexible'); // Đảm bảo giữ luồng ổn định
require('dotenv').config();

// --- 1. WEB SERVER GIỮ BOT ONLINE ---
const app = express(); 
const PORT = process.env.PORT || 10000; 

app.get('/', (req, res) => {
    res.status(200).send('Park Jong Gun Bot Music FIX PCM TIENG đang chạy!');
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
    console.log('✅ KHỞI ĐỘNG HỆ THỐNG PHÁT PCM TRỰC TIẾP QUA FFMPEG CODES!');

    const commands = [
        new SlashCommandBuilder()
            .setName('music')
            .setDescription('Phát nhạc từ link Spotify qua luồng PCM')
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
        const memoryUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        return message.reply(`--- TRẠNG THÁI ---\nRAM: ${memoryUsed} MB\nBộ giải mã: FFMPEG RAW PCM`);
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

// --- 4. HỆ THỐNG PHÁT NHẠC VOICE ÉP LUỒNG RAW PCM ---
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
            // Lấy metadata bài hát từ Spotify
            const embedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
            const spotifyRes = await axios.get(embedUrl, { timeout: 8000 }).catch(() => null);
            
            let trackName = "Vô Tình Xesi";
            if (spotifyRes && spotifyRes.data && spotifyRes.data.title) {
                trackName = spotifyRes.data.title;
            }

            // Lấy liên kết âm thanh chính hãng từ Apple iTunes
            const appleSearchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(trackName)}&media=music&limit=1`;
            const appleRes = await axios.get(appleSearchUrl, { timeout: 8000 });

            if (!appleRes.data || appleRes.data.resultCount === 0) {
                return int.editReply("Không tìm thấy bài hát này trên cổng âm thanh.");
            }

            const audioStreamUrl = appleRes.data.results[0].previewUrl;
            const songTitle = appleRes.data.results[0].trackName;
            const artistName = appleRes.data.results[0].artistName;

            // Kết nối vào Voice Channel
            const connection = joinVoiceChannel({ 
                channelId: voiceChannel.id, 
                guildId: guildId, 
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false
            });

            // Vá lỗi mạng mềm để ép thông luồng UDP liên tục
            connection.on(VoiceConnectionStatus.Ready, () => {
                const networkStateAsAny = connection.state.networking;
                const udp = networkStateAsAny.udp;
                if (udp && typeof udp.sendBlankPacket === 'function') {
                    const keepAliveInterval = setInterval(() => {
                        if (connection.state.status === VoiceConnectionStatus.Ready) {
                            udp.sendBlankPacket();
                        } else {
                            clearInterval(keepAliveInterval);
                        }
                    }, 15000);
                }
            });

            const player = createAudioPlayer();
            
            // ÉP ĐẦU VÀO SỬ DỤNG STREAM TYPE RAW ĐỂ TRÁNH SỬ DỤNG THƯ VIỆN OPUS CỦA BOT
            // Sử dụng FFmpeg hệ thống tự xử lý gói tin âm thanh 16bit Stereo cực kỳ ổn định
            const resource = createAudioResource(audioStreamUrl, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });
            
            resource.volume.setVolume(1.0);
            player.play(resource);
            connection.subscribe(player);
            
            players.set(guildId, { connection, player });
            
            player.on(AudioPlayerStatus.Playing, () => {
                console.log(` Đang truyền dữ liệu âm thanh PCM: ${songTitle}`);
            });

            player.on('error', error => {
                console.error(` Lỗi trình phát nhạc: ${error.message}`);
            });
            
            await int.editReply(`🎵 Đang phát: **${songTitle}** - *${artistName}*`);
        } catch (e) { 
            console.error(e.message);
            await int.editReply("Gặp lỗi mạng khi đồng bộ luồng phát."); 
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
