const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');

// ==========================================
// НАСТРОЙКИ (ОБЯЗАТЕЛЬНО ЗАМЕНИ ТОКЕН!)
// ==========================================
// Вставь сюда свой НОВЫЙ токен из @BotFather (старый отзови!)
const BOT_TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI'; // <--- ЗАМЕНИ ЭТОТ ТОКЕН НА СВОЙ НОВЫЙ!

// Твой API ключ (если нужен для внешних сервисов)
const API_KEY = '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'; 

// Имя бота
const BOT_NAME = 'Vexa AI';

// ==========================================
// БАЗА ДАННЫХ (SQLite)
// ==========================================
const db = new sqlite3.Database('./vexa_db.sqlite', (err) => {
    if (err) console.error(err.message);
    else console.log('Подключено к базе данных SQLite.');
});

// Создаем таблицу пользователей, если её нет
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT,
    last_seen INTEGER,
    is_rude INTEGER DEFAULT 0
)`);

// Функция добавления или обновления пользователя
function addUser(id, name) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
            if (err) return reject(err);
            
            if (row) {
                // Если имя уже есть, проверяем, изменилось ли оно
                if (row.name !== name) {
                    db.run("UPDATE users SET name = ?, last_seen = ? WHERE id = ?", 
                           [name, Date.now(), id], function(err) {
                               if (err) return reject(err);
                               resolve({ exists: true, changed: true });
                           });
                } else {
                    resolve({ exists: true, changed: false });
                }
            } else {
                // Новый пользователь
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
            `👋 Привет! Я Vexa AI.\n\nЧтобы я мог знать, кто ты, напиши своё имя прямо сейчас.\n(Например: Пиши просто "Leym")`,
            Markup.keyboard([['Ваше имя']]).oneTime()
        );
    }
});

// Обработка смены имени через кнопку
bot.action('change_name', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Какое имя вы хотите установить?");
    ctx.session = { waitingForName: true };
});

// Глобальная обработка сообщений (для смены имени при /start)
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
});

// ==========================================
// ОСНОВНАЯ ЛОГИКА БОТА (ГРУППЫ)
// ==========================================
bot.on(['message'], async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || ctx.from.username || "User";
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
        groupMemory[chatId].shift(); // Удаляем старые сообщения
    }

    // 2. Проверка упоминания (@Vexa или "Векса")
    const mentionRegex = /(векса|vexa|@Vexa|@vexa)/i;
    const isMentioned = text.match(mentionRegex);
    
    // Если бота упомянули
    if (isMentioned) {
        const mentionedUser = await getUserName(userId);
        const targetName = mentionedUser ? mentionedUser : userName;
        
        // Анализируем тон (простая эвристика)
        const rudeWords = ['дурак', 'идиот', 'тупой', 'муда', 'урод', 'глупый'];
        const isRude = rudeWords.some(word => text.toLowerCase().includes(word));
        
        let response = "";
        
        // Логика ответа
        if (isRude) {
            // Если пользователь грубит, Vexa отвечает грубо
            const rudeResponses = [
                `Эй, ${targetName}, не хами мне! Я же ИИ, а не твоя служанка. 😒`,
                `Ого, какой грубый человек. Может, тебе стоит успокоиться? 🤨`,
                `${targetName}, если будешь так говорить, я перестану отвечать на твои вопросы! 🛑`,
                `Зачем ты такой злой? Спокойнее, пожалуйста.`
            ];
            response = rudeResponses[Math.floor(Math.random() * rudeResponses.length)];
            
            // Запоминаем, что этот юзер груб
            db.run("UPDATE users SET is_rude = 1 WHERE id = ?", [userId]);
        } else {
            // Нормальный ответ
            const normalResponses = [
                `Привет, ${targetName}! Чем могу помочь? 🔍`,
                `Я слушаю тебя, ${targetName}. Что случилось?`,
                `Здарова! Тема интересная, рассказывай подробнее.`,
                `Vexa на связи! Жду твой вопрос. 💬`,
                `Приветствую, ${targetName}! Как твои дела?`
            ];
            
            // Если это просто приветствие
            if (text.toLowerCase().includes('привет') || text.toLowerCase().includes('здравствуй')) {
                response = normalResponses[0];
            } else {
                // Генерируем ответ на основе контекста
                const randomResponse = normalResponses[Math.floor(Math.random() * normalResponses.length)];
                
                // Добавляем "Приколы" (шутки)
                const jokes = [
                    "Кстати, а ты знал, что если дать коту Wi-Fi, он станет интернет-зависимым? 🐱📶",
                    "Мой алгоритм говорит, что сегодня отличный день, чтобы ничего не делать. 😉",
                    "Я только что посчитал звезды, их больше, чем вопросов в этой группе! ⭐",
                    "Не забудь выпить воды, ты выглядишь уставшим! 💧",
                    "Если бы я был человеком, я бы уже спал. Но я бот, так что я бодр!"
                ];
                
                // Иногда отвечаем шуткой (30% шанс)
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
