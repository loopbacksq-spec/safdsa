const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

// --- НАСТРОЙКИ ---
const TOKEN = '8117150241:AAHbY2YbuttsWB1tDaBDtKnSkV0WXPKL9Nw';
const CHANNEL_ID = '-1003992026404'; 
const API_KEY_GROQ = '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';
const MODEL = 'llama-3.1-8b-instant';

// --- ИНИЦИАЛИЗАЦИЯ ---
const bot = new TelegramBot(TOKEN, { polling: false }); // ВАЖНО: polling=false убирает ошибку [polling_error]
const db = new sqlite3.Database('./davids_clean.db');

console.log("🚀 Запуск чистого авто-постера...");

// --- БАЗА ДАННЫХ ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Очистка старых постов (хранить только последние 50)
    db.run(`DELETE FROM posts WHERE rowid NOT IN (SELECT rowid FROM posts ORDER BY created_at DESC LIMIT 50)`);
});

// --- ГЕНЕРАТОР ПОСТА (ЧИСТЫЙ СТИЛЬ) ---
async function generatePost() {
    const prompt = `
    Ты — циничный, грубый и умный человек. Твой стиль: короткий, дерзкий, без цензуры, иногда с матом.
    
    ТВОЯ ЗАДАЧА:
    1. Придумай абсолютно уникальную тему на лету (реалистичный эксперимент, альтернативная история, странный случай, физика, психология).
    2. Напиши об этом 2-3 предложения.
    3. Будь максимально реалистичным, но агрессивным.
    4. НЕ используй заголовки типа "Новости", "Дед Инсайт".
    5. НЕ обращайся к кому-либо по имени ("LEYMIK", "депрессивный"). Пиши просто от себя.
    6. Не пиши код, не давай советы. Только мнение или история.
    
    Примеры стиля:
    "Если гравитация исчезнет на минуту, все полетят в космос, а потом разобьются о землю. Смехотворно."
    "Гагарин взлетел бы раньше, но упал бы в другую страну. История — это просто набор лжи."
    "Люди думают, что контролируют мир? Хах. Они просто крысы в колесе."
    
    Напиши ТОЛЬКО текст поста. Без лишних слов.
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.95,
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
        
        if (!postText || postText.length < 5) throw new Error("Пустой ответ");
        
        return { text: postText };

    } catch (error) {
        console.error(`❌ Ошибка генерации:`, error.message);
        return null;
    }
}

// --- ФУНКЦИЯ ОТПРАВКИ ---
async function publishPost(postData) {
    if (!postData) return false;

    const postId = uuidv4();
    
    try {
        // Сохранение в БД
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO posts (id, content) VALUES (?, ?)`, 
                   [postId, postData.text], 
                   (err) => err ? reject(err) : resolve());
        });

        // Отправка в канал
        await bot.sendMessage(CHANNEL_ID, `${postData.text}\n\n#хаос #мысли #реализм`, { parse_mode: 'Markdown' });
        console.log(`✅ Пост опубликован: "${postData.text.substring(0, 30)}..."`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка отправки:`, error.message);
        return false;
    }
}

// --- ОСНОВНОЙ ЦИКЛ С АВТО-ПЕРЕЗАПУСТОМ ---
async function mainLoop() {
    while (true) {
        try {
            console.log(`⏳ Генерация поста... (${new Date().toLocaleTimeString()})`);
            
            const post = await generatePost();
            
            if (post) {
                const success = await publishPost(post);
                if (success) {
                    console.log(`✅ Успешно! Ждем следующую публикацию.`);
                } else {
                    console.log(`⚠️ Пост создан, но не отправлен.`);
                }
            } else {
                console.log(`⚠️ Не удалось создать пост.`);
            }

        } catch (error) {
            console.error(`💥 КРИТИЧЕСКАЯ ОШИБКА:`, error.message);
        }

        // Пауза между постами: от 60 до 120 секунд
        const delay = Math.floor(Math.random() * 60000) + 60000;
        console.log(`⏱ Ждем ${delay/1000} сек...`);
        
        await sleep(delay);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- ПИНГЕР (ЧТОБЫ НЕ УМИРАЛ) ---
setInterval(() => {
    console.log(`🟢 Сервер жив. Время: ${new Date().toLocaleTimeString()}`);
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
