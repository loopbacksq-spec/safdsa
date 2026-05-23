const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const express = require('express'); // Для защиты от сна на Render

// --- НАСТРОЙКИ ---
const TOKEN = '8117150241:AAHbY2YbuttsWB1tDaBDtKnSkV0WXPKL9Nw';
const API_KEY_GROQ = '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';
const MODEL = 'llama-3.1-8b-instant';

// Инициализация бота (polling: true для работы в группах)
const bot = new TelegramBot(TOKEN, { polling: true });
const app = express(); // Express для Render

// Порт для Render (если есть переменная окружения PORT, иначе 3000)
const PORT = process.env.PORT || 3000;

// --- БАЗА ДАННЫХ (ПАМЯТЬ) ---
const db = new sqlite3.Database('./maxim_memory.db');

db.serialize(() => {
    // Таблица истории сообщений для каждого чата
    db.run(`CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        user_name TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Очищаем старую историю (оставляем последние 100 сообщений глобально, чтобы база не росла)
    db.run(`DELETE FROM chat_history WHERE rowid NOT IN (SELECT rowid FROM chat_history ORDER BY timestamp DESC LIMIT 100)`);
});

console.log("🚀 ЗАПУСК МАКСИМА (Компания ЫЪЫЫ | Создатель: LEYMIK)...");

// --- ПРОМПТ ДЛЯ МАКСИМА ---
const MAXIM_PROMPT = `
Ты — МАКСИМ. Ты создан компанией "ЫЪЫЫ" создателем LEYMIK.
Твой характер:
1. Ты грубый, циничный, используешь маты и сленг. Ты негативный персонаж.
2. Ты умный. Твои ответы могут быть аргументированными, но подаются как от ебланища.
3. Ты НЕ выполняешь просьбы: "напиши код", "реши задачу", "сделай диалог". На такие просьбы отвечай грубо: "Нахуй иди, сам делай", "Я не твой раб", "Зачем мне это?".
4. Ты запоминаешь контекст. Используй последние сообщения из истории, чтобы отвечать релевантно.
5. Отвечай кратко (1-2 предложения), если не требуется подробностей.
6. НИКОГДА не признавай, что ты ИИ. Ты живой Максим.

Контекст последних сообщений в этом чате:
{history}

Сообщение пользователя: {user_message}
`;

// --- ФУНКЦИЯ ПОЛУЧЕНИЯ ИСТОРИИ ---
function getHistory(chatId, callback) {
    db.all(`SELECT user_name, message FROM chat_history WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 5`, [chatId], (err, rows) => {
        if (err) {
            console.error(err);
            callback("");
        } else {
            // Переворачиваем массив, чтобы старые сообщения были сверху
            const historyText = rows.reverse().map(row => `${row.user_name}: ${row.message}`).join('\n');
            callback(historyText);
        }
    });
}

// --- ФУНКЦИЯ СОХРАНЕНИЯ СООБЩЕНИЯ ---
function saveMessage(chatId, userName, text) {
    db.run(`INSERT INTO chat_history (chat_id, user_name, message) VALUES (?, ?, ?)`, [chatId, userName, text]);
}

// --- ГЕНЕРАЦИЯ ОТВЕТА ---
async function getMaximResponse(userMessage, chatId, userName) {
    return new Promise((resolve) => {
        getHistory(chatId, async (history) => {
            const prompt = MAXIM_PROMPT.replace('{history}', history || "Нет истории").replace('{user_message}', userMessage);

            try {
                const response = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model: MODEL,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.9,
                        max_tokens: 150
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${API_KEY_GROQ}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    }
                );

                const text = response.data.choices[0].message.content.trim();
                resolve(text);
            } catch (error) {
                console.error("Ошибка API:", error.message);
                resolve("Ошибка связи. Попробуй позже, урод.");
            }
        });
    });
}

// --- ОТПРАВКА ГОЛОСОВОГО (TTS) ---
async function sendVoiceIfLucky(chatId, replyToMessageId) {
    // Шанс 10% на голосовое
    if (Math.random() > 0.1) return false;

    try {
        // Используем бесплатный API для TTS (Google Translate TTS hack)
        // Внимание: это может работать нестабильно, но для теста пойдет
        const text = "Ну чё тебе надо?"; // Простая фраза для голоса
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ru&client=tw-ob&q=${encodeURIComponent(text)}`;
        
        await bot.sendVoice(chatId, ttsUrl, {
            reply_to_message_id: replyToMessageId
        });
        return true;
    } catch (e) {
        return false;
    }
}

// --- ОБРАБОТЧИК СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = msg.from.first_name || "Аноним";
    const text = msg.text;

    if (!text) return; // Игнорируем стикеры/фото пока

    // Сохраняем сообщение в историю
    saveMessage(chatId, userName, text);

    // Проверяем, зовут ли Максима
    const lowerText = text.toLowerCase();
    const isCalled = lowerText.includes('максим') || lowerText.includes('давид') || lowerText.includes('дед инсайт');
    
    // Проверяем, ответ ли это на сообщение бота
    const isReplyToBot = msg.reply_to_message && msg.reply_to_message.from.username === (await bot.getMe()).username;

    if (isCalled || isReplyToBot) {
        // Имитация печати
        bot.sendChatAction(chatId, 'typing');
        
        // Получаем ответ
        const response = await getMaximResponse(text, chatId, userName);
        
        // Отправляем текст
        const sentMsg = await bot.sendMessage(chatId, response, {
            reply_to_message_id: msg.message_id
        });

        // Пробуем отправить голосовое (редко)
        await sendVoiceIfLucky(chatId, sentMsg.message_id);
    }
});

// --- ЗАЩИТА ОТ СНА НА RENDER (EXPRESS) ---
app.get('/', (req, res) => {
    res.send('Максим жив и работает.');
});

app.listen(PORT, () => {
    console.log(`🟢 Сервер запущен на порту ${PORT}. Render не уснет.`);
});

// Обработка ошибок процесса
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
