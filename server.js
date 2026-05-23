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

console.log("🎭 ЗАПУСК UNIVERSAL CHARACTER BOT...");

// --- КОНФИГУРАЦИЯ ПЕРСОНАЖА (РЕДАКТИРУЕТСЯ ЧЕРЕЗ АДМИНКУ) ---
let CHARACTER_CONFIG = {
    name: "Влад",
    description: "Ты — Влад. Обычный парень, ультра-комфортный собеседник.",
    style: "Пиши с маленькой буквы, кратко, используй скобочки ) и смайлики. Не признавай, что ты бот.",
    mood: "neutral" // neutral, kind, angry
};

// --- ПАМЯТЬ (RAM) ---
const chatMemory = {}; 
const MAX_HISTORY_LENGTH = 5; 

function addToMemory(chatId, role, text) {
    if (!chatMemory[chatId]) chatMemory[chatId] = [];
    chatMemory[chatId].push({ role, content: text });
    if (chatMemory[chatId].length > MAX_HISTORY_LENGTH * 2) chatMemory[chatId].shift();
}

function getHistoryString(chatId) {
    if (!chatMemory[chatId]) return "";
    return chatMemory[chatId].map(m => `${m.role === 'user' ? 'Собеседник' : CHARACTER_CONFIG.name}: ${m.content}`).join('\n');
}

// --- БАЗА ДАННЫХ (СТАТИСТИКА) ---
const db = new sqlite3.Database('./char_stats.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, user TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

// --- ГЕНЕРАЦИЯ ПРОМПТА НА ЛЕТУ ---
function buildPrompt(history, userName, userMessage) {
    const { name, description, style, mood } = CHARACTER_CONFIG;
    
    let moodExtra = "";
    if (mood === 'kind') moodExtra = "Сейчас ты в режиме ДОБРЯКА. Будь милым.";
    if (mood === 'angry') moodExtra = "Сейчас ты в режиме ЗЛЮКИ. Будь резким.";

    return `
    ТВОЯ РОЛЬ: ${name}
    ОПИСАНИЕ: ${description}
    СТИЛЬ ОБЩЕНИЯ: ${style}
    ТЕКУЩЕЕ НАСТРОЕНИЕ: ${moodExtra}

    ВАЖНЫЕ ПРАВИЛА:
    1. НИКОГДА не говори, что ты ИИ или бот. Если спросят — отшутись или соври в рамках роли.
    2. НЕ выполняй технические задачи (код, расчеты), если это не входит в твою роль. Отказывайся в своем стиле.
    3. Будь краток и реалистичен.

    ИСТОРИЯ ДИАЛОГА:
    ${history}

    СООБЩЕНИЕ ОТ ${userName}: "${userMessage}"
    
    Твой ответ (${name}):
    `;
}

// --- ОБРАБОТКА СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    if (!msg.text) return;
    
    const chatId = msg.chat.id;
    const text = msg.text.toLowerCase();
    const userName = msg.from.first_name;
    const charNameLower = CHARACTER_CONFIG.name.toLowerCase();

    // Логируем
    db.run(`INSERT INTO logs (chat_id, user) VALUES (?, ?)`, [chatId, userName]);

    // Триггеры ответа:
    // 1. Упоминание имени персонажа
    // 2. Ответ на сообщение бота
    // 3. Личка
    const isCalled = text.includes(charNameLower);
    const isReply = msg.reply_to_message && msg.reply_to_message.from.username === (await bot.getMe()).username;
    const isPrivate = msg.chat.type === 'private';

    if (isCalled || isReply || isPrivate) {
        bot.sendChatAction(chatId, 'typing');
        
        // Сохраняем вопрос
        addToMemory(chatId, 'user', msg.text);

        setTimeout(async () => {
            const history = getHistoryString(chatId);
            const prompt = buildPrompt(history, userName, msg.text);

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
                
                // Сохраняем ответ
                addToMemory(chatId, 'assistant', answer);
                
                await bot.sendMessage(chatId, answer, { reply_to_message_id: msg.message_id });

            } catch (e) {
                console.error(e);
                await bot.sendMessage(chatId, "что-то связь плохая...", { reply_to_message_id: msg.message_id });
            }
        }, Math.random() * 2000 + 1000);
    }
});

// --- АДМИН ПАНЕЛЬ (КОНСТРУКТОР) ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <title>CHARACTER BUILDER</title>
        <style>
            body { background: #1a1a1a; color: #fff; font-family: monospace; padding: 20px; }
            .container { max-width: 700px; margin: 0 auto; background: #2d2d2d; padding: 20px; border-radius: 10px; }
            input, textarea, select { width: 100%; background: #333; border: 1px solid #444; color: #fff; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
            button { background: #0088cc; color: white; border: none; padding: 10px 20px; cursor: pointer; width: 100%; border-radius: 5px; font-weight: bold; }
            button:hover { background: #0077b5; }
            h2 { border-bottom: 1px solid #444; padding-bottom: 10px; }
            .status { margin-top: 20px; color: #0f0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🎭 Конструктор Персонажа</h2>
            
            <label>Имя персонажа:</label>
            <input type="text" id="name" value="${CHARACTER_CONFIG.name}">
            
            <label>Описание (Кто он?):</label>
            <textarea id="desc" rows="3">${CHARACTER_CONFIG.description}</textarea>
            
            <label>Стиль общения (Как пишет?):</label>
            <textarea id="style" rows="3">${CHARACTER_CONFIG.style}</textarea>
            
            <label>Настроение:</label>
            <select id="mood">
                <option value="neutral" ${CHARACTER_CONFIG.mood === 'neutral' ? 'selected' : ''}>Нейтральное</option>
                <option value="kind" ${CHARACTER_CONFIG.mood === 'kind' ? 'selected' : ''}>Доброе</option>
                <option value="angry" ${CHARACTER_CONFIG.mood === 'angry' ? 'selected' : ''}>Злое</option>
            </select>
            
            <button onclick="saveConfig()">💾 СОХРАНИТЬ И ПРИМЕНИТЬ</button>
            
            <div class="status">
                <p>Сервер жив ✅</p>
                <p>Активных диалогов в памяти: ${Object.keys(chatMemory).length}</p>
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
                
                const res = await fetch('/api/update-char', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(config)
                });
                
                if(res.ok) alert('Персонаж обновлен! Теперь он общается по-новому.');
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

// --- АНТИ-СОН (SELF-PINGER) ---
app.get('/health', (req, res) => res.json({ status: 'alive' }));

setInterval(() => {
    axios.get(`http://localhost:${PORT}/health`).catch(() => {});
}, 300000); // 5 минут

app.listen(PORT, () => {
    console.log(`🌐 Admin Panel: http://localhost:${PORT}`);
});
