const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- 1. WEB SERVER GIỮ BOT ONLINE ---
const app = express(); 
const PORT = process.env.PORT || 10000; 
app.get('/', (req, res) => res.status(200).send('Park Jong Gun Bot đang chạy!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Web Server định tuyến tại port: ${PORT}`));

// --- 2. CẤU HÌNH BOT & ĐƯỜNG DẪN DATABASE ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = "+";
const OWNER_ID = "1455796719378895022"; // ID của bạn
const DATA_FILE = path.join(__dirname, 'database.json');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // Dạng: username/repo-name

// Tải dữ liệu ban đầu từ file database.json (nếu có)
let keyStorage = new Map();
if (fs.existsSync(DATA_FILE)) {
    try {
        const fileData = fs.readFileSync(DATA_FILE, 'utf8');
        keyStorage = new Map(Object.entries(JSON.parse(fileData)));
        console.log('Đã nạp thành công bộ nhớ key từ file cục bộ.');
    } catch (e) { console.error('Lỗi đọc database cục bộ:', e); }
}

const videoRegex = /https?:\/\/(www\.|vt\.|v\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/\S+/i;

// Hàm đồng bộ dữ liệu: Ghi file cục bộ đồng thời tự Commit + Push lên GitHub Repo vĩnh viễn
async function syncDatabaseToGitHub() {
    try {
        const obj = Object.fromEntries(keyStorage);
        const contentString = JSON.stringify(obj, null, 2);
        
        fs.writeFileSync(DATA_FILE, contentString, 'utf8');

        if (!GITHUB_TOKEN || !GITHUB_REPO) {
            console.log('Thiếu GITHUB_TOKEN hoặc GITHUB_REPO trong Environment. Không thể đồng bộ lên GitHub.');
            return;
        }

        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/database.json`;
        const headers = {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Discord-Bot-Storage'
        };

        let sha = null;
        try {
            const checkRes = await axios.get(url, { headers });
            sha = checkRes.data.sha;
        } catch (err) {}

        await axios.put(url, {
            message: 'Bot tự động cập nhật hệ thống dữ liệu key [Dùng API]',
            content: Buffer.from(contentString).toString('base64'),
            sha: sha || undefined
        }, { headers });

        console.log('Đã đồng bộ và lưu trữ dữ liệu vĩnh viễn lên GitHub thành công!');
    } catch (error) {
        console.error('Lỗi khi thực hiện đồng bộ lên GitHub:', error.response ? error.response.data : error.message);
    }
}

// Hàm tính toán độ tương đồng giữa 2 chuỗi
function getSimilarity(str1, str2) {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    if (s1 === s2) return 100;
    if (s1.length === 0 || s2.length === 0) return 0;
    const track = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(null));
    for (let i = 0; i <= s1.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= s2.length; j += 1) track[j][0] = j;
    for (let j = 1; j <= s2.length; j += 1) {
        for (let i = 1; i <= s1.length; i += 1) {
            const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
            track[j][i] = Math.min(track[j][i - 1] + 1, track[j - 1][i] + 1, track[j - 1][i - 1] + indicator);
        }
    }
    const distance = track[s2.length][s1.length];
    const maxLength = Math.max(s1.length, s2.length);
    return ((maxLength - distance) / maxLength) * 100;
}

client.on('clientReady', async () => {
    console.log(`Bot Online: ${client.user.tag}`);
    const commands = [
        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Xem trạng thái hoạt động hiện tại của Bot'),
        new SlashCommandBuilder()
            .setName('addkey')
            .setDescription('[Owner] Thêm key bản quyền mới')
            .addStringOption(opt => opt.setName('name').setDescription('Tên của key').setRequired(true))
            .addStringOption(opt => opt.setName('value').setDescription('Giá trị (Script/Chuỗi key)').setRequired(true))
            .addStringOption(opt => opt.setName('type').setDescription('Loại giao diện hiển thị').setRequired(true)
                .addChoices(
                    { name: 'UI Đẹp (Có nút bấm copy)', value: 'dep' },
                    { name: 'UI Thường (Dạng văn bản)', value: 'thuong' }
                )),
        new SlashCommandBuilder()
            .setName('listkey')
            .setDescription('[Owner] Xem danh sách tất cả các key đang có'),
        new SlashCommandBuilder()
            .setName('deletekey')
            .setDescription('[Owner] Xóa một key bản quyền')
            .addStringOption(opt => opt.setName('name').setDescription('Tên key cần xóa').setRequired(true))
    ];
    try {
        await client.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Đã cập nhật xong hệ thống lệnh Slash');
    } catch (err) { console.error('Lỗi nạp lệnh Slash:', err); }
});

// --- 3. TỰ ĐỘNG QUÉT TIN NHẮN (TẢI VIDEO & THÔNG MINH CHECK KEY) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const rawContent = message.content.trim();
    if (rawContent.toLowerCase() === `${PREFIX}ping`) {
        return message.reply(`Pong! Park Jong Gun vẫn đang online`).catch(err => console.error(err));
    }

    let bestMatchKey = null;
    let highestScore = 0;
    keyStorage.forEach((data, name) => {
        const score = getSimilarity(rawContent, name);
        if (score > highestScore) {
            highestScore = score;
            bestMatchKey = name;
        }
    });

    if (bestMatchKey && highestScore >= 80) {
        const keyData = keyStorage.get(bestMatchKey);
        if (keyData.type === 'thuong') {
            return message.reply(`${keyData.value}`).catch(err => console.error(err));
        }
        if (keyData.type === 'dep') {
            const embed = new EmbedBuilder()
                .setTitle(`${bestMatchKey}`)
                .setDescription(`\`\`\`lua\n${keyData.value}\n\`\`\``)
                .setColor('#2b2d31');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`copy_pc_${bestMatchKey}`).setLabel('COPY PC').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`copy_mobile_${bestMatchKey}`).setLabel('COPY MOBILE').setStyle(ButtonStyle.Primary)
            );
            return message.reply({ embeds: [embed], components: [row] }).catch(err => console.error(err));
        }
    }

    if (videoRegex.test(message.content)) {
        if (message.content.includes('spotify.com') || (message.content.includes('youtube.com/watch') && !message.content.includes('shorts'))) return;
        try {
            await message.channel.sendTyping();
            const res = await axios.post('https://api.cobalt.tools/api/json', {
                url: message.content.match(videoRegex)[0],
                vQuality: '720',
                filenamePattern: 'basic'
            }, { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 10000 });
            if (res.data && res.data.url) {
                const file = new AttachmentBuilder(res.data.url, { name: 'video.mp4' });
                await message.reply({ content: 'Video của bạn đây:', files: [file] });
            }
        } catch (e) { console.error('Lỗi tải video:', e.message); }
    }
});

