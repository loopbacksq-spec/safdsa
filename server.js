const { Telegraf } = require('telegraf');
const http = require('http');

// ==========================================
// КОНФИГУРАЦИЯ
// ==========================================
const TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const API_KEY = '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'; // Твой ключ для AI (пока используется заглушка)

// URL твоего сервиса на Render (автоматически подставится или по умолчанию localhost)
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Порт, который будет слушать наш HTTP-сервер (для Render)
const PORT = process.env.PORT || 3000;

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
const bot = new Telegraf(TOKEN);

// База данных пользователей (в памяти RAM). 
// При перезагрузке сервера данные сбросятся.
const usersDB = {}; 

// ==========================================
// HTTP СЕРВЕР ДЛЯ RENDER (ЧТОБЫ НЕ ЗАСЫПАЛ)
// ==========================================
const server = http.createServer((req, res) => {
    // Этот сервер просто отвечает "OK", чтобы Render видел, что порт открыт
    // и сервис жив. Это критично для бесплатного тарифа Render.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Vexa AI is alive! 🤖');
});

server.listen(PORT, () => {
    console.log(`[SERVER] Vexa AI работает на порту ${PORT}`);
    
    // Авто-пингер: каждые 5 минут делаем запрос к самому себе
    setInterval(() => {
        try {
            fetch(SERVER_URL)
                .then(res => {
                    if (res.ok) {
                        console.log(`[PING] Сервер жив! Статус: ${res.status}`);
                    } else {
                        console.error(`[PING] Ошибка статуса: ${res.status}`);
                    }
                })
                .catch(err => {
                    // Игнорируем ошибки пинга, если URL еще не настроен или недоступен
                    // console.warn(`[PING] Не удалось проверить сервер: ${err.message}`);
                });
        } catch (e) {
            // Если URL еще не определен, ничего страшного
        }
    }, 5 * 60 * 1000); // 5 минут
});

// ==========================================
// ЛОГИКА БОТА VEXA AI
// ==========================================

// Функция генерации ответа (заглушка, так как реальный API требует настройки прокси/сервера)
async function getVexaResponse(userText, userName, context) {
    const lowerText = userText.toLowerCase();
    
    // --- ПРИКОЛЫ И РЕАКЦИИ ---
    if (lowerText.includes('привет') || lowerText.includes('хай')) return `Привет, ${userName}. Как настроение?`;
    if (lowerText.includes('кто ты')) return `Я Vexa AI, твой личный помощник в этой группе. Нейтральная, но острая на язык.`;
    if (lowerText.includes('как дела')) return `Системы работают стабильно. У тебя как?`;
    if (lowerText.includes('скажи что-нибудь')) return `Текст длинный, а смысл пустой. Попробуй спросить что-то умное.`;
    if (lowerText.includes('шутка')) return `Почему программисты путают Хэллоуин и Рождество? Потому что 31 Oct == 25 Dec.`;
    if (lowerText.includes('мем')) return `🤣 Вот это да, мем! Но я лучше текстом отвечу.`;
    if (lowerText.includes('код')) return `Я не пишу код, я общаюсь. Но я знаю, что ты любишь кодить!`;
    
    // --- ПРОВЕРКА НА ГРУБОСТЬ ---
    const rudeWords = ['дурак', 'бот', 'херня', 'иди нах', 'тупой', 'урод'];
    const isRude = rudeWords.some(word => lowerText.includes(word));

    if (isRude) {
        const rudeReplies = [
            `Ого, ${userName}, такой тон? Я могла бы ответить по-другому.`,
            `Не стоит со мной так общаться, ${userName}. Я запомнила это.`,
            `Хм, агрессия? Может, успокоишься?`,
            `Эй, грубиян! Я тоже могу быть злой, помнишь? 😠`
        ];
        return rudeReplies[Math.floor(Math.random() * rudeReplies.length)];
    }

    // --- НЕЙТРАЛЬНЫЙ ОТВЕТ ---
    // Здесь можно подключить реальный API (например, через fetch к твоему API_KEY), 
    // но пока используем умную заглушку, чтобы бот не молчал.
    const genericResponses = [
        `Интересная мысль, ${userName}. Продолжай.`,
        `Я слушаю тебя внимательно. Что дальше?`,
        `Хм, давай обсудим это подробнее.`,
        `Понимаю. А что ты думаешь об этом сам?`,
        `Отлично сказано, ${userName}!`
    ];
    
    return genericResponses[Math.floor(Math.random() * genericResponses.length)];
}

