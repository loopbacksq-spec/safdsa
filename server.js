const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fetch = require('node-fetch');

// --- КОНФИГУРАЦИЯ (ТВОИ ДАННЫЕ) ---
const TELEGRAM_BOT_TOKEN = '8574222868:AAGb2KVbMSOqJbX5CUKWEIs70-7NidL0OnI';
const AI_API_KEY = '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'; // Твой API ключ
// Предполагаем, что это API похоже на OpenAI. Если структура другая, может потребоваться правка URL.
const AI_API_URL = 'https://api.openai.com/v1/chat/completions'; 

// --- ГЛОБАЛЬНАЯ ПАМЯТЬ (База данных в памяти) ---
// Структура: { chatId: { name: string, history: [messages], mood: 'neutral'|'angry' } }
const userDatabase = {}; 
// История всего чата для контекста группы
let globalChatHistory = []; 

// --- НАСТРОЙКА СЕРВЕРА И АВТО-ПИНГ ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Vexa AI is running and awake! 🚀');
});

// Авто-пинг каждые 5 минут, чтобы Render не заснул
setInterval(() => {
    try {
        fetch(`http://${process.env.RENDER_HOSTNAME || 'localhost'}:${PORT}/`).catch(err => console.log('Ping error:', err));
        console.log('[AUTO-PING] Сервер активен! Vexa жива.');
    } catch (e) {
        console.error('Ошибка пинга:', e);
    }
}, 5 * 60 * 1000); 

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// --- ЛОГИКА БОТА ---

// Обработка /start
bot.start((ctx) => {
    const userId = ctx.from.id;
    
    if (!userDatabase[userId]) {
        // Первое знакомство
        ctx.reply(
            'Привет! 👋 Я Vexa. \n\nЧтобы я могла знать, кто ты есть, напиши мне свое имя прямо сейчас.',
            Markup.keyboard([['Ваше имя']]).oneTime().resize()
        );
        // Ждем ответ с именем
        bot.on('text', (msg) => {
            if (msg.from.id === userId && msg.text !== '/start') {
                const name = msg.text.trim();
                if (name.length > 1) {
                    userDatabase[userId] = {
                        name: name,
                        history: [],
                        mood: 'neutral',
                        lastInteraction: Date.now()
                    };
                    ctx.reply(`Отлично, ${name}! Я запомнила тебя. Теперь мы можем общаться freely. 😊\n\nНапомню: в группах пиши "Векса" или "Vexa", чтобы я откликнулась.`);
                    
                    // Удаляем клавиатуру после ответа
                    bot.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.message.message_id, null);
                } else {
                    ctx.reply('Пожалуйста, напиши нормальное имя, а не одно слово.');
                }
            }
        });
    } else {
        // Повторный старт
        const userData = userDatabase[userId];
        let replyText = `Привет снова, ${userData.name}! 👋\n\nТы уже в моей базе.\n\nХочешь изменить имя? Напиши новое имя, и я обновлю данные.`;
        
        ctx.reply(replyText, Markup.keyboard([['Изменить имя']]).oneTime().resize());
        
        bot.on('text', (msg) => {
            if (msg.from.id === userId && msg.text !== '/start') {
                const newName = msg.text.trim();
                if (newName.length > 1) {
                    userDatabase[userId].name = newName;
                    ctx.reply(`Готово! Теперь я буду называть тебя ${newName}. 😎`);
                    bot.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.message.message_id, null);
                } else {
                    ctx.reply('Имя должно быть длиннее. Попробуй еще раз.');
                }
            }
        });
    }
});

// Функция генерации ответа через API
async function generateAIResponse(userMessage, context, userName) {
    try {
        // Формируем промпт для ИИ, учитывая личность Vexa
        const systemPrompt = `Ты Vexa AI, умный помощник из Telegram. 
        Твой характер: нейтральный, но если пользователь грубит, ты можешь ответить грубо или саркастично, но стараешься мириться.
        Ты умеешь шутить, делать приколы, но избегай шаблонных фраз типа "мой дорогой". Пиши живо, коротко, как живой человек.
        Пользователь зовут: ${userName || 'неизвестный'}.
        Контекст чата: ${context.slice(-5).join(' ')}`; // Берем последние 5 сообщений для контекста

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
        ];

        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo", // Или другая модель, поддерживаемая твоим API
                messages: messages,
                temperature: 0.9, // Высокая креативность
                max_tokens: 150
            })
        });

        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content;
        } else {
            return "Хм, я немного задумалась над твоим вопросом... Давай попробуем еще раз!";
        }
    } catch (error) {
        console.error("Ошибка API:", error);
        return "Ой, кажется, мой мозг перегрелся при обработке запроса. Попробуй позже! 😅";
    }
};

// Обработка всех сообщений в группе
bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const fromId = ctx.from.id;
    const text = ctx.message.text || '';
    const timestamp = Date.now();

    // Добавляем сообщение в глобальную историю (для контекста)
    if (globalChatHistory.length > 20) globalChatHistory.shift(); // Храним только последние 20
    globalChatHistory.push({ sender: ctx.from.username || fromId, text: text, time: timestamp });

    // Проверяем упоминание
    const mentionPattern = /\b(vexa|векса)\b/i;
    const isMentioned = mentionPattern.test(text);

    if (isMentioned) {
        // Проверяем, знаем ли мы пользователя
        let userName = userDatabase[fromId]?.name;
        
        // Если имя неизвестно в ЛС, но пользователь написал в группу
        if (!userName) {
            // Отправляем уведомление только один раз на одно упоминание (чтобы не спамить)
            // Используем простой флаг в истории, но для простоты просто проверим, писал ли он уже об этом
            // В данном коде просто дадим инструкцию, если имени нет
            
            // Проверка: не писал ли он уже об этом недавно (простая защита от спама)
            const recentMsg = globalChatHistory.filter(m => m.sender === fromId && Date.now() - m.time < 60000);
            const alreadyAsked = recentMsg.some(m => m.text.includes('/start'));

            if (!alreadyAsked) {
                ctx.reply(
                    `Привет! 👋 Но я пока не знаю твоего имени. \n\nЧтобы я могла отвечать тебе в группах и помнить наши разговоры, зайди в мои личные сообщения (ЛС) и напиши команду /start. Там я попрошу тебя ввести имя. После этого я смогу обращаться к тебе по имени! 😉`,
                    Markup.inlineKeyboard([[Markup.button.callback('Перейти в ЛС', 'go_to_start')]])
                );
            }
            return; // Прерываем выполнение, если имени нет
        }

        // Если имя есть, генерируем ответ
        // Создаем контекст из последних сообщений
        const context = globalChatHistory.map(m => `${m.sender}: ${m.text}`).join('\n');

        // Генерируем ответ
        const aiResponse = await generateAIResponse(text, globalChatHistory, userName);

        // Форматируем ответ (можно добавить имя пользователя для персонализации)
        const finalResponse = `${userName}, вот что я думаю:\n${aiResponse}`;

        // Отправка ответа
        ctx.reply(finalResponse);
    }
});

// Обработка callback кнопки (переход в ЛС)
bot.action('go_to_start', async (ctx) => {
    await ctx.answerCbQuery('Переходи в ЛС и пиши /start!');
    // Телеграм не позволяет отправить прямую ссылку на диалог программно без кнопки "Send Message",
    // поэтому мы просто напоминаем пользователю.
    ctx.reply('Не забудь нажать /start в моих личных сообщениях!');
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    bot.launch();
    console.log('Vexa AI launched successfully! 🤖');
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
