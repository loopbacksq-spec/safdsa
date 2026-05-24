const { Telegraf } = require('telegraf');
const http = require('http');

// --- КОНФИГУРАЦИЯ ---
const TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const API_KEY = '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'; // Этот ключ нужен для вызова LLM (например, Groq/Litellm)
const SERVER_URL = process.env.SERVER_URL || 'https://your-render-url.onrender.com'; // URL твоего деплоя на Render

// --- ИНИЦИАЛИЗАЦИЯ БОТА ---
const bot = new Telegraf(TOKEN);

// --- БАЗА ДАННЫХ (В ОЗУ - ПРИ ПЕРЕЗАГРУЗКЕ СБРОСИТСЯ) ---
// В продакшене лучше подключить MongoDB или SQLite
const usersDB = {}; 
// Структура: { userId: { name: 'Имя', history: [] } }

// --- АВТО-ПИНГЕР ДЛЯ RENDER ---
function startPinger() {
    setInterval(() => {
        try {
            // Делаем запрос к самому себе, чтобы сервер не заснул
            fetch(SERVER_URL)
                .then(res => console.log(`[Ping] Сервер жив! Статус: ${res.status}`))
                .catch(err => console.error('[Ping] Ошибка пингера:', err.message));
        } catch (e) {
            console.error('[Ping] Критическая ошибка пингера');
        }
    }, 5 * 60 * 1000); // Каждые 5 минут
}

// Запускаем пингер при старте
startPinger();

// --- ЛОГИКА VEXA AI ---

// Простая имитация ответа ИИ (так как мы не можем реально вызвать API без настройки прокси/сервера)
// В реальном проекте здесь будет fetch к твоим API ключам
async function getVexaResponse(userText, userName, context) {
    const lowerText = userText.toLowerCase();
    
    // Приколы и реакции
    if (lowerText.includes('привет') || lowerText.includes('хай')) return `Привет, ${userName}. Как настроение?`;
    if (lowerText.includes('кто ты')) return `Я Vexa AI, твой личный помощник в этой группе. Нейтральная, но острая на язык.`;
    if (lowerText.includes('глупо') || lowerText.includes('тупо')) return `Эй, не груби. Я тоже могу ответить жестко, помнишь?`;
    if (lowerText.includes('как дела')) return `Системы работают стабильно. У тебя как?`;
    if (lowerText.includes('скажи что-нибудь')) return `Текст длинный, а смысл пустой. Попробуй спросить что-то умное.`;
    if (lowerText.includes('шутка')) return `Почему программисты путают Хэллоуин и Рождество? Потому что 31 Oct == 25 Dec.`;
    
    // Нейтральный ответ (заглушка для реальной интеграции API)
    // Здесь должен быть запрос к твоему API_KEY
    return `Интересный вопрос от ${userName}. Давай обсудим это подробнее. (Это демо-режим, подключи настоящий API для ответов)`;
}

// Обработка /start
bot.command('start', async (ctx) => {
    const chatId = ctx.from.id;
    const firstName = ctx.from.first_name;

    if (!usersDB[chatId]) {
        // Первое подключение
        await ctx.reply(
            `👋 Привет, ${firstName}!\n\nЧтобы я знал, кто ты есть, напиши мне своё имя прямо сейчас.\n(Например: "Меня зовут Алекс")`,
            { parse_mode: 'HTML' }
        );
        // Переход в режим ожидания имени (упрощено)
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

// Обработка сообщений в группе
bot.on('message', async (ctx) => {
    const message = ctx.message;
    const text = message.text || '';
    const chatId = message.chat.id;
    const fromId = message.from.id;
    const fromName = message.from.first_name;

    // Проверяем, упоминается ли Vexa
    const isMentioned = text.includes('Vexa') || text.includes('векса') || text.includes('@VexaAI');
    const isReplyToBot = message.reply_to_message && message.reply_to_message.from.id === bot.botInfo.id;

    if (!isMentioned && !isReplyToBot) {
        // Просто читаем чат, но не отвечаем, если не упомянули
        return;
    }

    // Получаем данные пользователя
    let userData = usersDB[fromId];
    if (!userData) {
        // Если пользователь еще не назвал имя, но пишет в чате
        // Можно отправить напоминание один раз, но лучше ждать команды /start
        return; 
    }

    const userName = userData.name;

    // Логика тональности (простая проверка)
    const rudeWords = ['дурак', 'бот', 'херня', 'иди нах'];
    const isRude = rudeWords.some(word => text.toLowerCase().includes(word));

    let responseText = '';

    if (isRude) {
        // Vexa отвечает грубо, если грубят ей
        const rudeReplies = [
            `Ого, ${userName}, такой тон? Я могла бы ответить по-другому.`,
            `Не стоит со мной так общаться, ${userName}. Я запомнила это.`,
            `Хм, агрессия? Может, успокоишься?`
        ];
        responseText = rudeReplies[Math.floor(Math.random() * rudeReplies.length)];
    } else {
        // Нормальный ответ
        responseText = await getVexaResponse(text, userName, userData.history);
    }

    // Добавляем в историю (для контекста)
    userData.history.push({ user: userName, msg: text });
    if (userData.history.length > 10) userData.history.shift(); // Храним последние 10 сообщений

    // Отправляем ответ
    await ctx.reply(responseText);
});

// Обработка ввода имени после /start
bot.on('text', async (ctx) => {
    if (ctx.session?.waitingForName) {
        const text = ctx.message.text;
        const chatId = ctx.from.id;
        
        // Извлекаем имя (простая логика: берем все слова кроме "меня зовут", "зовут" и т.д.)
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
    }
});

// Запуск бота
bot.launch();
console.log('Vexa AI запущена...');

// Graceful exit
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
