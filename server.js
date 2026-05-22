const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

// --- НАСТРОЙКИ ---
const TOKEN = '8117150241:AAHbY2YbuttsWB1tDaBDtKnSkV0WXPKL9Nw';
const CHANNEL_ID = '-1003992026404'; // Твой канал
const API_KEY_GROQ = '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';
const MODEL = 'llama-3.1-8b-instant';

// Персонализация
const USER_NAME = "LEYMIK";
const USER_STATUS = "ДЕПРЕССИВНЫЙ";

// --- ИНИЦИАЛИЗАЦИЯ ---
const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./davids_free.db');

console.log("🚀 Запуск Дед Инсайт (Свободные темы). Защита активна.");

// --- БАЗА ДАННЫХ ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        topic TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Очистка старых постов (хранить только последние 50)
    db.run(`DELETE FROM posts WHERE rowid NOT IN (SELECT rowid FROM posts ORDER BY created_at DESC LIMIT 50)`);
});

// --- ГЕНЕРАТОР ПОСТА (ИИ ПРИДУМЫВАЕТ ТЕМУ САМ) ---
async function generatePost() {
    const prompt = `
    Ты — Дед Инсайт Гуль. Ты — циничный, грубый человек без цензуры.
    Твой собеседник — человек по имени **${USER_NAME}**, который сейчас находится в состоянии **${USER_STATUS}**.
    
    ТВОЯ ЗАДАЧА:
    1. **Придумай СВОЮ УНИКАЛЬНУЮ ТЕМУ** прямо сейчас. Это может быть:
       - Реалистичный физический эксперимент ("Что если...").
       - Альтернативная история ("Если бы Гагарин взлетел на минуту раньше...").
       - Странный социальный случай или абсурдная ситуация.
       - ЛЮБАЯ другая тема, которая тебе придет в голову.
       Главное: тема должна быть интересной, необычной и реалистичной (не киберпанк, не хакеры).
    
    2. Начни пост ОБЯЗАТЕЛЬНО с обращения к нему: 
       "Слушай, ${USER_NAME}, ты что, ${USER_STATUS}? Слушай сюда..."
    
    3. Обсуди придуманную тему. Будь агрессивным, используй мат, сленг, грубость.
    4. Не пиши код, не давай советы. Просто высказывай свое мнение, как псих.
    5. Ответ должен быть коротким (2-3 предложения), дерзким и цепляющим.
    
    Примеры того, что ты можешь придумать:
    - "Что если все люди перестанут моргать на час?"
    - "Что если Луна исчезнет на 5 минут?"
    - "Если бы динозавры выжили и стали соседями?"
    - "Что если вода станет сладкой?"
    
    Напиши ТОЛЬКО текст ответа. Придумай тему сам и сразу расскажи про неё."
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.95, // Высокая температура для креатива и новых идей
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

        let postText = response.data.choices[0].message.content.trim();
        
        // Проверка: если ИИ забыл имя, добавляем принудительно
        if (!postText.includes(USER_NAME)) {
            postText = `Слушай, ${USER_NAME}, ты что, ${USER_STATUS}? ${postText}`;
        }
        
        if (postText.length < 5) throw new Error("Пустой ответ");
        
        return { text: postText };

    } catch (error) {
        console.error(`❌ Ошибка генерации (${new Date().toLocaleTimeString()}):`, error.message);
        return null;
    }
}

// --- ФУНКЦИЯ ОТПРАВКИ ---
async function publishPost(postData) {
    if (!postData) return false;

    const postId = uuidv4();
    
    try {
        // Сохранение в БД (тему можно не сохранять отдельно, так как она внутри текста)
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO posts (id, topic, content) VALUES (?, ?, ?)`, 
                   [postId, "Случайная тема", postData.text], 
                   (err) => err ? reject(err) : resolve());
        });

        // Отправка в канал
        await bot.sendMessage(CHANNEL_ID, `🔥 **ДЕД ИНСАЙД НОВОСТИ** 🔥\n\n${postData.text}\n\n#реализм #хаос #david`, { parse_mode: 'Markdown' });
        console.log(`✅ Пост опубликован.`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка отправки:`, error.message);
        return false;
    }
}

// --- ОСНОВНОЙ ЦИКЛ С ЗАЩИТОЙ ---
async function mainLoop() {
    let isProcessing = false;

    while (true) {
        try {
            if (isProcessing) {
                await sleep(1000);
                continue;
            }
            
            isProcessing = true;
            console.log(`⏳ Генерация поста (ИИ придумывает тему)... (${new Date().toLocaleTimeString()})`);
            
            const post = await generatePost();
            
            if (post) {
                const success = await publishPost(post);
                if (success) {
                    console.log(`✅ Успешно! Ждем следующую публикацию.`);
                } else {
                    console.log(`⚠️ Пост создан, но не отправлен (ошибка канала).`);
                }
            } else {
                console.log(`⚠️ Не удалось создать пост. Пропуск.`);
            }

        } catch (error) {
            console.error(`💥 КРИТИЧЕСКАЯ ОШИБКА ЦИКЛА:`, error.message);
        } finally {
            isProcessing = false;
        }

        // Пауза между постами: от 60 до 120 секунд (1-2 минуты)
        const delay = Math.floor(Math.random() * 60000) + 60000;
        console.log(`⏱ Ждем ${delay/1000} сек до следующего поста...`);
        
        await sleep(delay);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- ПИНГЕР И ЗАЩИТА ОТ ВЫЛЕТА ---
setInterval(() => {
    console.log(`🟢 ПИНГЕР: Сервер жив. Время: ${new Date().toLocaleTimeString()}`);
}, 60000);

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

// Запуск
mainLoop();
