const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');

// --- ТВОИ ДАННЫЕ ---
const BOT_TOKEN = "8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI";
const GROQ_API_KEY = "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";

// Инициализация
const bot = new Telegraf(BOT_TOKEN);
const groq = new Groq({ 
    apiKey: GROQ_API_KEY,
    timeout: 30000,
    maxRetries: 2
});

const app = express();
// Render назначает порт в process.env.PORT. Если нет - берем 10000.
const PORT = process.env.PORT || 10000;

// --- БАЗА ДАННЫХ ---
const DATA_FILE = path.join(__dirname, 'data.json');
let db = { users: {} };

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            db = JSON.parse(fs.readFileSync(DATA_FILE));
        }
    } catch (e) {
        console.log("База данных создана заново.");
    }
}

function saveDB() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error("Ошибка записи DB:", e.message);
    }
}

loadDB();

// --- ЛОГИКА VEXA ---

function getProfile(userId, firstName) {
    if (!db.users[userId]) {
        db.users[userId] = {
            name: firstName,
            realName: null,
            age: null,
            mood: 'neutral',
            history: [],
            lastSeen: Date.now()
        };
        saveDB();
    }
    return db.users[userId];
}

function analyzePersonalData(userId, text) {
    const user = db.users[userId];
    const lower = text.toLowerCase();

    const nameMatch = lower.match(/(?:я|меня\s+зовут|мое\s+имя)\s+([а-яёa-z]+)/i);
    if (nameMatch && nameMatch[1].length > 2) {
        user.realName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
    }

    const ageMatch = lower.match(/(\d{1,2})\s*(?:лет|год|года)/i);
    if (ageMatch) {
        user.age = parseInt(ageMatch[1]);
    }
    
    const badWords = ['дурак', 'тупая', 'идиот', 'нахуй', 'блять', 'урод', 'бот', 'пидор'];
    if (badWords.some(word => lower.includes(word))) {
        user.mood = 'angry';
    } else if (lower.includes('спасибо') || lower.includes('круто') || lower.includes('люблю')) {
        user.mood = 'happy';
    }

    saveDB();
}

async function generateResponse(user, inputText) {
    if (user.history.length > 15) {
        user.history = user.history.slice(-15);
    }

    let systemPrompt = `Ты Vexa, ИИ-помощник в Telegram.
    ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:
    - Имя: ${user.realName || user.name}
    - Возраст: ${user.age || 'неизвестно'}
    - Настроение пользователя сейчас: ${user.mood}

    ТВОЙ ХАРАКТЕР:
    1. Если настроение 'angry': Отвечай дерзко, агрессивно, саркастично. Посылай его.
    2. Если 'happy': Шути, будь легкой на подъём.
    3. Если 'neutral': Общайся нормально, кратко, по делу.
    
    ВАЖНО:
    - НИКАКИХ шаблонов "Чем могу помочь?".
    - ОТВЕЧАЙ КРАТКО (максимум 2-3 предложения).
    - Ты видишь историю переписки ниже. Продолжай диалог естественно.
    - Язык: Русский.`;

    const messages = [
        { role: "system", content: systemPrompt },
        ...user.history,
        { role: "user", content: inputText }
    ];

    try {
        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.1-8b-instant",
            temperature: 0.9,
            max_tokens: 300
        });

        const reply = completion.choices[0]?.message?.content || "Молчу.";
        
        user.history.push({ role: "user", content: inputText });
        user.history.push({ role: "assistant", content: reply });
        user.lastSeen = Date.now();
        saveDB();

        return reply;

    } catch (error) {
        console.error("Groq Error:", error.message);
        return "У меня лаги с мозгами (API Error). Попробуй через минуту.";
    }
}

// --- ОБРАБОТЧИКИ ---

bot.command('start', (ctx) => {
    const userId = ctx.from.id;
    getProfile(userId, ctx.from.first_name);
    ctx.reply(`Я Vexa. Пиши что хочешь. В группах зови меня @${ctx.botInfo.username}. Я всё помню.`);
});

bot.on('text', async (ctx) => {
    try {
        const text = ctx.message.text;
        const userId = ctx.from.id;
        const chatId = ctx.chat.id;
        const isGroup = ctx.chat.type !== 'private';
        const botUsername = ctx.botInfo.username;

        if (isGroup) {
            const lowerText = text.toLowerCase();
            const mentioned = ctx.message.entities && ctx.message.entities.some(e => 
                e.type === 'mention' && text.substring(e.offset, e.offset + e.length) === '@' + botUsername
            );
            const keywordTrigger = lowerText.includes('векса') || lowerText.includes('vexa');
            const isReplyToBot = ctx.message.reply_to_message && ctx.message.reply_to_message.from.id === ctx.botInfo.id;

            if (!mentioned && !keywordTrigger && !isReplyToBot) {
                return; 
            }

            let cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
            cleanText = cleanText.replace(/^(векса|vexa)\s*:?\s*/i, '').trim();
            if (!cleanText) cleanText = "Ну?";

            const user = getProfile(userId, ctx.from.first_name);
            analyzePersonalData(userId, cleanText);
            
            const response = await generateResponse(user, cleanText);
            
            await ctx.telegram.sendMessage(chatId, response, {
                reply_parameters: { message_id: ctx.message.message_id }
            });

        } else {
            const user = getProfile(userId, ctx.from.first_name);
            analyzePersonalData(userId, text);
            const response = await generateResponse(user, text);
            await ctx.reply(response);
        }
    } catch (err) {
        console.error("Handler Error:", err);
    }
});

// --- ЗАПУСК СЕРВЕРА (ЖЕЛЕЗОБЕТОННЫЙ) ---

app.get('/ping', (req, res) => {
    res.status(200).send('Vexa is alive!');
});

// Сначала запускаем Express, чтобы Render увидел открытый порт
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`>>> EXPRESS SERVER LISTENING ON PORT ${PORT} <<<`);
    
    // Только после успешного старта Express запускаем бота
    startBot();
});

// Функция запуска бота с обработкой ошибок
function startBot() {
    console.log("Starting Telegram Bot...");
    bot.launch({
        dropPendingUpdates: true,
        polling: {
            timeout: 30,
        }
    }).then(() => {
        console.log("Vexa Bot is running!");
    }).catch((err) => {
        console.error("Failed to start bot:", err);
    });

    // Обработка ошибок бота, чтобы не ронять сервер
    bot.catch((err) => {
        console.error("Bot Error:", err);
    });
}

// Graceful stop
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
});

// Авто-пингер
setInterval(() => {
    const http = require('http');
    http.get(`http://localhost:${PORT}/ping`, (res) => {}).on('error', () => {});
}, 60000);