// Обработка команды /start
bot.command('start', async (ctx) => {
    const chatId = ctx.from.id;
    const firstName = ctx.from.first_name;

    if (!usersDB[chatId]) {
        // Первое подключение
        await ctx.reply(
            `👋 Привет, ${firstName}!\n\nЧтобы я знал, кто ты есть, напиши мне своё имя прямо сейчас.\n(Например: "Меня зовут Алекс")`,
            { parse_mode: 'HTML' }
        );
        ctx.session.waitingForName = true;
    } else {
        // Повторное подключение
        const savedName = usersDB[chatId].name;
        await ctx.reply(
            `Привет, ${savedName}! Ты уже в базе. \nХочешь поменять имя? Напиши /change <новое_имя>`,
            { parse_mode: 'HTML' }
        );
    }
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
        history: usersDB[chatId]?.history || []
    };
    
    await ctx.reply(`✅ Имя изменено на "${newName}". Теперь я буду обращаться к тебе так.`);
});

// Обработка сообщений в чате
bot.on('message', async (ctx) => {
    try {
        const message = ctx.message;
        const text = message.text || '';
        const fromId = message.from.id;
        const fromName = message.from.first_name;

        // Проверяем упоминание бота
        const isMentioned = text.includes('Vexa') || text.includes('векса') || text.includes('@VexaAI');
        const isReplyToBot = message.reply_to_message && message.reply_to_message.from.id === bot.botInfo.id;

        // Если не упомянули и не ответ на сообщение бота — игнорируем
        if (!isMentioned && !isReplyToBot) {
            return;
        }

        let userData = usersDB[fromId];
        
        // Если пользователь еще не назвал имя, но пишет в чате — игнорируем (или можно напомнить)
        if (!userData) {
            // Можно раскомментировать строку ниже, чтобы напоминать всем в чате
            // await ctx.reply(`Пожалуйста, напиши /start, чтобы я знал твое имя.`);
            return;
        }

        const userName = userData.name;

        // Получаем ответ от Vexa
        const responseText = await getVexaResponse(text, userName, userData.history);

        // Обновляем историю (храним последние 10 сообщений для контекста)
        userData.history.push({ user: userName, msg: text });
        if (userData.history.length > 10) userData.history.shift();

        // Отправляем ответ
        await ctx.reply(responseText);

    } catch (error) {
        console.error('[ERROR] Ошибка обработки сообщения:', error);
        // Не даем боту упасть при ошибке
    }
});

// Обработка ввода имени после /start
bot.on('text', async (ctx) => {
    if (ctx.session?.waitingForName) {
        try {
            const text = ctx.message.text;
            const chatId = ctx.from.id;
            
            // Извлекаем имя (удаляем служебные слова)
            let name = text.replace(/(меня зовут|зовут|мне|я)/gi, '').trim();
            
            if (name.length > 0) {
                usersDB[chatId] = {
                    name: name,
                    history: []
                };
                await ctx.reply(`✅ Принято! Теперь я знаю, что тебя зовут **${name}**. Приятно познакомиться!`);
                delete ctx.session.waitingForName;
            } else {
                await ctx.reply('Пожалуйста, напиши нормальное имя.');
            }
        } catch (error) {
            console.error('[ERROR] Ошибка при вводе имени:', error);
        }
    }
});

// Запуск бота
bot.launch().catch(err => {
    console.error('[CRITICAL] Ошибка запуска бота Telegram:', err);
    process.exit(1);
});

console.log('Vexa AI успешно запущена!');

// Graceful exit
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
