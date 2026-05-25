const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { GoogleGenAI } = require('@google/genai'); 
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- 1. WEB SERVER GIỮ BOT ONLINE ---
const app = express(); 
const PORT = process.env.PORT || 10000; 
app.get('/', (req, res) => res.status(200).send('Park Jong Gun Bot dang chay'));
app.listen(PORT, '0.0.0.0', () => console.log(`Web Server dinh tuyen tai port: ${PORT}`));

// --- 2. CẤU HÌNH BOT & DATABASE ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = "+";
const OWNER_ID = process.env.OWNER_ID; 
const DATA_FILE = path.join(__dirname, 'database.json');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

let lastSearchTime = 0; 
let currentStatusText = 'Hệ thống lệnh Slash';
let currentStatusType = 'dnd';

let chatbotChannels = {};

let keyStorage = new Map();
if (fs.existsSync(DATA_FILE)) {
    try {
        const fileData = fs.readFileSync(DATA_FILE, 'utf8');
        const parsedData = JSON.parse(fileData);
        
        if (parsedData.chatbotChannels) {
            chatbotChannels = parsedData.chatbotChannels;
            delete parsedData.chatbotChannels;
        }
        keyStorage = new Map(Object.entries(parsedData));
        console.log('Da nap thanh cong bo nho tu file cuc bo.');
    } catch (e) { console.error('Loi doc database cuc bo:', e); }
}

const videoRegex = /https?:\/\/(www\.|vt\.|v\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/(shorts\/|reel\/|video\/|\S+)/i;

function khongDauFormat(str) {
    return str
        .normalize('NFD') 
        .replace(/[\u0300-\u036f]/g, '') 
        .replace(/đ/g, 'd').replace(/Đ/g, 'd') 
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') 
        .trim()
        .replace(/\s+/g, '_'); 
}

async function syncDatabaseToGitHub() {
    try {
        const obj = Object.fromEntries(keyStorage);
        obj.chatbotChannels = chatbotChannels;
        
        const contentString = JSON.stringify(obj, null, 2);
        
        await fs.promises.writeFile(DATA_FILE, contentString, 'utf8');

        if (!GITHUB_TOKEN || !GITHUB_REPO) return;

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
            message: 'Bot tu dong cap nhat he thong du lieu dam may',
            content: Buffer.from(contentString).toString('base64'),
            sha: sha || undefined
        }, { headers });

        console.log('Da dong bo du lieu vinh vien len GitHub thanh cong.');
    } catch (error) {
        console.error('Loi dong bo GitHub:', error.message);
    }
}

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
    
    client.user.setPresence({
        status: currentStatusType,
        activities: [{ name: currentStatusText, type: 0 }]
    });

    const commands = [
        new SlashCommandBuilder().setName('status').setDescription('Xem trạng thái hoạt động hiện tại của Bot'),
        
        new SlashCommandBuilder()
            .setName('chatbotgmn')
            .setDescription('Kích hoạt ChatBot AI Gemini Trong một kênh nào đó.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
        new SlashCommandBuilder()
            .setName('chatbotoff')
            .setDescription('Tắt ChatBot AI')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

        new SlashCommandBuilder()
            .setName('setstatus')
            .setDescription('[Owner] Thay đổi trạng thái hiển thị của Bot')
            .addStringOption(opt => opt.setName('type').setDescription('Chọn kiểu trạng thái').setRequired(true)
                .addChoices(
                    { name: 'Trực Tuyến', value: 'online' },
                    { name: 'Chờ', value: 'idle' },
                    { name: 'Vui lòng không làm phiền', value: 'dnd' },
                    { name: 'Ẩn danh', value: 'invisible' }
                ))
            .addStringOption(opt => opt.setName('text').setDescription('Nhập dòng chữ trạng thái tùy chỉnh').setRequired(false)),
            
        new SlashCommandBuilder()
            .setName('search')
            .setDescription('Tìm kiếm thông tin bằng trí tuệ nhân tạo AI Gemini')
            .addStringOption(opt => opt.setName('query').setDescription('Nhập nội dung hoặc câu hỏi bạn cần tìm kiếm').setRequired(true)),
        new SlashCommandBuilder()
            .setName('addkey')
            .setDescription('[Owner] Thêm key bản quyền mới')
            .addStringOption(opt => opt.setName('name').setDescription('Tên của key').setRequired(true))
            .addStringOption(opt => opt.setName('value').setDescription('Giá trị (Script/Chuỗi key)').setRequired(true))
            .addStringOption(opt => opt.setName('type').setDescription('Loại giao diện hiển thị').setRequired(true)
                .addChoices({ name: 'UI Đẹp (Có nút bấm copy)', value: 'dep' }, { name: 'UI Thường (Dạng văn bản)', value: 'thuong' })),
        new SlashCommandBuilder().setName('listkey').setDescription('[Owner] Xem danh sách tất cả các key đang có'),
        new SlashCommandBuilder()
            .setName('deletekey')
            .setDescription('[Owner] Xóa một key bản quyền')
            .addStringOption(opt => opt.setName('name').setDescription('Tên key cần xóa').setRequired(true)),
        new SlashCommandBuilder()
            .setName('changekey')
            .setDescription('[Owner] Sửa value một key')
            .addStringOption(opt => opt.setName('namekey').setDescription('Chọn key cần chỉnh sửa').setRequired(true).setAutocomplete(true))
            .addStringOption(opt => opt.setName('newvalue').setDescription('Nhập giá trị Script mới').setRequired(true))
            .addStringOption(opt => opt.setName('type').setDescription('Chọn loại giao diện hiển thị mới').setRequired(true)
                .addChoices({ name: 'UI Đẹp (Có nút bấm copy)', value: 'dep' }, { name: 'UI Thường (Dạng văn bản)', value: 'thuong' }))
    ];
    try {
        await client.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Da cap nhat xong he thong lenh Slash');
    } catch (err) { console.error('Loi nap lenh Slash:', err); }
});

