const { Telegraf } = require('telegraf');
const http = require('http');

// ==========================================
// НАСТРОЙКИ
// ==========================================
const TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const API_KEY = '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'; // Твой ключ (пока не используется для реального AI, но оставил)

// URL для пингера (Render подставит сам при деплое, иначе localhost)
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
const bot = new Telegraf(TOKEN);

// База данных пользователей (хранится в памяти RAM)
// Структура: { userId: { name: "Имя", waitingForName: false } }
const usersDB = {}; 

// ==========================================
// HTTP СЕРВЕР (ЧТОБЫ RENDER НЕ ВЫКЛЮЧАЛ БОТА)
// ==========================================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Vexa AI is alive! 🤖');
});

server.listen(PORT, () => {
    console.log(`[SERVER] Vexa AI слушает порт ${PORT}`);
    
    // Авто-пингер каждые 5 минут
    setInterval(() => {
        fetch(SERVER_URL).catch(() => {}); 
    }, 5 * 60 * 1000);
});

// ==========================================
// ЛОГИКА ОТВЕТОВ (VEXA AI)
// ==========================================
async function getResponse(text, userName) {
    const lowerText = text.toLowerCase();

    // --- ПРИКОЛЫ И ШУТКИ ---
    if (lowerText.includes('привет') || lowerText.includes('хай')) return `Привет, ${userName}! Как настроение?`;
    if (lowerText.includes('кто ты')) return `Я Vexa AI, твой умный помощник. Нейтральная, но острая.`;
    if (lowerText.includes('как дела')) return `Системы работают отлично. У тебя как?`;
    if (lowerText.includes('шутка')) return `Почему программисты путают Хэллоуин и Рождество? 31 Oct == 25 Dec.`;
    if (lowerText.includes('код')) return `Я не пишу код, я общаюсь. Но я знаю, что ты любишь кодить!`;
    if (lowerText.includes('мем')) return `🤣 Вот это да, мем! Но я лучше текстом отвечу.`;

    // --- ПРОВЕРКА НА ГРУБОСТЬ ---
    const rudeWords = ['дурак', 'бот', 'херня', 'иди нах', 'тупой', 'урод'];
    const isRude = rudeWords.some(word => lowerText.includes(word));

    if (isRude) {
        const replies = [
            `Ого, ${userName}, такой тон? Я могу ответить по-другому.`,
            `Не стоит со мной так общаться, ${userName}. Я запомнила это.`,
            `Хм, агрессия? Может, успокоишься? 😠`
        ];
        return replies[Math.floor(Math.random() * replies.length)];
    }

    // --- ОБЫЧНЫЙ ОТВЕТ ---
    const normalReplies = [
        `Интересно, ${userName}. Продолжай.`,
        `Я слушаю тебя внимательно. Что дальше?`,
        `Отлично сказано, ${userName}!`,
        `Понимаю. А что ты думаешь об этом сам?`,
        `Хороший вопрос, ${userName}.`
    ];
    return normalReplies[Math.floor(Math.random() * normalReplies.length)];
}

// ==========================================
// КОМАНДЫ
// ==========================================

// Команда /start
bot.command('start', async (ctx) => {
    const chatId = ctx.from.id;
    const firstName = ctx.from.first_name;

    // Если пользователь уже есть в базе и имя задано
    if (usersDB[chatId]?.name) {
        await ctx.reply(
            `Привет, ${usersDB[chatId].name}! Ты уже в базе.\n\nХочешь поменять имя? Напиши /change <новое_имя>`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    // Первое подключение: просим имя
    await ctx.reply(
        `👋 Привет, ${firstName}!\n\nЧтобы я знал, кто ты есть, напиши мне своё имя прямо сейчас.\n(Например: "Меня зовут Алекс")`,
        { parse_mode: 'HTML' }
    );

    // Запоминаем, что ждем имя
    usersDB[chatId] = { name: null, waitingForName: true };
});

// Команда смены имени
bot.command('change', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('Формат: /change НовоеИмя');
    }
    const newName = args.slice(1).join(' ');
    const chatId = ctx.from.id;

    usersDB[chatId] = {
        name: newName,
        waitingForName: false
    };

    await ctx.reply(`✅ Имя изменено на "${newName}". Теперь я буду обращаться к тебе так.`);
});

// ==========================================
// ОСНОВНАЯ ЛОГИКА (ОБРАБОТКА СООБЩЕНИЙ)
// ==========================================

bot.on('message', async (ctx) => {
    try {
        const message = ctx.message;
        const text = message.text || '';
        const fromId = message.from.id;
        const fromName = message.from.first_name;

        // 1. Проверяем условие ответа
        // Ищем: "Vexa", "векса" (без @), "@VexaAI", "@Vexa"
        const mentionRegex = /\b(vexa|векса)\b/i;
        const isMentioned = mentionRegex.test(text) || 
                            text.includes('@VexaAI') || 
                            text.includes('@Vexa');
        
        // Или если это ответ на сообщение самого бота
        const isReplyToBot = message.reply_to_message && message.reply_to_message.from.id === bot.botInfo.id;

        // Если не упомянули и не ответ — молчим (даже в группе)
        if (!isMentioned && !isReplyToBot) {
            return;
        }

        // 2. Проверяем, знает ли бот пользователя
        let userData = usersDB[fromId];

        if (!userData || !userData.name) {
            // Если пользователь еще не назвал имя, но пишет в чате
            // Можно отправить напоминание, но лучше молчать, чтобы не спамить
            return;
        }

        const userName = userData.name;

        // 3. Генерируем ответ
        const responseText = await getResponse(text, userName);

        // 4. Отправляем ответ
        await ctx.reply(responseText);

    } catch (error) {
        console.error('[ERROR] Ошибка обработки сообщения:', error);
    }
});

// ==========================================
// ОБРАБОТКА ВВОДА ИМЕНИ (БЕЗ СЕССИЙ)
// ==========================================
bot.on('text', async (ctx) => {
    const chatId = ctx.from.id;
    const userData = usersDB[chatId];

    // Если бот ждет имя от этого пользователя
    if (userData && userData.waitingForName) {
        const text = ctx.message.text;
        
        // Извлекаем имя: удаляем "меня зовут", "зовут", "я", "мне"
        let name = text.replace(/(меня зовут|зовут|мне|я)/gi, '').trim();
        
        // Если после очистки осталось что-то похожее на имя
        if (name.length > 0) {
            usersDB[chatId] = {
                name: name,
                waitingForName: false
            };
            
            await ctx.reply(`✅ Принято! Теперь я знаю, что тебя зовут **${name}**. Приятно познакомиться!`);
        } else {
            await ctx.reply('Пожалуйста, напиши нормальное имя (например: "Алекс").');
        }
    }
});

// ==========================================
// ЗАПУСК
// ==========================================
bot.launch().catch(err => {
    console.error('[CRITICAL] Ошибка запуска Telegram:', err);
    process.exit(1);
});

console.log('Vexa AI успешно запущена! Жду команды /start.');

// Graceful exit
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
