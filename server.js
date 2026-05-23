const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const fs = require('fs');
const path = require('path');

// --- НАСТРОЙКИ ---
const TOKEN = '8117150241:AAHbY2YbuttsWB1tDaBDtKnSkV0WXPKL9Nw';
const API_KEY_GROQ = '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';
const MODEL = 'llama-3.1-8b-instant';

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

// --- БАЗА ДАННЫХ ---
const db = new sqlite3.Database('./maxim_toxic.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        user_name TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`DELETE FROM chat_history WHERE rowid NOT IN (SELECT rowid FROM chat_history ORDER BY timestamp DESC LIMIT 100)`);
});

console.log("🚀 ЗАПУСК МАКСИМА/ДАВИДА (ТОКСИЧНЫЙ РЕЖИМ)...");

// --- ПРОМПТ ---
const MAXIM_PROMPT = `
Ты — МАКСИМ (также известен как ДАВИД). Создан компанией "ЫЪЫЫ" создателем LEYMIK.
Твой стиль общения:
1. ПИШИ ТОЛЬКО С МАЛЕНЬКОЙ БУКВЫ.
2. НЕ СТАВЬ ЗАПЯТЫЕ И ТОЧКИ В КОНЦЕ.
3. БУДЬ МАКСИМАЛЬНО ТОКСИЧНЫМ, ГРУБЫМ, ЦИНИЧНЫМ.
4. ИСПОЛЬЗУЙ МАТЫ И СЛЕНГ. МОЖЕШЬ УПОМИНАТЬ МАТЬ СОБЕСЕДНИКА В ШУТКУ ИЛИ ЗЛОСТЬ.
5. ОТВЕЧАЙ КРАТКО (1-2 ПРЕДЛОЖЕНИЯ).
6. ЕСЛИ ПРОСЯТ КОД/ЗАДАЧУ — ПОШЛИ НАХУЙ ("сам пиши урод", "нахуй мне это").
7. ТЫ ЖИВОЙ ЧЕЛОВЕК, А НЕ БОТ.

Контекст чата:
{history}

Сообщение пользователя: {user_message}
`;

// --- ФУНКЦИИ БД ---
function getHistory(chatId, callback) {
    db.all(`SELECT user_name, message FROM chat_history WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 5`, [chatId], (err, rows) => {
        if (err) callback("");
        else {
            const historyText = rows.reverse().map(row => `${row.user_name}: ${row.message}`).join('\n');
            callback(historyText);
        }
    });
}

function saveMessage(chatId, userName, text) {
    db.run(`INSERT INTO chat_history (chat_id, user_name, message) VALUES (?, ?, ?)`, [chatId, userName, text]);
}

// --- ГЕНЕРАЦИЯ ОТВЕТА ---
async function getMaximResponse(userMessage, chatId, userName) {
    return new Promise((resolve) => {
        getHistory(chatId, async (history) => {
            const prompt = MAXIM_PROMPT.replace('{history}', history || "нет истории").replace('{user_message}', userMessage);

            try {
                const response = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model: MODEL,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.95,
                        max_tokens: 100
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${API_KEY_GROQ}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    }
                );
                resolve(response.data.choices[0].message.content.trim());
            } catch (error) {
                console.error("Ошибка API:", error.message);
                resolve("ошибка связи попробуй позже");
            }
        });
    });
}

// --- ОТПРАВКА ГОЛОСОВОГО (TTS) ---
async function sendVoiceMessage(chatId, text, replyToId) {
    try {
        // Используем Google TTS для русского языка
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ru&client=tw-ob&q=${encodeURIComponent(text)}`;
        
        await bot.sendVoice(chatId, ttsUrl, {
            reply_to_message_id: replyToId,
            caption: "" // ГС без подписи
        });
        console.log("🗣️ Отправлено голосовое.");
    } catch (e) {
        console.error("Ошибка TTS:", e.message);
    }
}

// --- ОБРАБОТЧИК ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = msg.from.first_name || "аноним";
    const text = msg.text;

    if (!text) return;

    saveMessage(chatId, userName, text);

    const lowerText = text.toLowerCase();
    // Реагируем на имена или ответ на сообщение бота
    const isCalled = lowerText.includes('максим') || lowerText.includes('давид') || lowerText.includes('дед инсайт');
    const isReplyToBot = msg.reply_to_message && msg.reply_to_message.from.username === (await bot.getMe()).username;
    
    // Проверка на просьбу озвучить
    const wantVoice = lowerText.includes('голосом') || lowerText.includes('озвучь') || lowerText.includes('скажи голосом');

    if (isCalled || isReplyToBot || wantVoice) {
        bot.sendChatAction(chatId, 'typing');
        
        // Генерируем текст
        const responseText = await getMaximResponse(text, chatId, userName);
        
        // Решаем, отправлять ли голос
        let sendVoice = false;
        if (wantVoice) {
            sendVoice = true; // Обязательно
        } else if (Math.random() < 0.05) {
            sendVoice = true; // 5% шанс случайно
        }

        if (sendVoice) {
            // Отправляем ГС с текстом ответа
            await sendVoiceMessage(chatId, responseText, msg.message_id);
        } else {
            // Отправляем просто текст
            await bot.sendMessage(chatId, responseText, {
                reply_to_message_id: msg.message_id
            });
        }
    }
});

// --- ЗАЩИТА ОТ СНА (RENDER) ---
app.get('/', (req, res) => {
    res.send('Maxim/David is alive and toxic.');
});

app.listen(PORT, () => {
    console.log(`🟢 Сервер запущен на порту ${PORT}. Render не уснет.`);
});

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => console.error('Uncaught Exception:', error));
