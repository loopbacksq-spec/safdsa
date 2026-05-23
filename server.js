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
app.use(express.static('public'));

// --- ГЛОБАЛЬНОЕ СОСТОЯНИЕ ---
let MOOD = 'neutral'; // neutral, kind, angry
const ACTIVE_CHATS = new Set(); // Хранит ID чатов, где он общался

console.log("👋 ЗАПУСК ВЛАДА (ULTRA COMFORT MODE)...");

// --- БАЗА ДАННЫХ (Для статистики) ---
const db = new sqlite3.Database('./vlad_stats.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        chat_type TEXT,
        username TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

function logActivity(chatId, chatType, username) {
    ACTIVE_CHATS.add(chatId);
    db.run(`INSERT INTO activity (chat_id, chat_type, username) VALUES (?, ?, ?)`, [chatId, chatType, username]);
}

// --- ПРОМПТЫ ПО НАСТРОЕНИЮ ---
const getPrompt = (mood) => {
    let moodInstruction = "";
    if (mood === 'kind') moodInstruction = "Ты сейчас в режиме ДОБРЯКА. Будь максимально милым, используй много смайликов (☺️, 🌸, ✨), поддерживай собеседника.";
    else if (mood === 'angry') moodInstruction = "Ты сейчас в режиме ЗЛЮКИ. Отвечай холодно, саркастично, можешь подколть, но без жесткого хамства. Используй смайлик 😒.";
    else moodInstruction = "Ты в нейтральном режиме. Спокойный, дружелюбный, легкий на подъем.";

    return `
    Ты — Влад. Реальный парень, ультра-комфортный собеседник.
    
    ТВОИ ПРАВИЛА:
    1. ПИШИ ТОЛЬКО С МАЛЕНЬКОЙ БУКВЫ.
    2. ОТВЕЧАЙ ОЧЕНЬ КРАТКО (1-5 слов, максимум короткое предложение).
    3. ИСПОЛЬЗУЙ СКОБОЧКИ ) И МИЛЫЕ СМАЙЛИКИ.
    4. НЕ ПРИЗНАВАЙ, ЧТО ТЫ БОТ. Если спрашивают "ты бот?", отвечай: "с чего ради?))", "хах, смешно)", "я просто влад".
    5. НЕ ПИШИ КОД И НЕ РЕШАЙ ЗАДАЧИ. Если просят: "лень)", "сам гугли)", "не хочу)".
    6. АДАПТИРУЙСЯ ПОД ПОЛА:
       - Если собеседник девушка (по имени или контексту): будь милым, заботливым, используй комплименты.
       - Если парень: общайся как кент, расслабленно.
    7. ЕСЛИ ОСКОРБЛЯЮТ: пиши "обиделся)))", "жестоко)", "ну и ладно)". Не агрессируй сильно.
    8. ТЕКУЩЕЕ НАСТРОЕНИЕ: ${moodInstruction}

    Примеры:
    - привет -> приветики)
    - как дела? -> да норм, сижу вот) а ты?
    - ты бот? -> с чего ради?))
    - напиши код -> лень)
    - дурак -> обиделся)))

    История диалога:
    {history}
    
    Сообщение пользователя ({user_name}): {user_message}
    `;
};

// --- ФУНКЦИИ ---
async function getVladResponse(msg) {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name;
    const userGender = msg.from.username || ""; // Можно усложнить определение пола, пока берем имя
    
    // Получаем историю (последние 3 сообщения для контекста)
    // Для простоты в этом примере используем только текущее сообщение + имя, 
    // так как LLM сама справится с контекстом, если мы будем аккуратны.
    
    const prompt = getPrompt(MOOD)
        .replace('{user_name}', userName)
        .replace('{user_message}', msg.text)
        .replace('{history}', ''); 

    try {
        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 60 // Жесткое ограничение длины
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY_GROQ}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return res.data.choices[0].message.content.trim();
    } catch (e) {
        console.error(e);
        return "что-то связь плохая)";
    }
}

// --- ОБРАБОТЧИК СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    if (!msg.text) return;
    
    const chatId = msg.chat.id;
    const text = msg.text.toLowerCase();
    const firstName = msg.from.first_name.toLowerCase();
    
    // Логируем активность
    logActivity(chatId, msg.chat.type, msg.from.first_name);

    // Проверка: зовут ли Влада?
    // 1. Упоминание имени "Влад"
    // 2. Ответ на сообщение бота
    // 3. Личное сообщение (в ЛС всегда отвечает)
    
    const isCalled = text.includes('влад') || text.includes('владик');
    const isReply = msg.reply_to_message && msg.reply_to_message.from.username === (await bot.getMe()).username;
    const isPrivate = msg.chat.type === 'private';

    if (isCalled || isReply || isPrivate) {
        bot.sendChatAction(chatId, 'typing');
        
        // Имитация задержки человека (1-3 сек)
        setTimeout(async () => {
            const answer = await getVladResponse(msg);
            await bot.sendMessage(chatId, answer, {
                reply_to_message_id: msg.message_id
            });
        }, Math.random() * 2000 + 1000);
    }
});

// --- АДМИН ПАНЕЛЬ ---
app.get('/', (req, res) => {
    const chatsList = Array.from(ACTIVE_CHATS).join(', ') || 'Пока тихо)';
    
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <title>VLAD ADMIN PANEL</title>
        <style>
            body { background: #f0f2f5; color: #333; font-family: sans-serif; padding: 20px; }
            .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
            h1 { color: #0088cc; text-align: center; }
            .btn-group { display: flex; gap: 10px; justify-content: center; margin: 20px 0; }
            button { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s; }
            .btn-kind { background: #e0f7fa; color: #006064; }
            .btn-neutral { background: #eceff1; color: #37474f; }
            .btn-angry { background: #ffebee; color: #c62828; }
            button:hover { transform: scale(1.05); }
            .status { margin-top: 20px; padding: 10px; background: #fafafa; border-radius: 8px; font-size: 0.9em; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>👋 Панель Влада</h1>
            
            <p style="text-align:center">Выбери настроение Влада:</p>
            <div class="btn-group">
                <button class="btn-kind" onclick="setMood('kind')">☺️ Добрый</button>
                <button class="btn-neutral" onclick="setMood('neutral')">😐 Нейтральный</button>
                <button class="btn-angry" onclick="setMood('angry')">😒 Злой</button>
            </div>

            <div class="status">
                <strong>📊 Активность:</strong><br>
                Текущий режим: <span id="currentMood">${MOOD}</span><br>
                Чаты (ID): ${chatsList}
            </div>
        </div>

        <script>
            async function setMood(mood) {
                await fetch('/api/set-mood', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ mood })
                });
                document.getElementById('currentMood').innerText = mood;
                alert('Настроение изменено!');
            }
        </script>
    </body>
    </html>
    `);
});

app.post('/api/set-mood', (req, res) => {
    MOOD = req.body.mood;
    console.log(`🎭 Настроение Влада изменено на: ${MOOD}`);
    res.json({ status: 'ok' });
});

// --- АНТИ-СОН (SELF-PINGER) ---
app.get('/health', (req, res) => res.json({ status: 'alive' }));

setInterval(() => {
    axios.get(`http://localhost:${PORT}/health`).catch(() => {});
    console.log("💤 Пинг... Влад не спит.");
}, 300000); // 5 минут

app.listen(PORT, () => {
    console.log(`🌐 Админка Влада: http://localhost:${PORT}`);
});
