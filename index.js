const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');
const axios = require('axios');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Quản lý trình phát nhạc
const players = new Map();

// 1. ĐĂNG KÝ SLASH COMMANDS
client.on('ready', async () => {
    console.log(`🚀 Bot Online: ${client.user.tag}`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('music')
            .setDescription('Phát nhạc theo link (Hỗ trợ Youtube/Spotify)')
            .addStringOption(option => 
                option.setName('link')
                .setDescription('Dán link nhạc vào đây')
                .setRequired(true)),
        new SlashCommandBuilder()
            .setName('musicoff')
            .setDescription('Tắt nhạc và rời khỏi kênh thoại')
    ];

    try {
        await client.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Đã cập nhật hệ thống lệnh Slash');
    } catch (error) {
        console.error('❌ Lỗi đăng ký lệnh:', error);
    }
});

// 2. CHỨC NĂNG TỰ ĐỘNG NHẬN DIỆN LINK TẢI VIDEO
const videoRegex = /https?:\/\/(www\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/\S+/i;

client.on('messageCreate', async (message) => {
    if (message.author.bot || !videoRegex.test(message.content)) return;

    // Nếu là link nhạc (để phát trong voice) thì bỏ qua không tải file
    if (message.content.includes('spotify.com') || message.content.includes('watch?v=')) return;

    const url = message.content.match(videoRegex)[0];

    try {
        await message.channel.sendTyping();
        const response = await axios.post('https://api.cobalt.tools/api/json', { 
            url: url, 
            vQuality: '720' 
        });

        if (response.data && response.data.url) {
            const attachment = new AttachmentBuilder(response.data.url, { name: 'video.mp4' });
            await message.reply({ content: '🎬 **Video của bạn đã sẵn sàng:**', files: [attachment] });
        }
    } catch (err) {
        console.error('Lỗi tải video:', err.message);
    }
});

// 3. XỬ LÝ LỆNH NHẠC (/MUSIC & /MUSICOFF)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, member, guildId } = interaction;
    const voiceChannel = member.voice.channel;

    // Kiểm tra kênh thoại
    if (!voiceChannel) {
        return interaction.reply({ content: "⚠️ Bạn cần vào một kênh thoại trước!", ephemeral: true });
    }

    if (commandName === 'music') {
        const url = options.getString('link');
        await interaction.deferReply();

        try {
            let stream;
            // Xử lý Spotify (Chuyển đổi sang tìm kiếm Youtube)
            if (play.sp_validate(url)) {
                const spData = await play.spotify(url);
                const searched = await play.search(`${spData.name} ${spData.artists[0].name}`, { limit: 1 });
                stream = await play.stream(searched[0].url);
            } 
            // Xử lý Youtube trực tiếp
            else if (play.yt_validate(url)) {
                stream = await play.stream(url);
            } else {
                return interaction.editReply("❌ Link không hỗ trợ. Hãy dùng link YouTube hoặc Spotify.");
            }

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guildId,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer();
            const resource = createAudioResource(stream.stream, { inputType: stream.type });

            player.play(resource);
            connection.subscribe(player);
            players.set(guildId, { connection, player });

            await interaction.editReply(`🎶 Đang phát: **${url}**\n*Lưu ý: Chỉ dùng được trong kênh thoại.*`);

        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Có lỗi xảy ra khi phát nhạc!");
        }
    }

    if (commandName === 'musicoff') {
        const session = players.get(guildId);
        if (session) {
            session.connection.destroy();
            players.delete(guildId);
            await interaction.reply("⏹️ Đã dừng nhạc và rời kênh.");
        } else {
            await interaction.reply({ content: "❌ Hiện không có nhạc đang phát.", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

