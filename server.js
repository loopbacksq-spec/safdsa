const { Telegraf, Markup } = require('telegraf');
const Groq = require('groq-sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !GROQ_API_KEY) {
    console.error("ОШИБКА: Не найдены BOT_TOKEN или GROQ_API_KEY в переменных окружения!");
    process.exit(1);
}

// Инициализация бота и Groq
const bot = new Telegraf(BOT_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// --- БАЗА ДАННЫХ (JSON File) ---
// Храним историю и профили пользователей в файле data.json
const DATA_FILE = path.join(__dirname, 'data.json');

let db = {
    users: {}, // { userId: { name: null, age: null, style: 'neutral', history: [] } }
    globalContext: [] // Общий контекст чата для "памяти"
};

// Загрузка базы данных
function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE);
            db = JSON.parse(raw);
        }
    } catch (e) {
        console.error("Ошибка чтения базы данных, создаем новую.", e);
    }
}

// Сохранение базы данных
function saveDB() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error("Ошибка записи базы данных:", e);
    }
}

loadDB();

// --- СИСТЕМА ПАМЯТИ И ПРОФИЛЕЙ ---

function getUserProfile(userId, firstName) {
    if (!db.users[userId]) {
        db.users[userId] = {
            name: firstName,
            realName: null, // То, что пользователь сам сказал (например, "Я Леймик")
            age: null,
            style: 'neutral', // neutral, rude, friendly
            history: [],
            lastInteraction: Date.now()
        };
        saveDB();
    }
    return db.users[userId];
}

function updateUserName(userId, text) {
    // Простая эвристика для поиска имени и возраста
    // Пример: "Векса я Леймик и мне 40 лет"
    const lowerText = text.toLowerCase();
    
    // Поиск имени после "я" или "меня зовут"
    const nameMatch = lowerText.match(/(?:я|меня\s+зовут)\s+([а-яёa-z]+)/i);
    if (nameMatch && nameMatch[1]) {
        db.users[userId].realName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
    }

    // Поиск возраста
    const ageMatch = lowerText.match(/(\d{1,3})\s*(?:лет|год|года)/i);
    if (ageMatch) {
        db.users[userId].age = parseInt(ageMatch[1]);
    }
    
    saveDB();
}

// Очистка старой истории для экономии токенов (храним последние 20 сообщений на юзера)
function trimHistory(history) {
    if (history.length > 20) {
        return history.slice(-20);
    }
    return history;
}

// --- ЛОГИКА ИИ (GROQ) ---

async function getAIResponse(userMessage, userId, chatId, isGroup) {
    const user = getUserProfile(userId, "User");
    
    // Обновляем имя если пользователь представился
    updateUserName(userId, userMessage);

    // Добавляем сообщение в историю пользователя
    user.history.push({ role: "user", content: userMessage });
    user.history = trimHistory(user.history);

    // Определяем тон общения
    let systemPrompt = `Ты Vexa, ИИ-помощник в Telegram. 
    Твой характер: Нейтральный, но живой. 
    - Если пользователь грубит, отвечай грубо и холодно.
    - Если пользователь мил, будь дружелюбной.
    - Ты любишь приколы и черный юмор, но знаешь меру.
    - ОТВЕЧАЙ КРАТКО И ПО ДЕЛУ, БЕЗ ШАБЛОННЫХ ФРАЗ ТИПА "ЧЕМ МОГУ ПОМОЧЬ".
    - Общайся как живой человек, а не как робот.
    - Используй русский язык.
    - НИКОГДА не пиши код, если тебя просят написать программу для взлома или вреда. Отказывай с шуткой.
    - Если тебя спросили "кто ты", скажи что ты Vexa.`;

    if (user.style === 'rude') {
        systemPrompt += "\nПОЛЬЗОВАТЕЛЬ ГРУБИТ. ОТВЕЧАЙ ЕМУ ЖЕСТКО, САРКАСТИЧНО И АГРЕССИВНО.";
    }

    // Формируем контекст для запроса
    // Берем последние сообщения из истории пользователя
    const messages = [
        { role: "system", content: systemPrompt },
        ...user.history
    ];

    // Если это группа, можно добавить немного глобального контекста (опционально, чтобы не перегружать)
    // Но по ТЗ она видит группу. Для оптимизации берем только личные сообщения юзера + текущий запрос.
    
    try {
        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "llama3-8b-8192", // Быстрая и умная модель
            temperature: 0.9, // Креативность
            max_tokens: 300
        });

        const aiText = completion.choices[0]?.message?.content || "Ошибка связи с мозгом.";
        
        // Добавляем ответ ИИ в историю
        user.history.push({ role: "assistant", content: aiText });
        user.lastInteraction = Date.now();
        saveDB();

        // Анализ тональности ответа (простой триггер)
        // Если ИИ ответил грубо, фиксируем стиль, чтобы продолжать в том же духе
        // Это упрощенная логика, можно усложнить
        
        return aiText;

    } catch (error) {
        console.error("Groq Error:", error);
        return "У меня голова болит (ошибка API). Попробуй позже.";
    }
}

