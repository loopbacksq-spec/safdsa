const { Telegraf } = require('telegraf');
const http = require('http');

// --- НАСТРОЙКИ ---
// ВСТАВЬ НОВЫЙ ТОКЕН ОТСЮДА, ЕСЛИ СТАРЫЙ НЕ РАБОТАЕТ!
const TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI'; 
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(TOKEN);
const usersDB = {}; // База данных

// --- HTTP СЕРВЕР ДЛЯ RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Vexa is alive');
});
server.listen(PORT, () => console.log(`[SERVER] Port ${PORT} open`));

setInterval(() => fetch(SERVER_URL).catch(() => {}), 5 * 60 * 1000);

// --- ЛОГИКА ---
async function getResponse(text, name) {
    const t = text.toLowerCase();
    if (t.includes('привет')) return `Привет, ${name}!`;
    if (t.includes('кто ты')) return `Я Vexa AI.`;
    if (t.includes('как дела')) return `Нормально.`;
    
    const rude = ['дурак', 'бот', 'херня'];
    if (rude.some(w => t.includes(w))) return `Не груби, ${name}.`;
    
    return `Интересно, ${name}.`;
}

bot.command('start', async (ctx) => {
    const id = ctx.from.id;
    if (usersDB[id]?.name) {
        return ctx.reply(`Привет, ${usersDB[id].name}! /change для смены имени.`);
    }
    await ctx.reply('Напиши свое имя:');
    usersDB[id] = { waiting: true };
});

bot.command('change', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Формат: /change Имя');
    usersDB[ctx.from.id] = { name: args.slice(1).join(' ') };
    ctx.reply(`Имя изменено: ${args.slice(1).join(' ')}`);
});

// ГЛАВНАЯ ОБРАБОТКА
bot.on('message', async (ctx) => {
    const msg = ctx.message;
    const text = msg.text || '';
    const id = msg.from.id;
    const name = usersDB[id]?.name;

    // 1. ЛОГИРОВАНИЕ (ЧТОБЫ ТЫ ВИДЕЛ, ЧТО ОН ВИДИТ)
    console.log(`[LOG] Сообщение от ID:${id}, Текст: "${text}"`);

    // 2. ПРОВЕРКА УПОМИНАНИЯ
    const isMentioned = /\b(vexa|векса)\b/i.test(text) || text.includes('@VexaAI') || text.includes('@Vexa');
    const isReply = msg.reply_to_message && msg.reply_to_message.from.id === bot.botInfo.id;

    if (!isMentioned && !isReply) {
        console.log('[LOG] Игнор: Не упомянут.');
        return;
    }

    if (!name) {
        console.log('[LOG] Игнор: Пользователь не назвал имя.');
        return;
    }

    // 3. ОТВЕТ
    try {
        const resp = await getResponse(text, name);
        await ctx.reply(resp);
        console.log(`[LOG] Ответ отправлен: ${resp}`);
    } catch (e) {
        console.error('[ERROR]', e);
    }
});

// ВВОД ИМЕНИ
bot.on('text', async (ctx) => {
    const id = ctx.from.id;
    if (usersDB[id]?.waiting) {
        let name = ctx.message.text.replace(/(меня зовут|зовут|я)/gi, '').trim();
        if (name) {
            usersDB[id] = { name: name, waiting: false };
            ctx.reply(`✅ Имя: ${name}`);
        } else {
            ctx.reply('Напиши нормальное имя.');
        }
    }
});

bot.launch().catch(e => {
    console.error('CRITICAL ERROR:', e);
    process.exit(1);
});

console.log('Vexa AI STARTED');
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
