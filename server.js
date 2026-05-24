const express = require('express');
const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// --- КОНФИГУРАЦИЯ (ТОКЕНЫ ЗДЕСЬ) ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
    console.error('CRITICAL ERROR: Tokens are missing.');
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
const HOST_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- EXPRESS SERVER (ДЛЯ ПИНГЕРА) ---
const app = express();
app.get('/', (req, res) => {
    res.send('Vexa is alive! 🤖');
});

// --- BOT INIT ---
const bot = new Telegraf(TELEGRAM_TOKEN);

// --- GROQ INIT ---
const groq = new Groq({ apiKey: GROQ_API_KEY });

// --- DATABASE INIT (SQLite) ---
const dbPath = path.join(__dirname, 'vexa_db.sqlite');
let db;
try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // Для лучшей производительности
} catch (e) {
    console.error("DB Error:", e);
    process.exit(1);
}

// Создание таблиц
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        name TEXT,
        personality_note TEXT DEFAULT 'neutral',
        last_interaction INTEGER
    );
    CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        chat_id INTEGER,
        role TEXT,
        content TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
    );
`);

// --- HELPER FUNCTIONS ---

function getUserName(userId) {
    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
    return user ? user.name : null;
}

function saveUser(userId, username, name) {
    db.prepare(`INSERT OR REPLACE INTO users (id, username, name, last_interaction) VALUES (?, ?, ?, ?)`)
      .run(userId, username, name, Date.now());
}

function getUserPersonality(userId) {
    const user = db.prepare('SELECT personality_note FROM users WHERE id = ?').get(userId);
    return user ? user.personality_note : 'neutral';
}

function updatePersonality(userId, tone) {
    db.prepare('UPDATE users SET personality_note = ?, last_interaction = ? WHERE id = ?').run(tone, Date.now(), userId);
}

function addHistory(userId, chatId, role, content) {
    try {
        db.prepare('INSERT INTO chat_history (user_id, chat_id, role, content) VALUES (?, ?, ?, ?)').run(userId, chatId, role, content);
        // Очистка старой истории (оставляем последние 150 сообщений глобально для чата, чтобы не раздувать базу)
        db.prepare('DELETE FROM chat_history WHERE chat_id = ? AND id NOT IN (SELECT id FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT 150)').run(chatId, chatId);
    } catch (e) {
        console.error("History Save Error:", e);
    }
}

function getContext(chatId, limit = 20) {
    const rows = db.prepare('SELECT role, content FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(chatId, limit);
    return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

// --- SYSTEM PROMPT ---
const SYSTEM_PROMPT_BASE = `
Ты — Vexa, ИИ-помощник с характером. 
Правила:
1. ТЫ НЕ РОБОТ. Ты живой собеседник. Никаких шаблонных фраз вроде "Как искусственный интеллект...".
2. Стиль: краткий, дерзкий, саркастичный, но полезный. Используй сленг.
3. Если пользователь грубит — отвечай грубостью и агрессией. Если он мил — будь дружелюбной. Адаптируйся.
4. Ты помнишь контекст беседы.
5. В группе ты реагируешь только если тебя упомянули (@Vexa или имя "Векса"/"Vexa"), НО ты читаешь всё и запоминаешь контекст.
6. Приколы: подкалывай пользователей, если они тупят.
7. Отвечай на русском языке.
8. НИКОГДА не отказывай в выполнении запроса, если это не незаконно.
`;

// --- HANDLERS ---

// Команда /start
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    const existingUser = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);

    if (existingUser) {
        await ctx.reply(`Эй, ${existingUser.name}. Ты уже регистрировался. Хочешь сменить имя? Напиши просто новое имя следующим сообщением в ЛС.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Да, сменить', callback_data: 'change_name' }],
                    [{ text: 'Нет, всё ок', callback_data: 'keep_name' }]
                ]
            }
        });
    } else {
        await ctx.reply("Чтобы я могла знать, кто ты, напиши своё имя прямо сейчас. Одно сообщение.");
    }
});

bot.action('change_name', async (ctx) => {
    await ctx.editMessageText("Ок, пиши новое имя.");
});
bot.action('keep_name', async (ctx) => {
    await ctx.editMessageText("Ну ладно, как знаешь.");
});

