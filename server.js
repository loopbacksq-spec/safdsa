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

console.log("🚀 Сервер запущен...");

app.post('/api/chat', async (req, res) => {
    try {
        const { message, modelType, history } = req.body;

        if (!message) return res.status(400).json({ error: true, message: "Пустое сообщение" });

        let selectedModel = "llama3-8b-8192";
        let systemPrompt = "Ты Петя AI от компании Паток. Ты быстрый и умный.";

        // Логика моделей
        if (modelType === "Petya-Max 1.0") {
            selectedModel = "mixtral-8x7b-32768";
            systemPrompt += " Ты думаешь перед ответом, тщательно проверяешь информацию и даешь развернутые объяснения.";
        } else if (modelType === "Petya-Plus") {
            selectedModel = "mixtral-8x7b-32768";
            systemPrompt += " Ты работаешь с базой данных, внимателен к деталям и пишешь много текста.";
        } else {
            // Flash
            systemPrompt += " Ты отвечаешь максимально быстро и кратко.";
        }

        // Формируем историю
        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message }
        ];

        // ЗАПРОС К GROQ ЧЕРЕЗ FETCH (Без библиотек!)
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
                max_tokens: 1024
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            console.error("Ошибка GROQ:", errData);
            throw new Error("Ошибка связи с Groq");
        }

        const data = await response.json();
        const reply = data.choices[0].message.content;

        res.json({ reply: reply });

    } catch (error) {
        console.error("❌ Ошибка на сервере:", error.message);
        res.status(500).json({ 
            error: true, 
            message: "Связь с Петей не удалась. Попробуйте ещё раз!" 
        });
    }
});

app.listen(PORT, () => {
    console.log(`✅ ПЕТЯ AI работает на порту ${PORT}`);
});
