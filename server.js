const express = require('express');
const Groq = require('groq-sdk');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ТВОЙ API КЛЮЧ (Скрыт!)
const GROQ_API_KEY = "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";

// Инициализация Groq
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Middleware
app.use(cors()); // Разрешаем запросы с любого домена (для теста)
app.use(express.json()); // Чтобы сервер понимал JSON
app.use(express.static(path.join(__dirname, 'public'))); // Отдаем наш index.html

console.log("🚀 Сервер Пети AI запускается...");

// Эндпоинт чата
app.post('/api/chat', async (req, res) => {
    try {
        const { message, modelType, history } = req.body;

        if (!message) {
            return res.status(400).json({ error: true, message: "Сообщение пустое!" });
        }

        let selectedModel = "llama3-8b-8192";
        let systemPrompt = "Ты Петя AI, умный помощник от компании Паток. Ты быстрый, точный и вежливый.";

        // Логика выбора модели
        if (modelType === "Petya-Max 1.0" || modelType === "Petya-Plus") {
            selectedModel = "mixtral-8x7b-32768";
            if (modelType === "Petya-Plus") {
                systemPrompt += " Ты работаешь с базой данных, очень внимателен к деталям, анализируешь контекст и пишешь развернутые ответы.";
            } else {
                systemPrompt += " Ты думаешь перед ответом, тщательно проверяешь информацию и даешь подробные объяснения.";
            }
        } else {
            // Petya-Flash 1.0
            systemPrompt += " Ты отвечаешь максимально быстро и кратко, без лишних слов.";
        }

        // Формируем массив сообщений
        const messages = [
            { role: "system", content: systemPrompt },
            ...history, // История диалога
            { role: "user", content: message }
        ];

        console.log(`Запрос отправлен моделью: ${selectedModel}`);

        // Запрос к GROQ
        const completion = await groq.chat.completions.create({
            messages: messages,
            model: selectedModel,
            temperature: modelType.includes("Flash") ? 0.2 : 0.7,
            max_tokens: 1024,
            stream: false // Не используем стриминг для простоты
        });

        const reply = completion.choices[0].message.content;

        // Возвращаем ответ
        res.json({ reply: reply });

    } catch (error) {
        console.error("❌ Ошибка на сервере:", error.message);
        
        // Если ошибка сети или ключа
        if (error.response) {
            console.error("Ответ от GROQ:", error.response.data);
        }

        // Отправляем пользователю твою фразу об ошибке
        res.status(500).json({ 
            error: true, 
            message: "Связь с Петей не удалась. Попробуйте ещё раз!" 
        });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`✅ ПЕТЯ AI работает на порту ${PORT}`);
    console.log(`🔗 Доступно по адресу: http://localhost:${PORT}`);
});
