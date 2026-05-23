const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

// --- НАСТРОЙКИ ---
const TOKEN = '8117150241:AAHbY2YbuttsWB1tDaBDtKnSkV0WXPKL9Nw';
const API_KEY_GROQ = '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';
const MODEL = 'llama-3.1-8b-instant'; // Быстрая модель для анализа
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.use(bodyParser.json());

console.log("⚖️ ЗАПУСК AI АДВОКАТА (FEMIDA)...");

// --- ПРОМПТ ДЛЯ АДВОКАТА ---
const LAWYER_PROMPT = `
Ты — профессиональный, беспристрастный AI-Адвокат и арбитр. Твоя задача — объективно разобрать ситуацию, которую опишет пользователь.

ТВОИ ПРАВИЛА:
1. НЕ шути. Будь серьезным, сухим и профессиональным.
2. НЕ занимай чью-то сторону заранее. Анализируй факты.
3. Если информации мало, укажи на это.
4. Твой ответ должен быть строго структурирован.

СТРУКТУРА ОТВЕТА (ОБЯЗАТЕЛЬНО СОБЛЮДАЙ):
1. 📋 **СУТЬ ДЕЛА:** Краткое резюме ситуации (1-2 предложения).
2. ⚖️ **ВЕРДИКТ:** Кто прав, кто виноват, или есть обоюдная вина.
3. 🧠 **АРГУМЕНТЫ:**
   - За сторону А: ...
   - За сторону Б: ...
4. 💡 **А ЧТО ЕСЛИ:** Приведи один контраргумент или альтернативный взгляд ("А вот если бы было так...").

ВАЖНО:
- Используй Markdown форматирование (**жирный**, *курсив*).
- Используй эмодзи для навигации.
- Твой ответ должен быть ПОЛНЫМ, но УКЛАДЫВАТЬСЯ в лимит Telegram (менее 4000 символов). Если мысль сложная, сокращай воду, оставляя суть.
- Пиши на русском языке.

СИТУАЦИЯ ПОЛЬЗОВАТЕЛЯ:
{user_input}
`;

// --- ФУНКЦИЯ АНАЛИЗА ---
async function analyzeCase(userText) {
    const prompt = LAWYER_PROMPT.replace('{user_input}', userText);

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3, // Низкая температура для точности и логики
                max_tokens: 1000
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY_GROQ}`,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            }
        );

        let text = response.data.choices[0].message.content.trim();
        
        // Проверка на длину (Telegram limit 4096)
        if (text.length > 4000) {
            text = text.substring(0, 3990) + "\n\n... (сообщение обрезано из-за длины)";
        }

        return text;

    } catch (error) {
        console.error("Ошибка API:", error.message);
        return "❌ Произошла ошибка при анализе дела. Попробуйте позже.";
    }
}

// --- ОБРАБОТЧИК СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // Игнорируем команды, если они не нужны, но можно добавить /start
    if (text.startsWith('/')) {
        if (text === '/start') {
            await bot.sendMessage(chatId, 
                "⚖️ **AI АДВОКАТ**\n\n" +
                "Опишите вашу ситуацию максимально подробно.\n" +
                "Я объективно разберу аргументы, скажу, кто прав, и предложу альтернативный взгляд.\n\n" +
                "*Просто напишите текст ситуации.*", 
                { parse_mode: 'Markdown' }
            );
        }
        return;
    }

    // Отправляем статус "печатает"
    bot.sendChatAction(chatId, 'typing');

    // Получаем анализ
    const verdict = await analyzeCase(text);

    // Отправляем результат
    await bot.sendMessage(chatId, verdict, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    });
});

// --- ЗАЩИТА ОТ СНА (RENDER/WEB) ---
app.get('/', (req, res) => {
    res.send('⚖️ AI Lawyer Femida is online.');
});

app.get('/health', (req, res) => {
    res.json({ status: 'alive' });
});

// Авто-пингер
setInterval(() => {
    axios.get(`http://localhost:${PORT}/health`).catch(() => {});
}, 300000); // Каждые 5 минут

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});