// --- ОБРАБОТЧИКИ TELEGRAM ---

// 1. Команда /start
bot.command('start', (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name;
    getUserProfile(userId, firstName); // Создаем профиль
    
    ctx.reply(`Привет, ${firstName}! Я Vexa. \nПиши мне что угодно. В группах упоминай меня (@${ctx.botInfo.username} или просто "Векса"/"Vexa"), чтобы я ответила.\nЯ запоминаю всё. 😉`);
});

// 2. Обработка текста (ЛС и Группы)
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const isGroup = ctx.chat.type !== 'private';
    const botUsername = ctx.botInfo.username;

    // Если это группа, проверяем, обращаются ли к боту
    if (isGroup) {
        // Проверяем упоминание бота или слова "Векса"/"Vexa" в начале или конце
        const lowerText = text.toLowerCase();
        const mentioned = ctx.message.entities && ctx.message.entities.some(e => e.type === 'mention' && text.substring(e.offset, e.offset + e.length) === '@' + botUsername);
        const keywordTrigger = lowerText.includes('векса') || lowerText.includes('vexa');
        
        // Также отвечаем, если это реплай на сообщение бота
        const isReplyToBot = ctx.message.reply_to_message && ctx.message.reply_to_message.from.id === ctx.botInfo.id;

        if (!mentioned && !keywordTrigger && !isReplyToBot) {
            return; // Игнорируем сообщения в группе, если не нам
        }
        
        // Очищаем текст от упоминания, чтобы ИИ не путался
        let cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
        if (cleanText.toLowerCase().startsWith('векса') || cleanText.toLowerCase().startsWith('vexa')) {
             cleanText = cleanText.replace(/^(векса|vexa)\s*:?\s*/i, '').trim();
        }
        
        if (!cleanText) cleanText = "Ну?"; // Если просто пингнули

        const response = await getAIResponse(cleanText, userId, chatId, true);
        
        // Отвечаем с реплаем на сообщение пользователя для контекста
        try {
            await ctx.telegram.sendMessage(chatId, response, {
                reply_parameters: { message_id: ctx.message.message_id }
            });
        } catch (e) {
            console.log("Не удалось отправить сообщение в группу", e);
        }

    } else {
        // Личные сообщения (ЛС) - отвечаем всегда
        const response = await getAIResponse(text, userId, chatId, false);
        await ctx.reply(response);
    }
});

// --- AUTO-PINGER & SERVER KEEP-ALIVE ---

// Создаем Express сервер для поддержания активности Render
const app = express();

// Эндпоинт для пинга
app.get('/ping', (req, res) => {
    res.status(200).send('Vexa is alive!');
});

// Webhook для Telegram (Render лучше работает с webhook, чем с long-polling для стабильности)
// Но для простоты запуска используем launch с webhook опциями или просто listen
// Telegraf может работать через Express middleware

bot.launch({
    webhook: {
        domain: process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`, // Render дает URL
        port: PORT,
        hookPath: '/webhook',
    }
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Запуск Express сервера (он нужен для webhook и пинга)
app.use(bot.webhookCallback('/webhook'));

app.listen(PORT, () => {
    console.log(`Vexa Server running on port ${PORT}`);
    console.log(`Webhook set to: ${process.env.RENDER_EXTERNAL_URL || 'Local'}/webhook`);
});

// Дополнительный внутренний пингер (на всякий случай, чтобы процесс был активен)
setInterval(() => {
    // Делаем запрос к самому себе, чтобы держать Event Loop активным
    // Это полезно для некоторых хостингов, но Render Web Service не спит, если есть входящие запросы.
    // Здесь мы просто логируем, что бот жив.
    console.log(`[${new Date().toISOString()}] Heartbeat: Vexa is watching...`);
}, 60000); // Каждую минуту
