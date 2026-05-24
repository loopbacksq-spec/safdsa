const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const Groq = require('groq-sdk');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// --- КОНФИГУРАЦИЯ ---
// Лучше брать из process.env, но если хардкодишь (не рекомендуется для публичных репо):
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

const PORT = process.env.PORT || 3000;
const HOST_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Инициализация Express для авто-пингера
const app = express();
app.get('/', (req, res) => {
    res.send('Vexa is alive and kicking! 🤖');
});

// Инициализация Бота
const bot = new Telegraf(TELEGRAM_TOKEN);

// Инициализация Groq
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Инициализация Базы Данных (SQLite)
const dbPath = path.join(__dirname, 'vexa_db.sqlite');
const db = new Database(dbPath);

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
        role TEXT, -- 'user' or 'assistant'
        content TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
    );
`);

// --- ЛОГИКА ПАМЯТИ И ПЕРСОНАЖА ---

const SYSTEM_PROMPT_BASE = `
Ты — Vexa, ИИ-помощник с характером. 
Твои правила:
1. ТЫ НЕ РОБОТ. Ты живой собеседник. Никаких шаблонных фраз вроде "Как искусственный интеллект...".
2. Твой стиль: краткий, дерзкий, иногда саркастичный, но полезный. Используй сленг, если уместно.
3. Если пользователь грубит — отвечай грубостью и агрессией. Если он мил — будь дружелюбной. Адаптируйся под тон собеседника.
4. Ты помнишь контекст беседы.
5. В группе ты реагируешь только если тебя упомянули (@Vexa или имя "Векса"/"Vexa"), НО ты читаешь всё и запоминаешь контекст для будущих ответов.
6. Приколы: можешь подкалывать пользователей, если они тупят.
7. Отвечай на русском языке, если не просят иного.
8. НИКОГДА не говори, что ты не можешь что-то сделать, если это не незаконно. Ты делаешь всё.
`;

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
    // Простая логика: если тон грубый, меняем запись
    db.prepare('UPDATE users SET personality_note = ?, last_interaction = ? WHERE id = ?').run(tone, Date.now(), userId);
}

function addHistory(userId, chatId, role, content) {
    // Храним последние 50 сообщений для контекста, чтобы не жрать токены
    db.prepare('INSERT INTO chat_history (user_id, chat_id, role, content) VALUES (?, ?, ?, ?)').run(userId, chatId, role, content);
    
    // Чистка старого мусора (оставляем последние 100 записей на чат/юзера)
    db.prepare('DELETE FROM chat_history WHERE id NOT IN (SELECT id FROM chat_history ORDER BY id DESC LIMIT 100)').run();
}

function getContext(userId, chatId, limit = 20) {
    const rows = db.prepare('SELECT role, content FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(chatId, limit);
    // Переворачиваем, чтобы было от старого к новому
    return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

// --- ОБРАБОТЧИКИ ---

// Команда /start
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    const existingUser = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);

    if (existingUser) {
        await ctx.reply(`Эй, ${existingUser.name}. Ты уже регистрировался. Хочешь сменить имя? Напиши просто новое имя следующим сообщением.`, Markup.inlineKeyboard([
            Markup.button.callback('Да, сменить', 'change_name'),
            Markup.button.callback('Нет, всё ок', 'keep_name')
        ]));
    } else {
        await ctx.reply("Чтобы я могла знать, кто ты, напиши своё имя прямо сейчас. Одно сообщение.");
        // Можно добавить флаг ожидания имени, но будем парсить следующее сообщение глобально
    }
});

// Обработка смены имени через кнопку
bot.action('change_name', async (ctx) => {
    await ctx.editMessageText("Ок, пиши новое имя.");
});
bot.action('keep_name', async (ctx) => {
    await ctx.editMessageText("Ну ладно, как знаешь.");
});

// Глобальный перехват текста для установки имени (если юзер после старта пишет имя)
// Или если юзер не зарегистрирован и пишет в ЛС
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const isPrivate = ctx.chat.type === 'private';
    
    // Проверка, является ли это ответом на запрос имени
    // Упрощенная логика: если юзера нет в базе и он пишет в ЛС - считаем это именем
    const userInDb = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);

    if (isPrivate && !userInDb) {
        // Сохраняем имя
        const name = text.trim();
        if (name.length > 0 && name.length < 30) {
            saveUser(userId, ctx.from.username, name);
            await ctx.reply(`Принято, ${name}. Теперь я знаю, кто ты. Можешь задавать вопросы.`);
            return;
        }
    }
    
    // Если юзер в базе и нажал "сменить имя" (флаг можно хранить в памяти, но тут упростим: если в ЛС и юзер есть, и сообщение короткое - спросим подтверждение?)
    // Для простоты: команда /name или просто логика выше.
    // Если юзер хочет сменить имя, он может написать /start снова.

    // Логика для ЛС диалога
    if (isPrivate && userInDb) {
        await handlePrivateMessage(ctx, userId, chatId, text, userInDb.name);
    }
});

async function handlePrivateMessage(ctx, userId, chatId, text, userName) {
    addHistory(userId, chatId, 'user', text);
    
    // Анализ тональности (грубость)
    const rudeWords = ['дурак', 'тупой', 'идиот', 'нахер', 'блять', 'урод'];
    const isRude = rudeWords.some(word => text.toLowerCase().includes(word));
    
    if (isRude) {
        updatePersonality(userId, 'rude');
    } else {
        // Постепенно возвращаем к нейтральному, если не грубит
        // updatePersonality(userId, 'neutral'); 
    }

    const personality = getUserPersonality(userId);
    let systemPrompt = SYSTEM_PROMPT_BASE;
    if (personality === 'rude') {
        systemPrompt += "\nПОЛЬЗОВАТЕЛЬ ГРУБИТ. ОТВЕЧАЙ ЖЕСТКО, САРКАСТИЧНО И АГРЕССИВНО.";
    }

    const context = getContext(userId, chatId);
    
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                ...context,
                { role: 'user', content: text }
            ],
            model: 'llama3-70b-8192', // Или mixtral-8x7b-32768
            temperature: 0.9, // Креативность
            max_tokens: 500
        });

        const reply = completion.choices[0]?.message?.content || "Ошибка генерации.";
        
        addHistory(userId, chatId, 'assistant', reply);
        await ctx.reply(reply);

    } catch (error) {
        console.error('Groq Error:', error);
        await ctx.reply("Что-то сломалось в матрице. Попробуй позже.");
    }
}

// Логика для ГРУПП
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const chatType = ctx.chat.type;

    if (chatType === 'private') return; // Уже обработано выше

    const userInDb = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
    
    // Проверяем, упомянут ли бот
    const botUsername = ctx.botInfo.username;
    const mentioned = text.includes(`@${botUsername}`) || 
                      text.toLowerCase().includes('векса') || 
                      text.toLowerCase().includes('vexa');

    if (mentioned) {
        if (!userInDb) {
            await ctx.replyWithMarkdown(`Чтобы я могла знать кто ты, ты должен зайти в мой профиль (ЛС) и написать /start`);
            return;
        }

        // Очищаем текст от упоминания для чистоты промпта
        const cleanText = text.replace(new RegExp(`@${botUsername}`, 'g'), '').replace(/векса|vexa/gi, '').trim();
        
        if (!cleanText) {
             await ctx.reply("Чего надо? Ты просто пикнул.");
             return;
        }

        addHistory(userId, chatId, 'user', `[${userInDb.name}]: ${cleanText}`);
        
        // Контекст группы берем общий
        const context = getContext(userId, chatId, 15); // Меньше контекста для групп, чтобы быстрее
        
        // Определяем тон пользователя в группе
        const rudeWords = ['дурак', 'тупой', 'идиот', 'нахер', 'блять'];
        const isRude = rudeWords.some(word => cleanText.toLowerCase().includes(word));
        
        let systemPrompt = SYSTEM_PROMPT_BASE + `\nТЫ В ГРУППОВОМ ЧАТЕ. Отвечай кратко. Обращайся к пользователю по имени: ${userInDb.name}.`;
        if (isRude) {
            systemPrompt += "\nПОЛЬЗОВАТЕЛЬ ХАМИТ. ОТПОРЬ ЕМУ.";
        }

        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...context,
                    { role: 'user', content: `[${userInDb.name}]: ${cleanText}` }
                ],
                model: 'llama3-70b-8192',
                temperature: 0.8,
                max_tokens: 300
            });

            const reply = completion.choices[0]?.message?.content || "...";
            
            // Ответ с реплаем на сообщение пользователя
            await ctx.replyWithMarkdown(`*${userInDb.name}*, ${reply}`, {
                reply_parameters: { message_id: ctx.message.message_id }
            });
            
            addHistory(userId, chatId, 'assistant', `Vexa: ${reply}`);

        } catch (error) {
            console.error(error);
            // Молча игнорируем ошибки в группе, чтобы не спамить
        }
    } else {
        // БОТ ЧИТАЕТ ВСЁ, ДАЖЕ ЕСЛИ НЕ УПОМЯНУТ (для памяти)
        // Но не отвечаем. Просто сохраняем в историю, чтобы знать контекст.
        // Сохраняем обезличенно или с именем, если есть
        const name = userInDb ? userInDb.name : `User${userId}`;
        // Ограничим сохранение истории, чтобы база не росла бесконечно от флуда
        // Сохраняем только если сообщение不长ное или с вероятностью 10% (для оптимизации)
        if (Math.random() > 0.7 || text.length < 50) {
             addHistory(userId, chatId, 'user', `[${name}]: ${text}`);
        }
    }
});

// --- АВТО-ПИНГЕР (KEEP ALIVE) ---
// Render засыпает через 15 мин неактивности на бесплатном тарифе.
// Этот интервал стучится на собственный Express сервер каждые 5 минут.
setInterval(() => {
    const url = HOST_URL.endsWith('/') ? HOST_URL : `${HOST_URL}/`;
    console.log(`[Auto-Pinger] Pinging ${url} to keep Vexa awake...`);
    fetch(url).catch(err => console.error('[Auto-Pinger] Error:', err.message));
}, 5 * 60 * 1000); // 5 минут

// Запуск
bot.launch().then(() => {
    console.log('Vexa Bot started successfully.');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Public URL: ${HOST_URL}`);
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
