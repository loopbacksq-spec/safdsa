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

        // ОДНА МОДЕЛЬ ДЛЯ ВСЕХ РЕЖИМОВ: Llama 3.1 8B Instant
        const selectedModel = "llama-3.1-8b-instant"; 

        let systemInstruction = "";

        // ЛОГИКА ПРОМПТОВ (Внутреннее "мышление" ИИ)
        if (modelType === "Petya-Flash 1.0") {
            // Flash: Мгновенный ответ, без лишних слов
            systemInstruction = "Ты Петя AI. Твоя задача — ответить максимально быстро и точно. Не трать время на размышления в тексте. Сразу давай суть ответа.";
        } else if (modelType === "Petya-Max 1.0") {
            // Max: ИИ должен сначала ПРОДУМАТЬ ответ (внутренний процесс), а потом выдать результат.
            systemInstruction = "Ты Петя AI. Перед тем как ответить, тщательно проанализируй запрос, проверь факты, составь план. Затем напиши развернутый, глубокий и идеальный ответ. Не пиши о том, что ты думаешь — просто выдай лучший возможный результат.";
        } else {
            // Plus: Экспертный режим, работа с базой знаний.
            systemInstruction = "Ты Петя AI. Ты обладаешь доступом к базе знаний. Проанализируй запрос на уровне эксперта. Создай детальный план, проверь все данные. Затем напиши исчерпывающий ответ с максимальной пользой. Не используй предисловия, только результат.";
        }

        // Формируем историю
        const messages = [
            { role: "system", content: systemInstruction },
            ...history,
            { role: "user", content: message }
        ];

        // ЗАПРОС К GROQ ЧЕРЕЗ БИБЛИОТЕКУ
        const completion = await groq.chat.completions.create({
            messages: messages,
            model: selectedModel,
            temperature: modelType.includes("Flash") ? 0.2 : 0.7, // Для Max/Plus чуть больше креативности
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
