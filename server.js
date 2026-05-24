const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');

// --- ТВОИ ДАННЫЕ ---
const BOT_TOKEN = "8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI";
const GROQ_API_KEY = "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";

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Express для авто-пинга (чтобы Render не спал)
const app = express();
const PORT = process.env.PORT || 3000;

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
            mood: 'neutral', // neutral, angry, happy
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

    // Имя
    const nameMatch = lower.match(/(?:я|меня\s+зовут|мое\s+имя)\s+([а-яёa-z]+)/i);
    if (nameMatch && nameMatch[1].length > 2) {
        user.realName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
    }

    // Возраст
    const ageMatch = lower.match(/(\d{1,2})\s*(?:лет|год|года)/i);
    if (ageMatch) {
        user.age = parseInt(ageMatch[1]);
    }
    
    // Настроение (Грубость)
    const badWords = ['дурак', 'тупая', 'идиот', 'нахуй', 'блять', 'урод', 'бот', 'пидор'];
    if (badWords.some(word => lower.includes(word))) {
        user.mood = 'angry';
    } else if (lower.includes('спасибо') || lower.includes('круто') || lower.includes('люблю')) {
        user.mood = 'happy';
    }

    saveDB();
}

async function generateResponse(user, inputText) {
    // Чистим историю, оставляем последние 12 сообщений
    if (user.history.length > 12) {
        user.history = user.history.slice(-12);
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
            model: "llama3-8b-8192",
            temperature: 0.9,
            max_tokens: 250
        });

        const reply = completion.choices[0]?.message?.content || "Молчу.";
        
        // Сохраняем в историю
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

        // Логика для групп
        if (isGroup) {
            const lowerText = text.toLowerCase();
            // Проверяем упоминание @bot
            const mentioned = ctx.message.entities && ctx.message.entities.some(e => 
                e.type === 'mention' && text.substring(e.offset, e.offset + e.length) === '@' + botUsername
            );
            // Проверяем слова Vexa/Векса
            const keywordTrigger = lowerText.includes('векса') || lowerText.includes('vexa');
            // Проверяем реплай на бота
            const isReplyToBot = ctx.message.reply_to_message && ctx.message.reply_to_message.from.id === ctx.botInfo.id;

            // Если ничего из этого нет - игнорируем
            if (!mentioned && !keywordTrigger && !isReplyToBot) {
                return; 
            }

            // Чистим текст от мусора
            let cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
            cleanText = cleanText.replace(/^(векса|vexa)\s*:?\s*/i, '').trim();
            if (!cleanText) cleanText = "Ну?";

            const user = getProfile(userId, ctx.from.first_name);
            analyzePersonalData(userId, cleanText);
            
            const response = await generateResponse(user, cleanText);
            
            // Отправляем ответ с реплаем
            await ctx.telegram.sendMessage(chatId, response, {
                reply_parameters: { message_id: ctx.message.message_id }
            });

        } else {
            // Личные сообщения
            const user = getProfile(userId, ctx.from.first_name);
            analyzePersonalData(userId, text);
            const response = await generateResponse(user, text);
            await ctx.reply(response);
        }
    } catch (err) {
        console.error("Handler Error:", err);
    }
});

// --- ЗАПУСК СЕРВЕРА И БОТА ---

// 1. Express для пинга (Render не уснет, если есть активность на порту)
app.get('/ping', (req, res) => {
    res.send('Vexa is alive!');
});

app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
});

// 2. Запуск бота в режиме Long Polling (самый надежный для Render Free)
// longPolling позволяет боту работать даже если webhook глючит
bot.launch({
    dropPendingUpdates: false, // Не удалять старые сообщения при перезагрузке
    polling: {
        timeout: 30, // Таймаут запросов
    }
});

console.log("Vexa Bot started successfully!");

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// 3. Авто-пингер внутри процесса (стучится в свой же Express порт)
setInterval(() => {
    const http = require('http');
    http.get(`http://localhost:${PORT}/ping`, (res) => {
        // Молча пингуем
    }).on('error', (err) => {
        // Игнорируем ошибки
    });
}, 60000); // Каждую минуту
