const { Telegraf } = require('telegraf');
const http = require('http');

// --- КОНФИГУРАЦИЯ ---
const TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const API_KEY = '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';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;

// --- ИНИЦИАЛИЗАЦИЯ ---
const bot = new Telegraf(TOKEN);

// База данных пользователей
const usersDB = {}; 

// --- HTTP СЕРВЕР ДЛЯ RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Vexa AI is alive! 🤖');
});

server.listen(PORT, () => {
    console.log(`[SERVER] Vexa AI работает на порту ${PORT}`);
    
    // Авто-пингер
    setInterval(() => {
        try {
            fetch(SERVER_URL).catch(e => {});
        } catch (e) {}
    }, 5 * 60 * 1000);
});

// --- ЛОГИКА БОТА ---

async function getVexaResponse(userText, userName) {
    const lowerText = userText.toLowerCase();
    
    if (lowerText.includes('привет') || lowerText.includes('хай')) return `Привет, ${userName}. Как настроение?`;
    if (lowerText.includes('кто ты')) return `Я Vexa AI, твой личный помощник в этой группе.`;
    if (lowerText.includes('как дела')) return `Системы работают стабильно. У тебя как?`;
    if (lowerText.includes('шутка')) return `Почему программисты путают Хэллоуин и Рождество? Потому что 31 Oct == 25 Dec.`;
    if (lowerText.includes('код')) return `Я не пишу код, я общаюсь. Но я знаю, что ты любишь кодить!`;
    
    const rudeWords = ['дурак', 'бот', 'херня', 'иди нах', 'тупой'];
    const isRude = rudeWords.some(word => lowerText.includes(word));

    if (isRude) {
        const replies = [
            `Ого, ${userName}, такой тон? Я могла бы ответить по-другому.`,
            `Не стоит со мной так общаться, ${userName}.`,
            `Хм, агрессия? Может, успокоишься?`
        ];
        return replies[Math.floor(Math.random() * replies.length)];
    }

    const generic = [
        `Интересная мысль, ${userName}. Продолжай.`,
        `Я слушаю тебя внимательно. Что дальше?`,
        `Отлично сказано, ${userName}!`
    ];
    return generic[Math.floor(Math.random() * generic.length)];
}

// Обработка /start
bot.command('start', async (ctx) => {
    const chatId = ctx.from.id;
    const firstName = ctx.from.first_name;

    // Если имя уже есть
    if (usersDB[chatId]?.name) {
        await ctx.reply(
            `Привет, ${usersDB[chatId].name}! Ты уже в базе.\nХочешь поменять имя? Напиши /change <новое_имя>`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    // Первое подключение - ждем имя
    await ctx.reply(
        `👋 Привет, ${firstName}!\n\nЧтобы я знал, кто ты есть, напиши мне своё имя прямо сейчас.\n(Например: "Меня зовут Алекс")`,
        { parse_mode: 'HTML' }
    );
    
    // Сохраняем флаг ожидания имени прямо в объект пользователя
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
        history: []
    };
    
    await ctx.reply(`✅ Имя изменено на "${newName}". Теперь я буду обращаться к тебе так.`);
});

// ГЛАВНАЯ ОБРАБОТКА СООБЩЕНИЙ
bot.on('message', async (ctx) => {
    const message = ctx.message;
    const text = message.text || '';
    const fromId = message.from.id;
    const fromName = message.from.first_name;

    // 1. Проверяем, упомянули ли бота
    // Ищем: "Vexa", "векса", "@VexaAI", "Vexa " (с пробелом), "Vexa," (с запятой)
    const mentionRegex = /\b(vexa|векса)\b/i;
    const isMentioned = mentionRegex.test(text) || 
                        text.includes('@VexaAI') || 
                        text.includes('@Vexa');

    // 2. Проверяем, ответ ли это на сообщение бота
    const isReplyToBot = message.reply_to_message && message.reply_to_message.from.id === bot.botInfo.id;

    // Если не упомянули и не ответ — игнорируем (чтобы не спамить)
    if (!isMentioned && !isReplyToBot) {
        return;
    }

    // 3. Получаем данные пользователя
    let userData = usersDB[fromId];

    // Если пользователь еще не назвал имя, но пишет в чате
    if (!userData || !userData.name) {
        // Можно отправить одно напоминание, если он еще не заходил в /start
        // Но лучше молчать, чтобы не раздражать других участников
        return;
    }

    const userName = userData.name;

    // 4. Генерируем ответ
    let responseText = '';
    try {
        responseText = await getVexaResponse(text, userName);
    } catch (err) {
        console.error('[ERROR] Ошибка генерации ответа:', err);
        responseText = `Ошибка при обработке, ${userName}. Попробуй позже.`;
    }

    // 5. Обновляем историю
    if (!userData.history) userData.history = [];
    userData.history.push({ user: userName, msg: text });
    if (userData.history.length > 10) userData.history.shift();

    // 6. Отправляем ответ
    try {
        await ctx.reply(responseText);
    } catch (err) {
        console.error('[ERROR] Ошибка отправки:', err);
    }
});

// ОТДЕЛЬНАЯ ОБРАБОТКА ВВОДА ИМЕНИ (без сессии)
bot.on('text', async (ctx) => {
    const chatId = ctx.from.id;
    const userData = usersDB[chatId];

    // Проверяем, ждет ли бот имя
    if (userData && userData.waitingForName) {
        const text = ctx.message.text;
        
        // Извлекаем имя: удаляем "меня зовут", "зовут", "я", "мне"
        let name = text.replace(/(меня зовут|зовут|мне|я)/gi, '').trim();
        
        // Если после очистки осталось имя
        if (name.length > 0) {
            usersDB[chatId] = {
                name: name,
                history: [],
                waitingForName: false // Снимаем флаг ожидания
            };
            
            await ctx.reply(`✅ Принято! Теперь я знаю, что тебя зовут **${name}**. Приятно познакомиться!`);
        } else {
            await ctx.reply('Пожалуйста, напиши нормальное имя (например: "Алекс").');
        }
    }
});

// ЗАПУСК
bot.launch().catch(err => {
    console.error('[CRITICAL] Ошибка запуска Telegram:', err);
    process.exit(1);
});

console.log('Vexa AI успешно запущена!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
