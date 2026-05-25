const express = require('express');
const { Groq } = require('groq-sdk');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- КОНФИГУРАЦИЯ ---
const GROQ_API_KEY = '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'; // ТВОЙ КЛЮЧ
const ADMIN_IP = '176.209.197.124'; 
const ADMIN_COMMAND = 'snk1229!';
const RENDER_PING_URL = process.env.RENDER_PING_URL || 'http://localhost:3000/health'; 

// Инициализация Groq
const groq = new Groq({ apiKey: GROQ_API_KEY });

// --- БАЗА ДАННЫХ (SQLite) ---
const db = new sqlite3.Database('./sitex.db', (err) => {
    if (err) console.error(err.message);
    else {
        console.log('Connected to the SQLite database.');
        // Таблица сайтов
        db.run(`CREATE TABLE IF NOT EXISTS sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            description TEXT,
            url TEXT,
            shortCode TEXT UNIQUE,
            status TEXT DEFAULT 'pending', -- pending, approved, rejected
            reason TEXT,
            ownerIp TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            expiresAt DATETIME
        )`);
        
        // Таблица пользователей (для админок)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            ip TEXT PRIMARY KEY,
            isAdmin INTEGER DEFAULT 0,
            apiToken TEXT
        )`);
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Папка для фронтенда (если будет)

// --- АВТО ПИНГЕР (Вечный) ---
setInterval(async () => {
    try {
        await axios.get(RENDER_PING_URL);
        console.log('Ping sent: Server is alive.');
    } catch (error) {
        console.error('Ping failed:', error.message);
    }
}, 60000); // Каждую минуту

// --- УТИЛИТЫ ---
function generateShortCode(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function setExpiry() {
    const date = new Date();
    date.setDate(date.getDate() + 1); // 24 часа
    return date.toISOString();
}

// --- API РОУТЫ ---

// 1. Отправка заявки на публикацию
app.post('/api/upload', async (req, res) => {
    const { targetUrl, title, description, userIp } = req.body;

    if (!targetUrl || !title || !description) {
        return res.status(400).json({ error: 'Все поля обязательны!' });
    }

    const shortCode = generateShortCode();
    const expiresAt = setExpiry();
    
    // Создаем запись как "pending"
    const stmt = db.prepare(`INSERT INTO sites (url, name, description, shortCode, status, ownerIp, expiresAt) VALUES (?, ?, ?, ?, 'pending', ?, ?)`);
    stmt.run(targetUrl, title, description, shortCode, userIp, expiresAt);
    stmt.finalize();

    // Запускаем проверку AI
    checkWithAI(targetUrl, title, description, shortCode, userIp);

    res.json({ message: 'Заявка отправлена на модерацию', shortCode: shortCode });
});

// 2. Проверка через AI (Groq)
async function checkWithAI(url, title, desc, code, ip) {
    console.log(`Checking ${code} with AI...`);
    
    try {
        // 1. Скачиваем контент сайта для анализа
        let content = "";
        try {
            const response = await axios.get(url, { timeout: 5000 });
            content = response.data.substring(0, 5000); // Берем первые 5000 символов
        } catch (e) {
            throw new Error("Ссылка неактивна или недоступна.");
        }

        // 2. Формируем промпт для Groq
        const prompt = `
        Проанализируй следующий сайт. 
        URL: ${url}
        Название: ${title}
        Описание: ${desc}
        Контент (первые строки): ${content}

        ЗАДАЧИ:
        1. Проверь, нет ли здесь вирусов или вредоносного кода (js eval, скрытые скрипты).
        2. Проверь, нет ли плагиата (повторяется ли описание или контент с других известных ресурсов).
        3. Проверь актуальность ссылки (если она битая, верни ошибку).
        4. Проверь соблюдение авторских прав (нет ли краденого контента).

        ОТВЕЧАЙ ТОЛЬКО JSON формата:
        {
            "approved": boolean,
            "reason": "строка причины (если отклонено)",
            "riskLevel": "low|medium|high"
        }
        `;

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama3-70b-8192", // Самая актуальная модель Llama 3
            temperature: 0.2, // Низкая температура для строгости
            max_tokens: 300
        });

        const aiResponse = chatCompletion.choices[0].message.content;
        
        // Парсим ответ AI
        let verdict;
        try {
            // Иногда AI может добавить текст вокруг JSON, пытаемся вытащить JSON
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                verdict = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error("Не удалось распарсить ответ AI");
            }
        } catch (e) {
            console.error("Ошибка парсинга AI:", e);
            verdict = { approved: false, reason: "Ошибка системы анализа AI.", riskLevel: "unknown" };
        }

        // Обновляем статус в БД
        const updateStatus = db.prepare(`UPDATE sites SET status = ?, reason = ? WHERE shortCode = ?`);
        updateStatus.run(verdict.approved ? 'approved' : 'rejected', verdict.reason, code);
        updateStatus.finalize();

        console.log(`Result for ${code}: ${verdict.approved ? 'APPROVED' : 'REJECTED'} - ${verdict.reason}`);

    } catch (error) {
        console.error("Error during AI check:", error.message);
        const updateStatus = db.prepare(`UPDATE sites SET status = ?, reason = ? WHERE shortCode = ?`);
        updateStatus.run('rejected', 'Ошибка проверки: ' + error.message, code);
        updateStatus.finalize();
    }
}

// 3. Получение списка сайтов (Рекомендации)
app.get('/api/sites', (req, res) => {
    const limit = req.query.limit || 10;
    db.all(`SELECT * FROM sites WHERE status = 'approved' ORDER BY RANDOM() LIMIT ?`, [limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 4. Поиск по названию
app.get('/api/search/:query', (req, res) => {
    const query = `%${req.params.query}%`;
    db.all(`SELECT * FROM sites WHERE status = 'approved' AND name LIKE ?`, [query], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 5. Доступ к сайту по короткому коду
app.get('/:shortCode', (req, res) => {
    const { shortCode } = req.params;
    
    db.get(`SELECT * FROM sites WHERE shortCode = ? AND status = 'approved'`, [shortCode], (err, row) => {
        if (err || !row) {
            return res.status(404).send('<h1>Игра не найдена или удалена</h1>');
        }

        // Если срок истек (24 часа)
        if (new Date(row.expiresAt) < new Date()) {
            // Автоматическое продление при посещении? Нет, по правилам: "продлить при последнем часе".
            // Для упрощения: если истекло, показываем сообщение о продлении
            return res.send(`
                <html>
                <head><title>${row.name}</title></head>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h1>${row.name}</h1>
                    <p>${row.description}</p>
                    <div style="background: #333; color: white; padding: 20px; border-radius: 10px;">
                        <p>⚠️ Срок действия игры истек!</p>
                        <p>Чтобы продолжить, напишите команду в консоль платформы.</p>
                        <button onclick="window.location.href='/console'">Вернуться в Консоль Sitex</button>
                    </div>
                </body>
                </html>
            `);
        }

        // Если все ок, перенаправляем на оригинальный URL или рендерим iframe (Canvas)
        // Для безопасности лучше использовать iframe с sandbox
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${row.name} - Sitex Canvas</title>
                <style>
                    body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #1a1a1a; }
                    iframe { width: 100%; height: 100%; border: none; }
                    .header { position: absolute; top: 10px; left: 10px; color: white; z-index: 10; font-family: monospace; }
                </style>
            </head>
            <body>
                <div class="header">Sitex Canvas: ${row.name}</div>
                <iframe src="${row.url}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
            </body>
            </html>
        `);
    });
});