// --- 3. TỰ ĐỘNG QUÉT TIN NHẮN CHÍNH XÁC & XỬ LÝ CHATBOT KÊNH ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const rawContent = message.content.trim();
    
    if (rawContent.toLowerCase() === `${PREFIX}ping`) {
        return message.reply(`Pong! Park Jong Gun vẫn đang online`).catch(console.error);
    }

    if (chatbotChannels[message.channel.id] && !rawContent.startsWith(PREFIX)) {
        if (!rawContent || videoRegex.test(message.content)) return;

        try {
            await message.channel.sendTyping();

            try {
                client.user.setPresence({
                    status: currentStatusType,
                    activities: [{ name: 'Gemini Đang Suy Nghĩ...', type: 0 }]
                });
            } catch (err) {}

            if (!process.env.GEMINI_API_KEY) {
                return message.reply('Lỗi: Hệ thống chưa cấu hình GEMINI_API_KEY.').catch(() => {});
            }

            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: rawContent,
            });

            let textResult = response && response.text ? response.text : "Không nhận được phản hồi hợp lệ từ AI.";

            if (textResult.length > 1800) {
                let shortQuery = rawContent.slice(0, 40); 
                let fileFriendlyName = khongDauFormat(shortQuery);
                let finalFileName = `kq_${fileFriendlyName}.txt`;

                const textBuffer = Buffer.from(textResult, 'utf-8');
                const txtFile = new AttachmentBuilder(textBuffer, { name: finalFileName });

                await message.reply({ 
                    content: `Câu trả lời vượt quá giới hạn hiển thị (${textResult.length} ký tự). Mình đã tự động xuất ra file văn bản chuẩn:`, 
                    files: [txtFile] 
                }).catch(() => {});
            } else {
                await message.reply({ content: textResult }).catch(() => {});
            }

        } catch (error) {
            console.error('Loi ChatBot AI:', error);
            await message.reply({ content: 'Không thể hoàn thành xử lý nội dung chat lúc này do hệ thống AI bận.' }).catch(() => {});
        } finally {
            try {
                client.user.setPresence({
                    status: currentStatusType,
                    activities: [{ name: currentStatusText, type: 0 }]
                });
            } catch (err) {}
        }
        return; 
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
            return message.reply(`${keyData.value}`).catch(console.error);
        }
        if (keyData.type === 'dep') {
            const embed = new EmbedBuilder()
                .setTitle(`${bestMatchKey}`)
                .setDescription(`\`\`\`lua\n${keyData.value}\n\`\`\``)
                .setColor('#2b2d31');
            
            const safeKeyId = Buffer.from(bestMatchKey.toLowerCase().trim()).toString('hex');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`copy_pc_${safeKeyId}`).setLabel('COPY PC').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`copy_mobile_${safeKeyId}`).setLabel('COPY MOBILE').setStyle(ButtonStyle.Primary)
            );
            return message.reply({ embeds: [embed], components: [row] }).catch(console.error);
        }
    }

    if (videoRegex.test(message.content)) {
        if (message.content.includes('spotify.com') || (message.content.includes('youtube.com/watch') && !message.content.includes('shorts'))) return;
        
        try {
            await message.channel.sendTyping();
            const extractedUrl = message.content.match(videoRegex)[0];
            
            const res = await axios.post('https://api.cobalt.tools/api/json', {
                url: extractedUrl,
                vQuality: '720',
                filenamePattern: 'basic'
            }, { 
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, 
                timeout: 12000 
            });

            if (res.data && res.data.url) {
                const videoUrl = res.data.url;
                const file = new AttachmentBuilder(videoUrl, { name: 'video.mp4' });
                
                await message.reply({ content: 'Video của bạn đây:', files: [file] }).catch(async (err) => {
                    await message.reply({ content: `Video dung lượng lớn không thể upload trực tiếp! Bạn có thể bấm vào đây để xem hoặc tải về máy: [Bấm vào để xem](${videoUrl})` });
                });
            } else {
                await message.reply({ content: 'Hệ thống API không trích xuất được link tải cho video này. Vui lòng thử lại sau!' });
            }
        } catch (e) { 
            await message.reply({ content: `Không thể tải video lúc này!` });
        }
    }
});

