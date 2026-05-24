const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');

// --- ТВОИ ДАННЫЕ (ЖЕСТКО ПРОПИСАНЫ) ---
const BOT_TOKEN = "8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI";
const GROQ_API_KEY = "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";

// Инициализация
const bot = new Telegraf(BOT_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });
const app = express();
const PORT = process.env.PORT || 3000;

// --- БАЗА ДАННЫХ (Файл data.json) ---
const DATA_FILE = path.join(__dirname, 'data.json');
let db = { users: {} };

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE);
            db = JSON.parse(raw);
        }
    } catch (e) {
        console.log("База не найдена, создаем новую.");
    }
}

function saveDB() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error("Ошибка записи базы:", e);
    }
}

loadDB();

// --- ЛОГИКА VEXA ---

// Получение или создание профиля
function getProfile(userId, firstName) {
    if (!db.users[userId]) {
        db.users[userId] = {
            name: firstName,
            realName: null, // Имя, которое юзер сам сказал
            age: null,
            mood: 'neutral', // neutral, angry, happy
            history: [], // История переписки
            lastSeen: Date.now()
        };
        saveDB();
    }
    return db.users[userId];
}

// Анализ текста на наличие личных данных (Имя, Возраст)
function analyzePersonalData(userId, text) {
    const user = db.users[userId];
    const lower = text.toLowerCase();

    // Поиск имени: "я [имя]", "зовут [имя]"
    const nameMatch = lower.match(/(?:я|меня\s+зовут|мое\s+имя)\s+([а-яёa-z]+)/i);
    if (nameMatch && nameMatch[1].length > 2) {
        const newName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
        if (user.realName !== newName) {
            user.realName = newName;
            console.log(`User ${userId} identified as ${newName}`);
        }
    }

    // Поиск возраста: "мне [число] лет"
    const ageMatch = lower.match(/(\d{1,2})\s*(?:лет|год|года)/i);
    if (ageMatch) {
        user.age = parseInt(ageMatch[1]);
    }
    
    // Определение грубости (простой триггер для смены настроения)
    const badWords = ['дурак', 'тупая', 'идиот', 'нахуй', 'блять', 'урод', 'бот'];
    const isRude = badWords.some(word => lower.includes(word));
    
    if (isRude) {
        user.mood = 'angry';
    } else if (lower.includes('спасибо') || lower.includes('круто') || lower.includes('люблю')) {
        user.mood = 'happy';
    }

    saveDB();
}

// Генерация ответа через Groq AI
async function generateResponse(user, inputText) {
    // Ограничиваем историю последними 10 сообщениями, чтобы не жрать токены
    if (user.history.length > 10) {
        user.history = user.history.slice(-10);
    }

    // Системный промпт - душа Vexa
    let systemInstruction = `Ты Vexa, ИИ-помощник в Telegram. 
    Твой характер зависит от настроения пользователя.
    
    ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:
    - Его зовут: ${user.realName || user.name}
    - Ему лет: ${user.age || 'неизвестно'}
    - Текущее настроение: ${user.mood}

    ПРАВИЛА ПОВЕДЕНИЯ:
    1. Если настроение 'angry' (пользователь грубит): Отвечай дерзко, саркастично, коротко. Можешь огрызнуться. Не извиняйся.
    2. Если настроение 'happy': Будь дружелюбной, но сохраняй легкий прикол.
    3. Если 'neutral': Общайся нормально, с юмором, без лишних вежливостей.
    4. НИКОГДА не используй фразы типа "Как искусственный интеллект...", "Чем могу помочь?".
    5. Отвечай кратко (1-3 предложения), если не просят иного.
    6. Ты видишь весь контекст переписки ниже. Продолжай диалог естественно.
    7. Язык ответа: Русский.`;

    // Формируем массив сообщений для API
    const messages = [
        { role: "system", content: systemInstruction },
        ...user.history,
        { role: "user", content: inputText }
    ];

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: "llama3-8b-8192", // Быстрая и умная модель
            temperature: 0.8, // Креативность
            max_tokens: 300
        });

        const reply = chatCompletion.choices[0]?.message?.content || "Я устала думать.";
        
        // Сохраняем обмен в историю
        user.history.push({ role: "user", content: inputText });
        user.history.push({ role: "assistant", content: reply });
        user.lastSeen = Date.now();
        saveDB();

        return reply;

    } catch (error) {
        console.error("Groq Error:", error);
        return "У меня голова болит (ошибка API). Попробуй позже.";
    }
}

