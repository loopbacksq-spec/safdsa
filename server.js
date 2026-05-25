const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ТВОЙ API КЛЮЧ
const GROQ_API_KEY = "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";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

console.log("🚀 Сервер Петя AI запущен...");

app.post('/api/chat', async (req, res) => {
    try {
        const { message, modelType, history } = req.body;

        if (!message) return res.status(400).json({ error: true, message: "Сообщение пустое!" });

        let selectedModel = "";
        let systemPrompt = "";

        // ЛОГИКА МОДЕЛЕЙ (ИСПРАВЛЕНО)
        if (modelType === "Petya-Flash 1.0") {
            // FLASH: Самая быстрая модель Llama 3
            selectedModel = "llama3-8b-8192"; 
            systemPrompt = "Ты Петя AI. Ты отвечаешь максимально быстро, кратко и по делу. Не пиши 'Я думаю', не пиши 'Конечно'. Только суть ответа.";
        } else {
            // MAX и PLUS: Одна мощная модель Mixtral, но с разными инструкциями
            selectedModel = "mixtral-8x7b-32768"; 
            
            if (modelType === "Petya-Max 1.0") {
                // МАКС: Глубокая логика, но без слов "я думаю"
                systemPrompt = "Ты Петя AI. Твоя задача — тщательно проанализировать запрос, найти решение и дать самый точный, развернутый ответ. Не используй фразы типа 'Я думаю' или 'Давайте посмотрим'. Просто дай идеальный ответ.";
            } else {
                // ПЛЮС: Работа с базой данных, максимальная детализация
                systemPrompt = "Ты Петя AI. Ты обладаешь доступом к базе знаний. Проанализируй запрос глубоко, проверь факты и предоставь исчерпывающий ответ с деталями. Не используй предисловия. Сразу давай результат.";
            }
        }

        // Формируем историю диалога
        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message }
        ];

        // ЗАПРОС К GROQ
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: messages,
                temperature: modelType.includes("Flash") ? 0.2 : 0.7,
                max_tokens: 2048 // Увеличили лимит для длинных ответов
            })
        });

        if (!response.ok) throw new Error("Ошибка сети Groq");

        const data = await response.json();
        const reply = data.choices[0].message.content;

        res.json({ reply: reply });

    } catch (error) {
        console.error("❌ Ошибка сервера:", error.message);
        res.status(500).json({ 
            error: true, 
            message: "Связь с Петей не удалась. Попробуйте ещё раз!" 
        });
    }
});

app.listen(PORT, () => {
    console.log(`✅ ПЕТЯ AI работает на порту ${PORT}`);
});
