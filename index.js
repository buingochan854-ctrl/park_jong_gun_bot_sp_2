const { Client, GatewayIntentBits, AttachmentBuilder, SlashCommandBuilder, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// --- 1. WEB SERVER GIỮ BOT ONLINE ---
const app = express(); 
const PORT = process.env.PORT || 10000; 
app.get('/', (req, res) => res.status(200).send('Park Jong Gun Bot đang chạy!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Web Server định tuyến tại port: ${PORT}`));

// --- 2. CẤU HÌNH BOT & BỘ NHỚ LƯU KEY ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = "+";
const OWNER_ID = "1455796719378895022"; // ID của bạn
const keyStorage = new Map(); // Nơi lưu trữ Key tạm thời
const videoRegex = /https?:\/\/(www\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/\S+/i;

client.on('clientReady', async () => {
    console.log(`Bot Online: ${client.user.tag}`);

    // Chỉ giữ lại các lệnh quản trị hệ thống Key cho bạn (Xóa bỏ hoàn toàn lệnh getkey)
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

// --- 3. TỰ ĐỘNG QUÉT TIN NHẮN (TẢI VIDEO & TỰ ĐỘNG TRẢ KEY) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const rawContent = message.content.trim();
    const contentLower = rawContent.toLowerCase();

    // 3.1 Kiểm tra lệnh cơ bản
    if (contentLower === `${PREFIX}ping`) {
        return message.reply(`Pong! Park Jong Gun vẫn đang online`).catch(err => console.error(err));
    }

    // 3.2 TỰ ĐỘNG NHẬN DIỆN TÊN KEY KHÔNG CẦN LỆNH
    // Bot sẽ check xem tin nhắn của user gửi lên có trùng khớp với tên key nào trong Map không
    if (keyStorage.has(rawContent)) {
        const keyData = keyStorage.get(rawContent);

        // Trường hợp Key được bạn add là UI Thường
        if (keyData.type === 'thuong') {
            return message.reply(`Thông tin key của bạn:\nTên key: ${rawContent}\nGiá trị: \`${keyData.value}\``).catch(err => console.error(err));
        }

        // Trường hợp Key được bạn add là UI Đẹp
        if (keyData.type === 'dep') {
            const embed = new EmbedBuilder()
                .setTitle('HỆ THỐNG PHÁT KEY BẢN QUYỀN')
                .setDescription(`Tên Key: **${rawContent}**\nVui lòng chọn thiết bị bạn đang sử dụng bên dưới để tiến hành sao chép Key chỉ với một chạm.`)
                .setColor('#2b2d31')
                .setFooter({ text: 'Park Jong Gun Bot điều hành' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`copy_mobile_${rawContent}`)
                    .setLabel('COPY MOBILE')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`copy_pc_${rawContent}`)
                    .setLabel('COPY PC')
                    .setStyle(ButtonStyle.Success)
            );

            return message.reply({ embeds: [embed], components: [row] }).catch(err => console.error(err));
        }
    }

    // 3.3 Tự động bắt link tải video
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
        } catch (e) { console.error(e.message); }
    }
});

// --- 4. XỬ LÝ LỆNH SLASH CHO QUẢN TRỊ VIÊN & INTERACTION NÚT BẤM ---
client.on('interactionCreate', async (int) => {
    // 4.1 XỬ LÝ LỆNH SLASH
    if (int.isChatInputCommand()) {
        const { commandName, options, user } = int;

        if (['addkey', 'listkey', 'deletekey'].includes(commandName) && user.id !== OWNER_ID) {
            return int.reply({ content: 'Bạn không có quyền thêm key!', ephemeral: true }).catch(err => console.error(err));
        }

        if (commandName === 'status') {
            const memoryUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            return int.reply(`Bot đang hoạt động ổn định! RAM tiêu thụ: ${memoryUsed} MB. Hệ thống âm nhạc đã được tắt nhường chỗ cho Jockie Music`).catch(err => console.error(err));
        }

        if (commandName === 'addkey') {
            const name = options.getString('name').trim();
            const value = options.getString('value');
            const type = options.getString('type');

            keyStorage.set(name, { value, type });
            return int.reply({ content: `Đã cấu hình thành công key "${name}" vào cơ sở dữ liệu hệ thống.`, ephemeral: true }).catch(err => console.error(err));
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

            keyStorage.delete(name);
            return int.reply({ content: `Đã xóa hoàn toàn key "${name}" ra khỏi hệ thống.`, ephemeral: true }).catch(err => console.error(err));
        }
    }

    // 4.2 XỬ LÝ SỰ KIỆN NÚT BẤM COPY
    if (int.isButton()) {
        const customId = int.customId;
        
        if (customId.startsWith('copy_mobile_') || customId.startsWith('copy_pc_')) {
            const isMobile = customId.startsWith('copy_mobile_');
            const keyName = isMobile ? customId.replace('copy_mobile_', '') : customId.replace('copy_pc_', '');
            const keyData = keyStorage.get(keyName);

            if (!keyData) {
                return int.reply({ content: 'Lỗi: Key này không còn tồn tại hoặc bot vừa được khởi động lại.', ephemeral: true }).catch(err => console.error(err));
            }

            if (isMobile) {
                return int.reply({ content: `\`${keyData.value}\``, ephemeral: true }).catch(err => console.error(err));
            } else {
                return int.reply({ content: `\`\`\`${keyData.value}\`\`\``, ephemeral: true }).catch(err => console.error(err));
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