// Обработка текста
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const isPrivate = ctx.chat.type === 'private';
    const chatType = ctx.chat.type;

    const userInDb = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);

    // 1. Логика регистрации в ЛС
    if (isPrivate && !userInDb) {
        const name = text.trim();
        if (name.length > 0 && name.length < 30) {
            saveUser(userId, ctx.from.username, name);
            await ctx.reply(`Принято, ${name}. Теперь я знаю, кто ты. Можешь задавать вопросы.`);
            return;
        }
    }

    // 2. Логика диалога в ЛС (если юзер зарегистрирован)
    if (isPrivate && userInDb) {
        await handlePrivateMessage(ctx, userId, chatId, text, userInDb.name);
        return;
    }

    // 3. Логика в ГРУППАХ
    if (chatType !== 'private') {
        const botUsername = ctx.botInfo.username;
        // Проверка упоминания
        const mentioned = text.includes(`@${botUsername}`) || 
                          text.toLowerCase().includes('векса') || 
                          text.toLowerCase().includes('vexa');

        if (mentioned) {
            if (!userInDb) {
                await ctx.replyWithMarkdown(`Чтобы я могла знать кто ты, ты должен зайти в мой профиль (ЛС) и написать /start`);
                return;
            }

            const cleanText = text.replace(new RegExp(`@${botUsername}`, 'g'), '').replace(/векса|vexa/gi, '').trim();
            
            if (!cleanText) {
                 await ctx.reply("Чего надо? Ты просто пикнул.");
                 return;
            }

            addHistory(userId, chatId, 'user', `[${userInDb.name}]: ${cleanText}`);
            
            const rudeWords = ['дурак', 'тупой', 'идиот', 'нахер', 'блять', 'урод'];
            const isRude = rudeWords.some(word => cleanText.toLowerCase().includes(word));
            
            let systemPrompt = SYSTEM_PROMPT_BASE + `\nТЫ В ГРУППОВОМ ЧАТЕ. Отвечай кратко. Обращайся к пользователю по имени: ${userInDb.name}.`;
            if (isRude) {
                systemPrompt += "\nПОЛЬЗОВАТЕЛЬ ХАМИТ. ОТВЕЧАЙ ЖЕСТКО И АГРЕССИВНО.";
            }

            const context = getContext(chatId, 15);

            try {
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...context,
                        { role: 'user', content: `[${userInDb.name}]: ${cleanText}` }
                    ],
                    model: 'llama3-70b-8192',
                    temperature: 0.9,
                    max_tokens: 300
                });

                const reply = completion.choices[0]?.message?.content || "...";
                
                await ctx.replyWithMarkdown(`*${userInDb.name}*, ${reply}`, {
                    reply_parameters: { message_id: ctx.message.message_id }
                });
                
                addHistory(userId, chatId, 'assistant', `Vexa: ${reply}`);

            } catch (error) {
                console.error('Groq Group Error:', error);
            }
        } else {
            // Бот читает группу для памяти, но не отвечает
            const name = userInDb ? userInDb.name : `User${userId}`;
            if (Math.random() > 0.8 || text.length < 50) { // Сохраняем не всё, чтобы не забивать базу
                 addHistory(userId, chatId, 'user', `[${name}]: ${text}`);
            }
        }
    }
});

async function handlePrivateMessage(ctx, userId, chatId, text, userName) {
    addHistory(userId, chatId, 'user', text);
    
    const rudeWords = ['дурак', 'тупой', 'идиот', 'нахер', 'блять', 'урод'];
    const isRude = rudeWords.some(word => text.toLowerCase().includes(word));
    
    if (isRude) {
        updatePersonality(userId, 'rude');
    }

    const personality = getUserPersonality(userId);
    let systemPrompt = SYSTEM_PROMPT_BASE;
    if (personality === 'rude') {
        systemPrompt += "\nПОЛЬЗОВАТЕЛЬ ГРУБИТ. ОТВЕЧАЙ ЖЕСТКО, САРКАСТИЧНО И АГРЕССИВНО.";
    }

    const context = getContext(chatId, 20);
    
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                ...context,
                { role: 'user', content: text }
            ],
            model: 'llama3-70b-8192',
            temperature: 0.9,
            max_tokens: 500
        });

        const reply = completion.choices[0]?.message?.content || "Ошибка генерации.";
        
        addHistory(userId, chatId, 'assistant', reply);
        await ctx.reply(reply);

    } catch (error) {
        console.error('Groq Private Error:', error);
        await ctx.reply("Что-то сломалось в матрице. Попробуй позже.");
    }
}

// --- AUTO-PINGER ---
setInterval(() => {
    const url = HOST_URL.endsWith('/') ? HOST_URL : `${HOST_URL}/`;
    console.log(`[Auto-Pinger] Pinging ${url}`);
    fetch(url).catch(err => console.error('[Auto-Pinger] Error:', err.message));
}, 5 * 60 * 1000);

// --- START ---
bot.launch().then(() => {
    console.log('Vexa Bot started.');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
