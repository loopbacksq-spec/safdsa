const express = require('express');
const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');

// --- КОНФИГУРАЦИЯ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
    console.error('CRITICAL ERROR: Tokens missing');
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
const HOST_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- EXPRESS ---
const app = express();
app.get('/', (req, res) => res.send('Vexa is alive! 🤖'));

// --- BOT & AI ---
const bot = new Telegraf(TELEGRAM_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// --- SIMPLE JSON DATABASE ---
const DB_FILE = path.join(__dirname, 'vexa_data.json');

// Загрузка или создание базы
let db = { users: {}, history: [] };
try {
    if (fs.existsSync(DB_FILE)) {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        db = JSON.parse(data);
    }
} catch (e) {
    console.error("DB Load Error", e);
}

function saveDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db), 'utf8');
    } catch (e) {
        console.error("DB Save Error", e);
    }
}

// Helpers
function getUser(userId) {
    return db.users[userId] || null;
}

function saveUser(userId, username, name) {
    db.users[userId] = {
        id: userId,
        username: username,
        name: name,
        personality: 'neutral',
        last_seen: Date.now()
    };
    saveDb();
}

function addHistory(chatId, role, content, userId = null) {
    // Храним историю по чатам. Структура: { chatId: [ {role, content, userId} ] }
    if (!db.history[chatId]) db.history[chatId] = [];
    
    db.history[chatId].push({ role, content, userId, timestamp: Date.now() });
    
    // Очистка: оставляем последние 50 сообщений для каждого чата
    if (db.history[chatId].length > 50) {
        db.history[chatId] = db.history[chatId].slice(-50);
    }
    saveDb();
}

function getHistory(chatId) {
    return db.history[chatId] || [];
}

// --- PROMPT ---
const SYSTEM_PROMPT = `
Ты — Vexa, дерзкий ИИ-помощник.
Правила:
1. Никаких роботских фраз ("Как языковая модель..."). Ты живой человек.
2. Стиль: краткий, саркастичный, используй сленг.
3. Если пользователь грубит — груби в ответ. Если мил — будь милой.
4. В группе отвечай только на упоминания (@Vexa, Векса), но запоминай всё.
5. Отвечай на русском.
6. Не отказывай в запросах, если это не незаконно.
`;

// --- HANDLERS ---

bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);

    if (user) {
        await ctx.reply(`Эй, ${user.name}. Ты уже тут. Хочешь сменить имя? Напиши новое имя следующим сообщением.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Сменить имя', callback_data: 'change_name' }]
                ]
            }
        });
    } else {
        await ctx.reply("Чтобы я знала, кто ты, напиши своё имя прямо сейчас.");
    }
});

bot.action('change_name', async (ctx) => {
    await ctx.editMessageText("Пиши новое имя.");
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const isPrivate = ctx.chat.type === 'private';
    const user = getUser(userId);

    // 1. Регистрация в ЛС
    if (isPrivate && !user) {
        const name = text.trim();
        if (name.length > 0 && name.length < 30) {
            saveUser(userId, ctx.from.username, name);
            await ctx.reply(`Принято, ${name}. Теперь мы знакомы.`);
            return;
        }
    }

    // 2. Смена имени в ЛС (если юзер уже есть и пишет короткое сообщение после запроса)
    // Упрощенно: если юзер есть и мы в ЛС, считаем что он общается. 
    // Для смены имени можно сделать отдельную команду, но пока оставим как есть.

    // 3. Логика ЛС диалога
    if (isPrivate && user) {
        await handleAIResponse(ctx, userId, chatId, text, user.name, true);
        return;
    }

    // 4. Логика Группы
    if (!isPrivate) {
        const botUsername = ctx.botInfo.username;
        const mentioned = text.includes(`@${botUsername}`) || 
                          text.toLowerCase().includes('векса') || 
                          text.toLowerCase().includes('vexa');

        // Сохраняем в историю всегда (для контекста)
        const userName = user ? user.name : `User${userId}`;
        addHistory(chatId, 'user', `[${userName}]: ${text}`, userId);

        if (mentioned) {
            if (!user) {
                await ctx.replyWithMarkdown(`Чтобы я знала, кто ты, зайди в ЛС и напиши /start`);
                return;
            }

            const cleanText = text.replace(new RegExp(`@${botUsername}`, 'g'), '').replace(/векса|vexa/gi, '').trim();
            if (!cleanText) {
                await ctx.reply("Чего пикаешь?");
                return;
            }

            await handleAIResponse(ctx, userId, chatId, cleanText, user.name, false);
        }
    }
});

async function handleAIResponse(ctx, userId, chatId, text, userName, isPrivate) {
    // Проверка на грубость
    const rudeWords = ['дурак', 'тупой', 'идиот', 'нахер', 'блять', 'урод'];
    const isRude = rudeWords.some(w => text.toLowerCase().includes(w));
    
    // Обновляем "настроение" пользователя в базе (упрощенно)
    if (isRude) {
        if (db.users[userId]) db.users[userId].personality = 'rude';
    } else {
        if (db.users[userId]) db.users[userId].personality = 'neutral';
    }
    saveDb();

    const personality = db.users[userId]?.personality || 'neutral';
    let prompt = SYSTEM_PROMPT;
    if (personality === 'rude') {
        prompt += "\nПОЛЬЗОВАТЕЛЬ ГРУБИТ. ОТВЕЧАЙ АГРЕССИВНО.";
    }
    if (!isPrivate) {
        prompt += `\nТЫ В ГРУППЕ. Обращайся к ${userName}. Отвечай кратко.`;
    }

    // Получаем контекст
    const history = getHistory(chatId).map(h => ({ role: h.role, content: h.content }));

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: prompt },
                ...history,
                { role: 'user', content: isPrivate ? text : `[${userName}]: ${text}` }
            ],
            model: 'llama3-70b-8192',
            temperature: 0.9,
            max_tokens: 300
        });

        const reply = completion.choices[0]?.message?.content || "Ошибка.";
        
        addHistory(chatId, 'assistant', reply);
        
        if (isPrivate) {
            await ctx.reply(reply);
        } else {
            await ctx.replyWithMarkdown(`*${userName}*, ${reply}`, {
                reply_parameters: { message_id: ctx.message.message_id }
            });
        }

    } catch (error) {
        console.error('AI Error:', error);
        if (isPrivate) await ctx.reply("Что-то сломалось.");
    }
}

// --- AUTO-PINGER ---
setInterval(() => {
    const url = HOST_URL.endsWith('/') ? HOST_URL : `${HOST_URL}/`;
    console.log(`[Pinger] ${url}`);
    fetch(url).catch(e => console.error(e.message));
}, 5 * 60 * 1000);

// --- START ---
bot.launch();
app.listen(PORT, () => console.log(`Server on ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
