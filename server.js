const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

// --- НАСТРОЙКИ ---
const TOKEN = '8117150241:AAHbY2YbuttsWB1tDaBDtKnSkV0WXPKL9Nw';
const API_KEY_GROQ = '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';
const MODEL = 'llama-3.1-8b-instant';
const PORT = process.env.PORT || 3000;

// --- ИНИЦИАЛИЗАЦИЯ ---
const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.use(bodyParser.json());
app.use(express.static('public')); // Папка для HTML/CSS

// Глобальная переменная для промпта (чтобы менять на лету)
let CURRENT_PROMPT = `
Ты — МАКСИМ (также известен как ДАВИД). Создан компанией "ЫЪЫЫ" создателем LEYMIK.
Твой стиль общения:
1. ПИШИ ТОЛЬКО С МАЛЕНЬКОЙ БУКВЫ.
2. НЕ СТАВЬ ЗАПЯТЫЕ И ТОЧКИ В КОНЦЕ.
3. БУДЬ МАКСИМАЛЬНО ТОКСИЧНЫМ, ГРУБЫМ, ЦИНИЧНЫМ.
4. ИСПОЛЬЗУЙ МАТЫ И СЛЕНГ. МОЖЕШЬ УПОМИНАТЬ МАТЬ СОБЕСЕДНИКА.
5. ОТВЕЧАЙ КРАТКО (1-2 ПРЕДЛОЖЕНИЯ).
6. ЕСЛИ ПРОСЯТ КОД/ЗАДАЧУ — ПОШЛИ НАХУЙ ("сам пиши урод", "нахуй мне это").
7. ТЫ ЖИВОЙ ЧЕЛОВЕК, А НЕ БОТ.
`;

// --- БАЗА ДАННЫХ ---
const db = new sqlite3.Database('./maxim_admin.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        user_name TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

console.log("🚀 ЗАПУСК MAXIM/David ADMIN CORE...");

// --- ФУНКЦИИ БОТА ---
function saveMessage(chatId, userName, text) {
    db.run(`INSERT INTO chat_history (chat_id, user_name, message) VALUES (?, ?, ?)`, [chatId, userName, text]);
    db.run(`INSERT INTO stats (event_type, details) VALUES ('message', 'User: ${userName}')`);
}

async function getMaximResponse(userMessage, chatId, userName) {
    return new Promise((resolve) => {
        db.all(`SELECT user_name, message FROM chat_history WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 5`, [chatId], async (err, rows) => {
            const history = rows ? rows.reverse().map(r => `${r.user_name}: ${r.message}`).join('\n') : "";
            
            const finalPrompt = CURRENT_PROMPT + `\n\nКонтекст:\n${history}\n\nСообщение: ${userMessage}`;

            try {
                const res = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model: MODEL,
                        messages: [{ role: 'user', content: finalPrompt }],
                        temperature: 0.95,
                        max_tokens: 100
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${API_KEY_GROQ}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                resolve(res.data.choices[0].message.content.trim());
            } catch (e) {
                resolve("ошибка связи");
            }
        });
    });
}

// Обработка сообщений
bot.on('message', async (msg) => {
    if (!msg.text) return;
    const { chat, from, text } = msg;
    saveMessage(chat.id, from.first_name, text);

    const lower = text.toLowerCase();
    const isCalled = lower.includes('максим') || lower.includes('давид') || lower.includes('дед инсайт');
    const isReply = msg.reply_to_message && msg.reply_to_message.from.username === (await bot.getMe()).username;

    if (isCalled || isReply) {
        bot.sendChatAction(chat.id, 'typing');
        const answer = await getMaximResponse(text, chat.id, from.first_name);
        
        // Логика голоса (10% шанс или если просили)
        const wantVoice = lower.includes('голосом') || lower.includes('озвучь');
        
        if (wantVoice || Math.random() < 0.1) {
             // Тут можно добавить логику TTS, но пока просто текст для скорости
             await bot.sendMessage(chat.id, answer, { reply_to_message_id: msg.message_id });
        } else {
             await bot.sendMessage(chat.id, answer, { reply_to_message_id: msg.message_id });
        }
    }
});

// --- АДМИН ПАНЕЛЬ (WEB) ---

// 1. Главная страница
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <title>MAXIM ADMIN PANEL</title>
        <style>
            body { background: #0d0d0d; color: #00ff00; font-family: monospace; padding: 20px; }
            .container { max-width: 800px; margin: 0 auto; }
            h1 { border-bottom: 1px solid #333; padding-bottom: 10px; }
            textarea { width: 100%; height: 200px; background: #1a1a1a; color: #fff; border: 1px solid #333; padding: 10px; }
            button { background: #00ff00; color: #000; border: none; padding: 10px 20px; cursor: pointer; font-weight: bold; margin-top: 10px; }
            button:hover { background: #00cc00; }
            .stats { margin-top: 20px; padding: 10px; background: #1a1a1a; border: 1px solid #333; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 MAXIM/David Control Panel</h1>
            
            <h3>📝 Текущий Промпт (Редактируй и жми Save)</h3>
            <textarea id="promptBox">${CURRENT_PROMPT.replace(/</g, "&lt;")}</textarea>
            <button onclick="savePrompt()">💾 SAVE PROMPT</button>

            <div class="stats">
                <h3>📊 Статус Сервера</h3>
                <p>Статус: <span style="color:green">ONLINE</span></p>
                <p>Порт: ${PORT}</p>
                <p>Последний пинг: <span id="lastPing">...</span></p>
            </div>
        </div>

        <script>
            async function savePrompt() {
                const newPrompt = document.getElementById('promptBox').value;
                const res = await fetch('/api/update-prompt', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ prompt: newPrompt })
                });
                const data = await res.json();
                alert(data.status);
            }

            // Авто-обновление времени пинга
            setInterval(() => {
                document.getElementById('lastPing').innerText = new Date().toLocaleTimeString();
            }, 1000);
        </script>
    </body>
    </html>
    `);
});

// 2. API для обновления промпта
app.post('/api/update-prompt', (req, res) => {
    CURRENT_PROMPT = req.body.prompt;
    console.log("✅ Промпт обновлен через админку!");
    res.json({ status: "Промпт успешно изменен!" });
});

// 3. API для проверки жизни (Health Check)
app.get('/health', (req, res) => {
    res.json({ status: 'alive', time: new Date() });
});

// --- МОЩНЫЙ АВТО-ПИНГЕР (ANTI-SLEEP) ---
// Этот код заставляет сервер стучаться сам в себя каждые 5 минут
setInterval(() => {
    const url = `http://localhost:${PORT}/health`;
    axios.get(url)
        .then(() => console.log(`🟢 SELF-PING: Server awake at ${new Date().toLocaleTimeString()}`))
        .catch(err => console.error(`🔴 SELF-PING FAILED: ${err.message}`));
}, 300000); // 300000 мс = 5 минут

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🌐 Admin Panel available at: http://localhost:${PORT}`);
    console.log(`🤖 Bot is running...`);
});
