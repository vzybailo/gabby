import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { File } from 'node:buffer';
import OpenAI from 'openai';
import { prisma } from './lib/prisma.js';

// Импорт роутов
import chatRouter from './routes/chat';
import transcribeRouter from './routes/transcribe';
import { generateSpeech, assessLevel } from './services/ai'; 

// 🔥 Важно: Импортируем функцию triggerAction из бота
// (Убедись, что ты добавил "export" перед function triggerAction в telegramBot.ts)
import { triggerAction } from './telegramBot.js'; 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
globalThis.File = File as any;

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001; 

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// --- РАЗДАЧА WEB APP (ФРОНТЕНД) ---
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
app.use('/audio', express.static(path.resolve('audio')));

console.log(`📂 WebApp Serving from: ${publicPath}`);

// --- API МАРШРУТЫ ---
app.use('/chat', chatRouter);
app.use('/api', transcribeRouter);

// 🔥 ГЛАВНЫЙ ФИКС: API ДЛЯ КОМАНД ИЗ WEB APP
// Приложение шлет запрос сюда -> Сервер пинает Бота -> Бот пишет в чат
app.post('/api/bot-action', async (req, res) => {
    try {
        const { userId, action } = req.body;
        
        if (!userId || !action) {
            return res.status(400).json({ error: 'Missing userId or action' });
        }

        console.log(`⚡️ WebApp Action: ${action} for user ${userId}`);
        
        // Вызываем функцию бота напрямую
        await triggerAction(userId, action);
        
        res.json({ success: true });
    } catch (e) {
        console.error('Bot Action Error:', e);
        res.status(500).json({ error: 'Failed to trigger bot action' });
    }
});

// API: Оценка уровня
app.post('/api/assess-level', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const result = await assessLevel(text);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Assessment failed' });
  }
});

// API: Данные юзера для Web App
app.get('/api/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    const userData = user || { level: 'A1', streakCount: 0 };
    
    // Получаем историю за текущий год для календаря
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(`${currentYear}-01-01`);

    const history = await prisma.message.findMany({
        where: { 
            userId: userId, 
            role: 'user',
            createdAt: { gte: startOfYear }
        },
        select: { createdAt: true }
    });

    const uniqueDates = [...new Set(history.map(h => h.createdAt.toISOString().split('T')[0]))];

    res.json({
      level: userData.level || 'A1',
      streak: userData.streakCount || 0,
      dates: uniqueDates
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});