// 6. Консоль (Загрузка, Админка, Генерация)
app.post('/api/console/action', (req, res) => {
    const { action, data, userIp } = req.body;

    if (action === 'generate') {
        // Генерация сайта через AI
        const { prompt } = data;
        // Для обычных юзеров нужен их API, но мы эмулируем "готовый" для админа
        // Здесь упрощенная логика: AI пишет HTML код
        
        groq.chat.completions.create({
            messages: [{ role: "user", content: `Напиши полный HTML код простой игры или сайта на тему: "${prompt}". Код должен быть в одном блоке. Не пиши ничего кроме кода.` }],
            model: "llama3-70b-8192",
            temperature: 0.7
        }).then((completion) => {
            const generatedCode = completion.choices[0].message.content;
            
            // Сохраняем временный сайт
            const tempCode = generateShortCode();
            db.run(`INSERT INTO sites (url, name, description, shortCode, status, ownerIp, expiresAt) VALUES (?, ?, ?, ?, 'pending', ?, ?)`, 
                ["data:text/html;base64," + Buffer.from(generatedCode).toString('base64'), "AI Generated Site", "Generated by Sitex AI", tempCode, userIp, setExpiry()], 
                function(err) {
                    if(err) return res.json({error: err.message});
                    res.json({ success: true, shortCode: tempCode, message: "Сайт сгенерирован и ждет модерации." });
                }
            );
        });
        return; // Асинхронно
    }

    if (action === 'request_admin') {
        if (userIp !== ADMIN_IP) {
             // Логика: проверяем IP подавателя
             // Если IP совпадает с нашим, даем заявку
             if (userIp === ADMIN_IP) {
                 // Проверяем, есть ли уже заявка
                 db.get(`SELECT * FROM users WHERE ip = ?`, [userIp], (err, row) => {
                     if (row && row.isAdmin) {
                         return res.json({ success: true, message: "Вы уже админ." });
                     }
                     // В реальной системе это было бы отдельное действие, но тут мы просто ставим флаг
                     db.run(`UPDATE users SET isAdmin = 1 WHERE ip = ?`, [userIp], function(err) {
                         if (err) db.run(`INSERT INTO users (ip, isAdmin) VALUES (?, 1)`, [userIp]);
                         res.json({ success: true, message: "Заявка принята! Вы стали админом." });
                     });
                 });
             } else {
                 res.json({ success: false, message: "Доступ запрещен. Только разрешенный IP." });
             }
        }
    }

    if (action === 'verify_admin_command') {
        if (data.command === ADMIN_COMMAND && userIp === ADMIN_IP) {
             db.run(`UPDATE users SET isAdmin = 1 WHERE ip = ?`, [userIp], function(err) {
                 if (err) db.run(`INSERT INTO users (ip, isAdmin) VALUES (?, 1)`, [userIp]);
                 res.json({ success: true, message: "Админка активирована!" });
             });
        } else {
            res.json({ success: false, message: "Неверная команда или IP." });
        }
    }

    if (action === 'extend_game') {
        const { shortCode } = data;
        db.run(`UPDATE sites SET expiresAt = ? WHERE shortCode = ? AND status = 'approved'`, [setExpiry(), shortCode], function(err) {
            if (err) return res.json({ error: err.message });
            res.json({ success: true, message: "Время продлено на 24 часа." });
        });
    }

    res.json({ error: "Неизвестное действие" });
});

// Старт сервера
app.listen(PORT, () => {
    console.log(`Sitex Server running on port ${PORT}`);
    console.log(`Auto-pinger active.`);
});
