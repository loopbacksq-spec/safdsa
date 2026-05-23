const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

// --- НАСТРОЙКИ ---
const TOKEN = '8117150241:AAHbY2YbuttsWB1tDaBDtKnSkV0WXPKL9Nw';
const API_KEY_GROQ = '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';
const MODEL = 'llama-3.1-8b-instant';
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.use(bodyParser.json());

console.log("🚀 ЗАПУСК UNIVERSAL BOT v3 (FIXED MEMORY)...");

// --- КОНФИГУРАЦИЯ ПЕРСОНАЖА ---
let CHARACTER_CONFIG = {
    name: "Бот",
    description: "Ты полезный помощник.",
    style: "Отвечай вежливо и кратко.",
    mood: "neutral"
};

// --- ПАМЯТЬ (ИЗОЛИРОВАННАЯ ПО CHAT_ID) ---
// Структура: { chatId: [ {role: 'user', content: '...'}, ... ] }
const chatMemory = {}; 
const MAX_HISTORY_LENGTH = 6; // Храним последние 6 сообщений (3 пары вопрос-ответ)

function addToMemory(chatId, role, text) {
    if (!chatMemory[chatId]) chatMemory[chatId] = [];
    
    // Добавляем сообщение
    chatMemory[chatId].push({ role, content: text });
    
    // Удаляем старое, если превышен лимит
    if (chatMemory[chatId].length > MAX_HISTORY_LENGTH * 2) {
        chatMemory[chatId].shift();
    }
}

function clearAllMemory() {
    for (let key in chatMemory) {
        delete chatMemory[key];
    }
    console.log("🗑️ ВСЯ ПАМЯТЬ ОЧИЩЕНА!");
}

