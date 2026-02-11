import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { File } from 'node:buffer';
import OpenAI from 'openai';
import { prisma } from './lib/prisma.js';
import chatRouter from './routes/chat.js'; // Убедись, что расширение .js или без него, в зависимости от твоего tsconfig
import transcribeRouter from './routes/transcribe.js'; // Если этот файл существует
import { bot, triggerAction } from './telegramBot.js'; 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
globalThis.File = File as any;

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001; 

// Увеличиваем лимиты для аудио-файлов
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Статика
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
app.use('/audio', express.static(path.resolve('audio')));

// Подключаем роуты
app.use('/chat', chatRouter);
app.use('/api', transcribeRouter); // Убедись, что transcribeRouter экспортирован корректно

// --- 🔥 API МАРШРУТЫ ---

// 1. Сохранение настроек (Обновлено: voice, mode, level, speakingStyle)
app.post('/api/settings', async (req, res) => {
    try {
        const { userId, voice, mode, level, speakingStyle } = req.body;
        
        // Используем update, так как юзер скорее всего уже создан при входе в бота
        // Если юзера нет, можно использовать upsert, но обычно он есть
        await prisma.user.update({
            where: { id: userId },
            data: { 
                voice: voice || undefined, 
                mode: mode || undefined,
                level: level || undefined,
                speakingStyle: speakingStyle || undefined // 🔥 Сохраняем стиль речи
            }
        });
        res.json({ success: true });
    } catch (e) {
        console.error("Settings update error:", e);
        res.status(500).json({ error: 'Update failed' });
    }
});

// 2. Отправка фидбека
app.post('/api/feedback', async (req, res) => {
    try {
        const { userId, text } = req.body;
        
        console.log(`📩 FEEDBACK from ${userId}: ${text}`);
        
        // Если хочешь получать в личку, раскомментируй и вставь свой ID (числом)
        // const ADMIN_ID = 123456789; 
        // await bot.sendMessage(ADMIN_ID, `📩 <b>Feedback</b> from ${userId}:\n\n${text}`, { parse_mode: 'HTML' });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Feedback failed' });
    }
});

// 3. Генерация темы (Topic)
app.post('/api/topic', async (req, res) => {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "Give me a short, engaging conversation topic for an English learner. Just the topic/question." }]
        });
        res.json({ topic: completion.choices[0].message.content });
    } catch (e) {
        res.status(500).json({ error: 'Topic failed' });
    }
});

// 4. Получение данных юзера (Обновлено: отдаем speakingStyle)
app.get('/api/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    // Дефолтные значения, если юзер не найден (или поля пусты)
    const userData = user || { 
        level: 'A1', 
        streakCount: 0, 
        voice: 'alloy', 
        mode: 'chill',
        speakingStyle: 'standard' 
    };

    // Считаем дни активности в этом году для календаря
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(`${currentYear}-01-01`);
    const history = await prisma.message.findMany({
        where: { userId: userId, role: 'user', createdAt: { gte: startOfYear } },
        select: { createdAt: true }
    });
    const uniqueDates = [...new Set(history.map(h => h.createdAt.toISOString().split('T')[0]))];

    res.json({
      level: userData.level || 'A1',
      streak: userData.streakCount || 0,
      voice: userData.voice,            // Тембр (Alloy, Echo...)
      mode: userData.mode,              // Режим (Chill, Grammar...)
      speakingStyle: userData.speakingStyle, // 🔥 Стиль (Teacher, Street...)
      dates: uniqueDates
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Роут для действий бота (триггер команд из WebApp)
app.post('/api/bot-action', async (req, res) => {
    try {
        const { userId, action } = req.body;
        await triggerAction(userId, action);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});