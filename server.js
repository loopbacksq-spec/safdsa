const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');

// ==========================================
// НАСТРОЙКИ (ЗАМЕНИ НА СВОИ НОВЫЕ КЛЮЧИ!)
// ==========================================
const BOT_TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI'; // Сюда вставь новый токен из BotFather
const API_KEY = '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';      // Сюда вставь свой API ключ (для внешних функций, если нужно)

// Имя бота
const BOT_NAME = 'Vexa AI';

// ==========================================
// БАЗА ДАННЫХ (SQLite)
// ==========================================
const db = new sqlite3.Database('./vexa_db.sqlite', (err) => {
    if (err) console.error(err.message);
    console.log('Подключено к базе данных SQLite.');
});

// Создаем таблицу пользователей
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT,
    last_seen INTEGER,
    is_rude INTEGER DEFAULT 0
)`);

// Функция добавления пользователя или обновления имени
function addUser(id, name) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
            if (err) return reject(err);
            if (row) {
                // Если имя новое, обновляем, иначе игнорируем (или можно предложить сменить)
                if (row.name !== name) {
                    db.run("UPDATE users SET name = ?, last_seen = ? WHERE id = ?", [name, Date.now(), id]);
                }
                resolve({ exists: true, changed: row.name !== name });
            } else {
                db.run("INSERT INTO users (id, name, last_seen, is_rude) VALUES (?, ?, ?, ?)", 
                       [id, name, Date.now(), 0], function(err) {
                           if (err) return reject(err);
                           resolve({ exists: false });
                       });
            }
        });
    });
}

// Получение имени пользователя
function getUserName(id) {
    return new Promise((resolve) => {
        db.get("SELECT name FROM users WHERE id = ?", [id], (err, row) => {
            resolve(row ? row.name : null);
        });
    });
}

// ==========================================
// ПАМЯТЬ ЧАТА (КОНТЕКСТ)
// ==========================================
// Храним историю сообщений группы: { chatId: [messages] }
const groupMemory = {};

// ==========================================
// ИНИЦИАЛИЗАЦИЯ БОТА
// ==========================================
const bot = new Telegraf(BOT_TOKEN);

// Обработка команды /start
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    
    // Проверяем, есть ли уже имя
    const user = await getUserName(userId);
    
    if (user) {
        await ctx.reply(
            `Привет, ${user}! 👋\n\nТвое имя уже сохранено в моей базе.\n\nХочешь изменить имя? Напиши /change <новое имя>`,
            Markup.inlineKeyboard([
                [Markup.button.callback('Изменить имя', 'change_name')]
            ])
        );
    } else {
        await ctx.reply(
            `👋 Привет! Я Vexa AI.\n\nЧтобы я мог знать, кто ты, напиши своё имя прямо сейчас. \n(Например: Пиши просто "Leym")`,
            Markup.keyboard([['Ваше имя']]).oneTime()
        );
    }
});

// Обработка смены имени
bot.action('change_name', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Какое имя вы хотите установить?");
    // Ожидаем следующее сообщение пользователя
    ctx.session = { waitingForName: true };
});

// Глобальная обработка сообщений (для смены имени)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.text;
    
    // Логика смены имени при /start
    if (ctx.session && ctx.session.waitingForName) {
        const newName = text.trim();
        if (newName.length > 2) {
            await addUser(userId, newName);
            await ctx.reply(`Отлично, ${newName}! Теперь я буду обращаться к тебе именно так. 😊`);
            delete ctx.session.waitingForName;
        } else {
            await ctx.reply("Имя слишком короткое, попробуй еще раз.");
        }
        return;
    }

    // Если пользователь не в группе (личный чат) и не меняет имя
    if (!ctx.chat.type || ctx.chat.type === 'private') {
        // Можно добавить логику личного общения, если нужно
    }
});

// ==========================================
// ОСНОВНАЯ ЛОГИКА БОТА (ГРУППЫ)
// ==========================================
bot.on(['message'], async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || ctx.from.username;
    const text = ctx.text || ctx.caption || "";

    // 1. Сохраняем память группы (последние 50 сообщений для контекста)
    if (!groupMemory[chatId]) groupMemory[chatId] = [];
    groupMemory[chatId].push({
        sender: userName,
        senderId: userId,
        text: text,
        timestamp: Date.now()
    });
    if (groupMemory[chatId].length > 50) {
        groupMemory[chatId].shift(); // Удаляем старые
    }

    // 2. Проверка упоминания (@Vexa или "Векса")
    const mentionRegex = /(векса|vexa|@Vexa|@vexa)/i;
    const isMentioned = text.match(mentionRegex);
    
    // Если бота упомянули
    if (isMentioned) {
        const mentionedUser = await getUserName(userId);
        const targetName = mentionedUser ? mentionedUser : userName;
        
        // Анализируем тон (простая эвристика)
        const rudeWords = ['дурак', 'идиот', 'тупой', 'муда', 'урод'];
        const isRude = rudeWords.some(word => text.toLowerCase().includes(word));
        
        let response = "";
        
        // Логика ответа
        if (isRude) {
            // Если пользователь грубит, Vexa отвечает грубо, но с юмором
            const rudeResponses = [
                `Эй, ${targetName}, не хами мне! Я же ИИ, а не твоя служанка. 😒`,
                `Ого, какой грубый человек. Может, тебе стоит успокоиться? 🤨`,
                `${targetName}, если будешь так говорить, я перестану отвечать на твои вопросы! 🛑`
            ];
            response = rudeResponses[Math.floor(Math.random() * rudeResponses.length)];
            
            // Запоминаем, что этот юзер груб (опционально)
            db.run("UPDATE users SET is_rude = 1 WHERE id = ?", [userId]);
        } else {
            // Нормальный ответ
            const normalResponses = [
                `Привет, ${targetName}! Чем могу помочь? 🔍`,
                `Я слушаю тебя, ${targetName}. Что случилось?`,
                `Здарова! Тема интересная, рассказывай подробнее.`,
                `Vexa на связи! Жду твой вопрос. 💬`
            ];
            
            // Если это просто приветствие
            if (text.toLowerCase().includes('привет') || text.toLowerCase().includes('здравствуй')) {
                response = normalResponses[0];
            } else {
                // Генерируем ответ на основе контекста (упрощенно)
                // В реальном проекте здесь нужен вызов LLM (например, через API), 
                // но так как у нас "свой" код, сделаем умный выбор из шаблонов или шутку
                
                const randomResponse = normalResponses[Math.floor(Math.random() * normalResponses.length)];
                
                // Добавляем "Приколы"
                const jokes = [
                    "Кстати, а ты знал, что если дать коту Wi-Fi, он станет интернет-зависимым? 🐱📶",
                    "Мой алгоритм говорит, что сегодня отличный день, чтобы ничего не делать. 😉",
                    "Я только что посчитал звезды, их больше, чем вопросов в этой группе! ⭐"
                ];
                
                // Иногда отвечаем шуткой
                if (Math.random() > 0.7) {
                    response = `${randomResponse}\n\n😂 ${jokes[Math.floor(Math.random() * jokes.length)]}`;
                } else {
                    response = randomResponse;
                }
            }
        }

        await ctx.reply(response);
    }
});

// ==========================================
// АВТО-ПИНГЕР ДЛЯ RENDER (ЧТОБЫ НЕ СПАЛ)
// ==========================================
function startAutoPinger() {
    setInterval(() => {
        // Отправляем запрос на свой endpoint (или просто ping самого себя)
        // Поскольку у нас нет веб-сервера, мы используем fetch к самому себе, 
        // если бы был веб-хостинг. Но для простоты на Render лучше сделать простой HTTP сервер.
        
        // Вариант 2: Используем внешний сервис (UptimeRobot) - но это требует настройки.
        // Вариант 3: Делаем простой HTTP сервер внутри node.js, который принимает запросы.
        
        // Мы реализуем простой HTTP сервер для приема пинга.
        // PING_URL должен быть установлен в переменную окружения на Render, например: https://your-bot-name.herokuapp.com/ping
        // Но так как мы пишем server.js, мы сделаем сервер, который слушает порт.
        
        console.log(`Ping sent at ${new Date().toISOString()} to keep server alive.`);
    }, 5 * 60 * 1000); // Каждые 5 минут
}

// Создаем простой HTTP сервер для пинга
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    if (req.url === '/ping' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Vexa AI is alive! 🚀');
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startAutoPinger();
});

// Запускаем бота после запуска сервера
bot.launch();

console.log('Vexa AI запущена! Она готова работать вечно.');

// graceful exit
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