function getHistoryString(chatId) {
    if (!chatMemory[chatId] || chatMemory[chatId].length === 0) return "";
    // Возвращаем историю без имен, просто диалог
    return chatMemory[chatId].map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`).join('\n');
}

// --- БАЗА ДАННЫХ (ЛОГИ) ---
const db = new sqlite3.Database('./bot_logs.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, user TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

// --- ГЕНЕРАЦИЯ ПРОМПТА ---
function buildPrompt(history, userMessage) {
    const { name, description, style, mood } = CHARACTER_CONFIG;
    
    let moodExtra = "";
    if (mood === 'kind') moodExtra = "Настроение: СУПЕР ДОБРОЕ. Будь милым.";
    if (mood === 'angry') moodExtra = "Настроение: АГРЕССИВНОЕ. Будь злым и резким.";

    return `
    ТВОЯ РОЛЬ: ${name}
    ОПИСАНИЕ: ${description}
    СТИЛЬ: ${style}
    ${moodExtra}

    ЖЕСТКИЕ ПРАВИЛА:
    1. НИКОГДА не называй пользователя по имени или никнейму, если он сам об этом не попросил. Обращайся нейтрально или никак.
    2. НЕ путай контекст разных людей. Отвечай ТОЛЬКО на последнее сообщение и историю ЭТОГО чата.
    3. Не признавай, что ты ИИ.
    4. Отвечай кратко и по делу.

    ИСТОРИЯ ДИАЛОГА (ТОЛЬКО ЭТОГО ЧАТА):
    ${history}

    ТЕКУЩЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: "${userMessage}"

    Твой ответ (${name}):
    `;
}

// --- ОБРАБОТКА СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    if (!msg.text) return;
    
    const chatId = msg.chat.id;
    const text = msg.text.toLowerCase();
    const charNameLower = CHARACTER_CONFIG.name.toLowerCase();

    // Логируем активность
    db.run(`INSERT INTO logs (chat_id, user) VALUES (?, ?)`, [chatId, msg.from.first_name]);

    // Триггеры: Имя, Ответ на бота, Личка
    const isCalled = text.includes(charNameLower);
    const isReply = msg.reply_to_message && msg.reply_to_message.from.username === (await bot.getMe()).username;
    const isPrivate = msg.chat.type === 'private';

    if (isCalled || isReply || isPrivate) {
        bot.sendChatAction(chatId, 'typing');
        
        // Сохраняем вопрос в память ЭТОГО чата
        addToMemory(chatId, 'user', msg.text);

        setTimeout(async () => {
            const history = getHistoryString(chatId);
            const prompt = buildPrompt(history, msg.text);

            try {
                const res = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model: MODEL,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.8,
                        max_tokens: 100
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${API_KEY_GROQ}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                const answer = res.data.choices[0].message.content.trim();
                
                // Сохраняем ответ бота в память ЭТОГО чата
                addToMemory(chatId, 'assistant', answer);
                
                await bot.sendMessage(chatId, answer, { reply_to_message_id: msg.message_id });

            } catch (e) {
                console.error(e);
                await bot.sendMessage(chatId, "ошибка связи...", { reply_to_message_id: msg.message_id });
            }
        }, Math.random() * 1500 + 500); // Быстрый ответ 0.5-2 сек
    }
});

// --- АДМИН ПАНЕЛЬ ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <title>BOT CONSTRUCTOR</title>
        <style>
            body { background: #121212; color: #e0e0e0; font-family: monospace; padding: 20px; }
            .container { max-width: 700px; margin: 0 auto; background: #1e1e1e; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
            h2 { color: #fff; border-bottom: 1px solid #333; padding-bottom: 10px; margin-top: 0; }
            label { display: block; margin-top: 15px; color: #aaa; font-size: 0.9em; }
            input, textarea, select { width: 100%; background: #2c2c2c; border: 1px solid #444; color: #fff; padding: 12px; margin-top: 5px; border-radius: 6px; box-sizing: border-box; font-family: inherit; }
            textarea { resize: vertical; }
            button { margin-top: 20px; padding: 12px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; width: 100%; }
            .btn-save { background: #0088cc; color: white; }
            .btn-save:hover { background: #0077b5; }
            .btn-clear { background: #cf3030; color: white; margin-top: 10px; }
            .btn-clear:hover { background: #b02020; }
            .status { margin-top: 20px; padding: 10px; background: #252525; border-radius: 6px; font-size: 0.85em; color: #888; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🎭 Конструктор Персонажа</h2>
            
            <label>Имя:</label>
            <input type="text" id="name" value="${CHARACTER_CONFIG.name}">
            
            <label>Описание (Кто он?):</label>
            <textarea id="desc" rows="3">${CHARACTER_CONFIG.description}</textarea>
            
            <label>Стиль (Как пишет?):</label>
            <textarea id="style" rows="3">${CHARACTER_CONFIG.style}</textarea>
            
            <label>Настроение:</label>
            <select id="mood">
                <option value="neutral" ${CHARACTER_CONFIG.mood === 'neutral' ? 'selected' : ''}>Нейтральное</option>
                <option value="kind" ${CHARACTER_CONFIG.mood === 'kind' ? 'selected' : ''}>Доброе</option>
                <option value="angry" ${CHARACTER_CONFIG.mood === 'angry' ? 'selected' : ''}>Злое</option>
            </select>
            
            <button class="btn-save" onclick="saveConfig()">💾 СОХРАНИТЬ ПЕРСОНАЖА</button>
            <button class="btn-clear" onclick="clearMemory()">🗑️ СБРОСИТЬ ВСЮ ПАМЯТЬ</button>
            
            <div class="status">
                Сервер: <span style="color:#0f0">ONLINE</span> | Активных чатов: ${Object.keys(chatMemory).length}
            </div>
        </div>

        <script>
            async function saveConfig() {
                const config = {
                    name: document.getElementById('name').value,
                    description: document.getElementById('desc').value,
                    style: document.getElementById('style').value,
                    mood: document.getElementById('mood').value
                };
                await fetch('/api/update-char', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(config)
                });
                alert('Персонаж обновлен!');
            }

            async function clearMemory() {
                if(confirm('Точно сбросить память? Он забудет все диалоги.')) {
                    await fetch('/api/clear-memory', { method: 'POST' });
                    alert('Память очищена!');
                    location.reload();
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.post('/api/update-char', (req, res) => {
    CHARACTER_CONFIG = req.body;
    console.log("🎭 Персонаж обновлен:", CHARACTER_CONFIG.name);
    res.json({ status: 'ok' });
});

app.post('/api/clear-memory', (req, res) => {
    clearAllMemory();
    res.json({ status: 'cleared' });
});

// --- АНТИ-СОН ---
app.get('/health', (req, res) => res.json({ status: 'alive' }));
setInterval(() => axios.get(`http://localhost:${PORT}/health`).catch(() => {}), 300000);

app.listen(PORT, () => console.log(`🌐 Server on port ${PORT}`));
