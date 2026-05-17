const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER GIỮ BOT ONLINE ---
const app = express(); 
const PORT = process.env.PORT || 10000; 

app.get('/', (req, res) => {
    res.status(200).send('Park Jong Gun Bot đang chạy mượt mà (Đã tối ưu hóa loại bỏ icon)!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web Server định tuyến thành công tại port: ${PORT}`);
});

// --- 2. CẤU HÌNH BOT DISCORD ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = "+";
const videoRegex = /https?:\/\/(www\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/\S+/i;

client.on('clientReady', async () => {
    console.log(`Bot Online: ${client.user.tag}`);
    console.log('Đã dọn sạch các biểu tượng icon trong thông báo');

    const commands = [
        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Xem trạng thái hoạt động hiện tại của Bot')
    ];

    try {
        await client.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Đã cập nhật xong hệ thống lệnh Slash mới');
    } catch (err) { console.error('Lỗi nạp lệnh Slash:', err); }
});

// --- 3. LỆNH PREFIX CHÍNH & TỰ ĐỘNG TẢI VIDEO ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const contentLower = message.content.toLowerCase();

    // Lệnh +ping
    if (contentLower === `${PREFIX}ping`) {
        return message.reply(`Pong! Park Jong Gun vẫn đang online`);
    }

    // Lệnh +status (Bản Text)
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
            `Hệ thống: Đã tối ưu (Chỉ chạy Auto-Downloader)`,
            "----------------------------"
        ].join('\n');

        return message.reply(statusMessage);
    }

    // TỰ ĐỘNG BẮT LINK VÀ TẢI VIDEO (TIKTOK, YOUTUBE, INSTAGRAM)
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
                await message.reply({ content: 'Video của bạn đây:', files: [file] });
            }
        } catch (e) { 
            console.error('Lỗi tải video tự động:', e.message); 
        }
    }
});

// --- 4. XỬ LÝ LỆNH SLASH ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName } = int;

    if (commandName === 'status') {
        const memoryUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        await int.reply(`Bot đang hoạt động ổn định! RAM tiêu thụ: ${memoryUsed} MB. Hệ thống âm nhạc đã được tắt nhường chỗ cho Jockie Music`);
    }
});

client.login(process.env.DISCORD_TOKEN);