// --- 4. XỬ LÝ LỆNH SLASH & SỰ KIỆN NÚT BẤM COPY CHỐNG LỖI ---
client.on('interactionCreate', async (int) => {
    if (int.isChatInputCommand()) {
        const { commandName, options, user } = int;
        if (['addkey', 'listkey', 'deletekey'].includes(commandName) && user.id !== OWNER_ID) {
            return int.reply({ content: 'Bạn không có quyền quản lý hệ thống key!', ephemeral: true }).catch(err => console.error(err));
        }
        if (commandName === 'status') {
            const memoryUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            return int.reply(`Bot đang hoạt động ổn định! RAM tiêu thụ: ${memoryUsed} MB. DB đang sử dụng cơ chế đám mây GitHub.`).catch(err => console.error(err));
        }
        if (commandName === 'addkey') {
            const name = options.getString('name').trim();
            const value = options.getString('value');
            const type = options.getString('type');

            await int.deferReply({ ephemeral: true });
            keyStorage.set(name, { value, type });
            
            await syncDatabaseToGitHub();
            return int.editReply({ content: `Đã thêm và sao lưu vĩnh viễn key "${name}" thành công lên GitHub!` });
        }
        if (commandName === 'listkey') {
            if (keyStorage.size === 0) {
                return int.reply({ content: 'Hiện tại hệ thống chưa lưu trữ bất kỳ key nào.', ephemeral: true }).catch(err => console.error(err));
            }
            let listString = '--- DANH SÁCH KEY ĐANG HOẠT ĐỘNG ---\n';
            keyStorage.forEach((data, name) => {
                listString += `• Tên: ${name} | Loại UI: ${data.type === 'dep' ? 'UI Đẹp' : 'UI Thường'}\n`;
            });
            listString += '-------------------------------------';
            return int.reply({ content: listString, ephemeral: true }).catch(err => console.error(err));
        }
        if (commandName === 'deletekey') {
            const name = options.getString('name').trim();
            if (!keyStorage.has(name)) {
                return int.reply({ content: `Không tìm thấy key nào có tên là "${name}" để xóa.`, ephemeral: true }).catch(err => console.error(err));
            }
            await int.deferReply({ ephemeral: true });
            keyStorage.delete(name);
            
            await syncDatabaseToGitHub();
            return int.editReply({ content: `Đã xóa hoàn toàn key "${name}" ra khỏi hệ thống và đồng bộ GitHub.` });
        }
    }

    // NÂNG CẤP XỬ LÝ NÚT BẤM COPY ĐỂ KHÔNG BỊ LỖI ĐỎ
    if (int.isButton()) {
        try {
            const customId = int.customId;
            if (customId.startsWith('copy_mobile_') || customId.startsWith('copy_pc_')) {
                const isMobile = customId.startsWith('copy_mobile_');
                const keyName = isMobile ? customId.replace('copy_mobile_', '') : customId.replace('copy_pc_', '');
                
                const keyData = keyStorage.get(keyName);

                if (!keyData) {
                    return await int.reply({ content: 'Lỗi: Key này không còn tồn tại trên hệ thống.', ephemeral: true });
                }

                const scriptContent = keyData.value;
                const sendContent = isMobile ? `\`${scriptContent}\`` : `\`\`\`lua\n${scriptContent}\n\`\`\``;

                // KIỂM TRA GIỚI HẠN 2000 KÝ TỰ CỦA DISCORD
                if (sendContent.length > 2000) {
                    // Nếu quá dài, chuyển thành dạng file tải xuống
                    const buffer = Buffer.from(scriptContent, 'utf-8');
                    // Định dạng tên file sạch sẽ, bỏ ký tự đặc biệt
                    const safeFileName = keyName.replace(/[^a-zA-Z0-9]/g, '_') + '_script.txt';
                    const file = new AttachmentBuilder(buffer, { name: safeFileName });
                    
                    return await int.reply({ 
                        content: '*LỖI!* **Script quá dài (>2000 ký tự)**\nDiscord không cho phép gửi tin nhắn văn bản quá dài. Bot đã chuyển đổi script thành dạng file. Bạn hãy tải về nhé:', 
                        files: [file], 
                        ephemeral: true 
                    });
                }

                // Nếu dưới 2000 ký tự, gửi bình thường
                return await int.reply({ content: sendContent, ephemeral: true });
            }
        } catch (error) {
            console.error('Lỗi khi bấm nút copy:', error);
            // Phản hồi dự phòng thay vì để hiện chữ đỏ
            if (!int.replied && !int.deferred) {
                await int.reply({ content: 'Đã xảy ra lỗi hệ thống khi xử lý nút bấm. Vui lòng báo cho Admin!', ephemeral: true }).catch(console.error);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