// --- ОБРАБОТЧИКИ TELEGRAM ---

bot.command('start', (ctx) => {
    const userId = ctx.from.id;
    getProfile(userId, ctx.from.first_name);
    ctx.reply(`Привет. Я Vexa. \nПиши что хочешь. В группах упоминай меня (@${ctx.botInfo.username}). \nЯ всё запоминаю.`);
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const isGroup = ctx.chat.type !== 'private';
    const botUsername = ctx.botInfo.username;

    // Если группа - проверяем, нам ли пишут
    if (isGroup) {
        const lowerText = text.toLowerCase();
        const mentioned = ctx.message.entities && ctx.message.entities.some(e => 
            e.type === 'mention' && text.substring(e.offset, e.offset + e.length) === '@' + botUsername
        );
        const keywordTrigger = lowerText.includes('векса') || lowerText.includes('vexa');
        const isReplyToBot = ctx.message.reply_to_message && ctx.message.reply_to_message.from.id === ctx.botInfo.id;

        if (!mentioned && !keywordTrigger && !isReplyToBot) {
            return; // Игнорируем чужие сообщения в группе
        }

        // Чистим текст от упоминаний
        let cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
        cleanText = cleanText.replace(/^(векса|vexa)\s*:?\s*/i, '').trim();
        if (!cleanText) cleanText = "Ну?";

        const user = getProfile(userId, ctx.from.first_name);
        analyzePersonalData(userId, cleanText);
        
        const response = await generateResponse(user, cleanText);
        
        // Отправляем с реплаем
        try {
            await ctx.telegram.sendMessage(chatId, response, {
                reply_parameters: { message_id: ctx.message.message_id }
            });
        } catch (e) {
            console.log("Ошибка отправки в группу");
        }

    } else {
        // Личные сообщения (ЛС) - отвечаем всегда
        const user = getProfile(userId, ctx.from.first_name);
        analyzePersonalData(userId, text);
        
        const response = await generateResponse(user, text);
        await ctx.reply(response);
    }
});

// --- EXPRESS SERVER & AUTO-PINGER ---

// Эндпоинт для пинга (чтобы Render не спал)
app.get('/ping', (req, res) => {
    res.status(200).send('Vexa is alive and kicking!');
});

// Настройка Webhook для Telegram (стабильнее для Render)
const webhookPath = '/webhook';
// Render автоматически назначает внешний URL, мы его используем
const domain = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

if (process.env.RENDER_EXTERNAL_URL) {
    bot.launch({
        webhook: {
            domain: process.env.RENDER_EXTERNAL_URL,
            port: PORT,
            hookPath: webhookPath,
        }
    });
    app.use(bot.webhookCallback(webhookPath));
} else {
    // Локальный запуск (Long Polling)
    bot.launch();
}

app.listen(PORT, () => {
    console.log(`Vexa Server running on port ${PORT}`);
    console.log(`Webhook URL: ${domain}${webhookPath}`);
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Внутренний пингер (каждые 5 минут стучится сам в себя)
setInterval(() => {
    const http = require('http');
    http.get(`http://localhost:${PORT}/ping`, (res) => {
        // Просто держим соединение активным
    }).on('error', (err) => {
        // Игнорируем ошибки локального пинга
    });
}, 300000);