// --- 4. INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (int.isAutocomplete()) {
        if (int.commandName === 'changekey') {
            const focusedValue = int.options.getFocused().toLowerCase();
            const choices = Array.from(keyStorage.keys());
            const filtered = choices.filter(choice => choice.toLowerCase().includes(focusedValue));
            await int.respond(filtered.slice(0, 25).map(choice => ({ name: choice, value: choice }))).catch(() => {});
        }
        return;
    }

    if (int.isChatInputCommand()) {
        const { commandName, options, user, channel } = int;
        
        if (commandName === 'chatbotgmn') {
            await int.deferReply();
            
            try {
                client.user.setPresence({
                    status: currentStatusType,
                    activities: [{ name: 'Gemini Đang Suy Nghĩ...', type: 0 }]
                });
            } catch (err) {}

            chatbotChannels[channel.id] = true;
            await syncDatabaseToGitHub();

            try {
                client.user.setPresence({
                    status: currentStatusType,
                    activities: [{ name: currentStatusText, type: 0 }]
                });
            } catch (err) {}

            return int.editReply({ content: 'Đã kích hoạt ChatBot thành công!' });
        }

        if (commandName === 'chatbotoff') {
            await int.deferReply();
            
            if (chatbotChannels[channel.id]) {
                delete chatbotChannels[channel.id];
                await syncDatabaseToGitHub();
                return int.editReply({ content: 'Đã tắt ChatBot AI tại kênh này thành công!' });
            } else {
                return int.editReply({ content: 'Kênh này hiện tại chưa từng kích hoạt ChatBot AI.' });
            }
        }

        if (commandName === 'search') {
            const query = options.getString('query');
            const now = Date.now();
            const SERVER_COOLDOWN = 6 * 1000; 

            if (now - lastSearchTime < SERVER_COOLDOWN) {
                const timeLeft = ((SERVER_COOLDOWN - (now - lastSearchTime)) / 1000).toFixed(1);
                return int.reply({ 
                    content: `Hệ thống AI đang xử lý yêu cầu trước. Vui lòng đợi ${timeLeft} giây!`, 
                    ephemeral: true 
                }).catch(console.error);
            }

            try { await int.deferReply(); } catch (e) { return; }
            lastSearchTime = now;

            try {
                client.user.setPresence({
                    status: currentStatusType,
                    activities: [{ name: `Đang trả lời câu hỏi của ${user.username}...`, type: 0 }]
                });
            } catch (statusErr) {}

            try {
                if (!process.env.GEMINI_API_KEY) {
                    return int.editReply({ content: 'Lỗi: Hệ thống chưa cấu hình GEMINI_API_KEY.' }).catch(() => {});
                }

                const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: query,
                });

                let textResult = response && response.text ? response.text : "Không nhận được phản hồi từ AI.";

                if (textResult.length > 1800) {
                    let shortQuery = query.slice(0, 40); 
                    let fileFriendlyName = khongDauFormat(shortQuery);
                    let finalFileName = `kq_${fileFriendlyName}.txt`;

                    const textBuffer = Buffer.from(textResult, 'utf-8');
                    const txtFile = new AttachmentBuilder(textBuffer, { name: finalFileName });
                    
                    await int.editReply({ 
                        content: `Câu trả lời vượt quá giới hạn hiển thị (${textResult.length} ký tự). Đã xuất ra file văn bản chuẩn dưới đây:`, 
                        files: [txtFile] 
                    }).catch(() => {});
                } else {
                    const searchEmbed = new EmbedBuilder()
                        .setTitle('Kết quả giải đáp từ AI')
                        .setDescription(textResult)
                        .setColor('#2b2d31')
                        .setFooter({ text: `Yêu cầu bởi: ${user.username}` });

                    await int.editReply({ embeds: [searchEmbed] }).catch(() => {});
                }

            } catch (error) {
                console.error(error);
                await int.editReply({ content: 'Không thể hoàn thành tìm kiếm lúc này.' }).catch(() => {});
            } finally {
                try {
                    client.user.setPresence({
                        status: currentStatusType,
                        activities: [{ name: currentStatusText, type: 0 }]
                    });
                } catch (statusErr) {}
            }
            return;
        }

        if (['addkey', 'listkey', 'deletekey', 'changekey', 'setstatus'].includes(commandName) && user.id !== OWNER_ID) {
            return int.reply({ content: 'Bạn không có quyền quản lý hệ thống của Bot!', ephemeral: true }).catch(console.error);
        }
        
        if (commandName === 'setstatus') {
            const statusType = options.getString('type');
            const statusText = options.getString('text') || 'Hệ thống lệnh Slash';
            
            try {
                currentStatusType = statusType;
                currentStatusText = statusText;

                client.user.setPresence({
                    status: currentStatusType,
                    activities: [{ name: currentStatusText, type: 0 }]
                });
                return int.reply({ content: 'Đã thay đổi trạng thái hiển thị của Bot thành công!', ephemeral: true });
            } catch (e) {
                return int.reply({ content: 'Gặp sự cố khi thiết lập trạng thái mới!', ephemeral: true });
            }
        }

        if (commandName === 'status') {
            const memoryUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            return int.reply(`Bot đang hoạt động ổn định! RAM tiêu thụ: ${memoryUsed} MB. DB đang sử dụng cơ chế đám mây GitHub.`).catch(console.error);
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
                return int.reply({ content: 'Hiện tại hệ thống chưa lưu trữ bất kỳ key nào.', ephemeral: true }).catch(console.error);
            }
            let listString = '--- DANH SÁCH KEY ĐANG HOẠT ĐỘNG ---\n';
            keyStorage.forEach((data, name) => {
                listString += `• Tên: ${name} | Loại UI: ${data.type === 'dep' ? 'UI Đẹp' : 'UI Thường'}\n`;
            });
            listString += '-------------------------------------';
            return int.reply({ content: listString, ephemeral: true }).catch(console.error);
        }
        if (commandName === 'deletekey') {
            const name = options.getString('name').trim();
            if (!keyStorage.has(name)) {
                return int.reply({ content: `Không tìm thấy key nào có tên là "${name}" để xóa.`, ephemeral: true }).catch(console.error);
            }
            await int.deferReply({ ephemeral: true });
            keyStorage.delete(name);
            await syncDatabaseToGitHub();
            return int.editReply({ content: `Đã xóa hoàn toàn key "${name}" ra khỏi hệ thống.` });
        }
        if (commandName === 'changekey') {
            const namekey = options.getString('namekey').trim();
            const newvalue = options.getString('newvalue');
            const type = options.getString('type');

            if (!keyStorage.has(namekey)) {
                return int.reply({ content: `Không tìm thấy key nào có tên là "${namekey}".`, ephemeral: true }).catch(console.error);
            }

            await int.deferReply({ ephemeral: true });
            keyStorage.set(namekey, { value: newvalue, type });
            await syncDatabaseToGitHub();
            return int.editReply({ content: `Đã sửa đổi thông tin và đồng bộ vĩnh viễn key "${namekey}" lên GitHub thành công!` });
        }
    }

    if (int.isButton()) {
        try {
            const customId = int.customId;
            if (customId.startsWith('copy_mobile_') || customId.startsWith('copy_pc_')) {
                const isMobile = customId.startsWith('copy_mobile_');
                const targetId = isMobile ? customId.replace('copy_mobile_', '') : customId.replace('copy_pc_', '');
                
                let foundKeyData = null;
                for (let [name, data] of keyStorage.entries()) {
                    const currentHex = Buffer.from(name.toLowerCase().trim()).toString('hex');
                    if (currentHex === targetId) {
                        foundKeyData = data;
                        break;
                    }
                }

                if (!foundKeyData) {
                    return await int.reply({ content: 'Lỗi: Key này không còn tồn tại trên hệ thống.', ephemeral: true });
                }

                const scriptContent = foundKeyData.value;
                const sendContent = isMobile ? `\`${scriptContent}\`` : `\`\`\`lua\n${scriptContent}\n\`\`\``;

                if (sendContent.length > 2000) {
                    const buffer = Buffer.from(scriptContent, 'utf-8');
                    const file = new AttachmentBuilder(buffer, { name: 'script.txt' });
                    return await int.reply({ content: 'Script quá dài. Tải file về tại đây:', files: [file], ephemeral: true });
                }

                return await int.reply({ content: sendContent, ephemeral: true });
            }
        } catch (error) {
            if (!int.replied) await int.reply({ content: 'Hệ thống gặp sự cố khi trích xuất dữ liệu key.', ephemeral: true }).catch(() => {});
        }
    }
});

process.on('unhandledRejection', error => { console.error(error); });
process.on('uncaughtException', error => { console.error(error); });

client.login(process.env.DISCORD_TOKEN);

