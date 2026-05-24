const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fetch = require('node-fetch');

// --- КОНФИГУРАЦИЯ ---
const TELEGRAM_BOT_TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const AI_API_KEY = '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'; 
const AI_API_URL = 'https://api.openai.com/v1/chat/completions'; 

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
const userDatabase = {}; // { userId: { name: string, history: [], mood: string } }
let globalChatHistory = []; // История сообщений для контекста

// --- НАСТРОЙКА EXPRESS И АВТО-ПИНГ ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Vexa AI is alive! 🚀');
});

// Авто-пинг каждые 4 минуты (чтобы точно не уснул за 15 мин)
setInterval(async () => {
    try {
        console.log('[AUTO-PING] Отправка пинга...');
        await fetch(`http://${process.env.RENDER_HOSTNAME || 'localhost'}:${PORT}/`);
        console.log('[AUTO-PING] Сервер активен! Vexa жива.');
    } catch (e) {
        console.error('[AUTO-PING] Ошибка пинга:', e.message);
    }
}, 4 * 60 * 1000); 

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// --- ЛОГИКА БОТА ---

// Обработка /start
bot.start((ctx) => {
    const userId = ctx.from.id;
    console.log(`[START] Пользователь ${userId} начал диалог.`);
    
    if (!userDatabase[userId]) {
        ctx.reply(
            '👋 Привет! Я Vexa.\n\nЧтобы я знала, кто ты, напиши свое имя прямо сейчас.',
            Markup.keyboard([['Ваше имя']]).oneTime().resize()
        );
        
        // Слушаем ответ на имя
        bot.on('text', (msg) => {
            if (msg.from.id === userId && msg.text !== '/start') {
                const name = msg.text.trim();
                if (name.length > 1) {
                    userDatabase[userId] = {
                        name: name,
                        history: [],
                        mood: 'neutral',
                        lastInteraction: Date.now()
                    };
                    console.log(`[DB] Сохранено имя: ${name} для ID ${userId}`);
                    ctx.reply(`✅ Принято! Теперь я знаю, что тебя зовут **${name}**. \n\nТеперь в группах пиши "Векса" или "Vexa", и я отвечу! 😎`, { parse_mode: 'Markdown' });
                    
                    // Убираем клавиатуру
                    bot.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.message.message_id, null);
                } else {
                    ctx.reply('⚠️ Имя слишком короткое. Попробуй еще раз.');
                }
            }
        });
    } else {
        const userData = userDatabase[userId];
        ctx.reply(
            `Привет снова, **${userData.name}**! 👋\n\nТы уже в базе.\n\nХочешь изменить имя? Напиши новое, и я обновлю данные.`,
            Markup.keyboard([['Изменить имя']]).oneTime().resize()
        );
        
        bot.on('text', (msg) => {
            if (msg.from.id === userId && msg.text !== '/start') {
                const newName = msg.text.trim();
                if (newName.length > 1) {
                    userDatabase[userId].name = newName;
                    console.log(`[DB] Имя изменено: ${newName} для ID ${userId}`);
                    ctx.reply(`✅ Готово! Теперь я буду называть тебя **${newName}**. 😎`);
                    bot.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.message.message_id, null);
                } else {
                    ctx.reply('Имя должно быть длиннее.');
                }
            }
        });
    }
});

// Функция генерации ответа
async function generateAIResponse(userMessage, context, userName) {
    try {
        const systemPrompt = `Ты Vexa AI — умный, живой помощник в Telegram.
        Твой стиль: живой, без шаблонов, иногда с юмором и приколом.
        Характер: нейтральный. Если пользователь грубит — отвечай жестко/саркастично, но старайся мириться.
        Не используй фразы типа "мой дорогой". Пиши как человек.
        Пользователь: ${userName || 'неизвестный'}.
        Контекст (последние сообщения): ${context.slice(-5).join(' | ')}`;

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
        ];

        console.log(`[API] Отправка запроса для пользователя ${userName}...`);
        
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: messages,
                temperature: 0.9,
                max_tokens: 200
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[API ERROR] Статус: ${response.status}, Ответ: ${errorText}`);
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.choices && data.choices.length > 0) {
            const reply = data.choices[0].message.content;
            console.log(`[API] Получен ответ: ${reply.substring(0, 50)}...`);
            return reply;
        } else {
            return "Я немного запуталась в ответах. Давай попробуем еще раз!";
        }
    } catch (error) {
        console.error(`[CRITICAL ERROR] Генерация провалилась:`, error.message);
        return "❌ Ой, что-то пошло не так с моим мозгом (ошибка API). Попробуй позже!";
    }
};

// ОБРАБОТКА ВСЕХ СООБЩЕНИЙ
bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const fromId = ctx.from.id;
    const text = ctx.message.text || '';
    const username = ctx.from.username || 'anon';

    // Добавляем в историю
    if (globalChatHistory.length > 20) globalChatHistory.shift();
    globalChatHistory.push({ sender: username, text: text, time: Date.now() });

    // Усиленный поиск упоминания: Vexa, Векса, @Vexa, @Векса (любой регистр)
    // Регулярное выражение ищет слово целиком
    const mentionRegex = /\b(vexa|векса|@vexa|@векса)\b/i;
    const isMentioned = mentionRegex.test(text);

    if (isMentioned) {
        console.log(`[GROUP] Обнаружено упоминание Vexa от пользователя ${username} (${fromId}) в чате ${chatId}`);
        
        // Проверяем базу
        let userName = userDatabase[fromId]?.name;
        
        if (!userName) {
            console.log(`[WARN] Пользователь ${username} упомянул Vexa, но его нет в базе.`);
            
            // Защита от спама: проверяем, не писал ли он уже инструкцию недавно
            const recentMsgs = globalChatHistory.filter(m => m.sender === username && Date.now() - m.time < 120000);
            const alreadyNotified = recentMsgs.some(m => m.text.includes('/start'));

            if (!alreadyNotified) {
                ctx.reply(
                    `👋 Привет! Я вижу, ты меня позвал. Но я пока не знаю твоего имени.\n\n🔒 Чтобы я могла отвечать тебе в группе и помнить разговоры:\n1. Зайди в мои **Личные Сообщения** (ЛС).\n2. Нажми **/start**.\n3. Напиши своё имя.\n\nПосле этого я сразу узнаю тебя! 😉`,
                    { parse_mode: 'Markdown' }
                );
            }
            return; // Прерываем, если имени нет
        }

        // Если имя есть, готовим контекст
        const contextStr = globalChatHistory.map(m => `${m.sender}: ${m.text}`).join('\n');
        
        // Генерируем ответ
        console.log(`[GEN] Генерация ответа для ${userName}...`);
        const aiResponse = await generateAIResponse(text, globalChatHistory, userName);

        // Форматируем ответ
        const finalResponse = `🤖 **${userName}**, вот мой ответ:\n\n${aiResponse}`;
        
        console.log(`[SEND] Отправка ответа в чат ${chatId}`);
        ctx.reply(finalResponse, { parse_mode: 'Markdown' });
    }
});

// Запуск
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    bot.launch();
    console.log('🤖 Vexa AI успешно запущена! Следите за логами.');
});

// Graceful shutdown
process.once('SIGINT', () => { bot.stop('SIGINT'); console.log('Shutting down...'); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); console.log('Shutting down...'); });
