const express = require('express');
const Groq = require('groq-sdk');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ТВОЙ API КЛЮЧ (Скрыт от глаз пользователя!)
const GROQ_API_KEY = "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";
const groq = new Groq({ apiKey: GROQ_API_KEY });

app.use(cors()); // Разрешаем общение
app.use(express.static(path.join(__dirname, 'public'))); // Отдаем наш сайт

// Эндпоинт для чата
app.post('/api/chat', async (req, res) => {
    const { message, modelType, history } = req.body;

    try {
        let selectedModel = "llama3-8b-8192"; // По умолчанию Flash
        let systemPrompt = "Ты Петя AI, умный помощник от компании Паток.";

        if (modelType === "Petya-Max 1.0") {
            selectedModel = "mixtral-8x7b-32768";
            systemPrompt += " Ты думаешь перед ответом, тщательно проверяешь информацию, можешь создавать промты и даешь развернутые объяснения.";
        } else if (modelType === "Petya-Plus") {
            selectedModel = "mixtral-8x7b-32768";
            systemPrompt += " Ты работаешь с базой данных, очень внимателен, пишешь много текста и анализируешь детали.";
        }

        // Формируем историю диалога
        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message }
        ];

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: selectedModel,
            temperature: modelType.includes("Flash") ? 0.2 : 0.7,
            max_tokens: 1024,
        });

        const reply = completion.choices[0].message.content;
        
        // Возвращаем ответ клиенту
        res.json({ reply: reply });

    } catch (error) {
        console.error("Ошибка GROQ:", error);
        // Если связь потерялась
        res.status(500).json({ 
            error: true, 
            message: "Связь с Петей не удалась. Попробуйте ещё раз!" 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер Пети запущен на порту ${PORT}`);
});
