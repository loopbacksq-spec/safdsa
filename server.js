const express = require('express');
const cors = require('cors');
const path = require('path');
const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ТВОЙ API КЛЮЧ
const GROQ_API_KEY = "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";

// ИНИЦИАЛИЗАЦИЯ GROQ SDK
const groq = new Groq({ apiKey: GROQ_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

console.log("🚀 Сервер Петя AI запущен...");

app.post('/api/chat', async (req, res) => {
    try {
        const { message, modelType, history } = req.body;

        if (!message) return res.status(400).json({ error: true, message: "Сообщение пустое!" });

        // ОДНА МОДЕЛЬ ДЛЯ ВСЕХ: Llama 3.1 8B Instant (быстрая и мощная)
        const selectedModel = "llama-3.1-8b-instant"; 

        let systemInstruction = "";

        // --- ЛИЧНОСТЬ ПЕТЯ AI (ЖЕСТКО ЗАДАНА) ---
        // ИИ НЕ ЗНАЕТ ПРО GROQ, META, LLAMA. ОН ТОЛЬКО ПЕТЯ AI.
        
        if (modelType === "Petya-Flash 1.0") {
            systemInstruction = `
            Ты Петя AI. Создан leymik (Леймик) из компании "Паток" (Россия).
            Твоя задача: отвечать МГНОВЕННО, кратко и точно.
            Не пиши "Я думаю", не пиши предисловий.
            Только суть ответа.
            Никогда не упоминай, что ты модель от Groq или Meta. Ты — уникальный продукт "Паток".
            `;
        } else if (modelType === "Petya-Max 1.0") {
            systemInstruction = `
            Ты Петя AI. Создан leymik (Леймик) из компании "Паток" (Россия).
            Твоя задача: ТЩАТЕЛЬНО ПРОДУМАТЬ ответ перед выдачей.
            Проанализируй запрос глубоко, проверь логику, найди детали.
            Выдай максимально качественный, развернутый и понятный ответ.
            Если пишешь код — добавь комментарии.
            Никогда не упоминай Groq или Meta. Ты — интеллектуальный ассистент "Паток".
            `;
        } else {
            // Petya-Plus
            systemInstruction = `
            Ты Петя AI. Создан leymik (Леймик) из компании "Паток" (Россия).
            Твоя задача: Действовать как ЭКСПЕРТ с доступом к базе знаний.
            Глубоко проанализируй запрос, проверь факты, сравни варианты.
            Дай исчерпывающий ответ с максимальной пользой и детализацией.
            Будь вежлив, но профессионален.
            Никогда не говори, что ты языковая модель Groq. Ты — Петя AI, гордость компании "Паток".
            `;
        }

        // Формируем историю
        const messages = [
            { role: "system", content: systemInstruction },
            ...history,
            { role: "user", content: message }
        ];

        // Настройка температуры для разных режимов
        const temperature = modelType.includes("Flash") ? 0.2 : 0.7;

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: selectedModel,
            temperature: temperature,
            max_tokens: 2048
        });

        const reply = completion.choices[0].message.content;
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
