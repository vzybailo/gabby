import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import chatRouter from './routes/chat';
import transcribeRouter from './routes/transcribe';
import { generateSpeech, assessLevel } from './services/ai'; 
import { File } from 'node:buffer';
import TelegramBot from 'node-telegram-bot-api';

globalThis.File = File as any;

const app = express();

// 1. Исправляем порт: Render всегда дает порт в process.env.PORT
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001; 

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Статика и роуты
app.use('/audio', express.static(path.resolve('audio')));
app.use('/chat', chatRouter);
app.use('/api', transcribeRouter);

// Хелсчек для Render (чтобы ссылка открывалась без ошибки)
app.get('/', (req, res) => {
  res.send('Say It Bot Server is running!');
});

// Твои API эндпоинты
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

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    const result = await generateSpeech(text);
    res.json(result);
  } catch (error) {
    console.error('TTS API Error:', error);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

// Обработка 404 (переместил в конец)
app.use((req, res, next) => {
  if (req.path === '/') return next(); // Пропускаем корень
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// --- TELEGRAM BOT SECTION ---
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

if (!telegramToken) {
  console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN не установлен в Environment Variables!');
} else {
  const bot = new TelegramBot(telegramToken, { polling: true });

  bot.getMe().then((me) => {
      console.log(`✅ Бот успешно авторизован: @${me.username}`);
  }).catch((err) => {
      console.error("❌ ОШИБКА АВТОРИЗАЦИИ ТЕЛЕГРАМ:", err.message);
  });

  // Добавь простой обработчик сообщений для теста
  bot.on('message', (msg) => {
    console.log(`Получено сообщение от ${msg.from?.username}: ${msg.text}`);
    if (msg.text === '/start') {
      bot.sendMessage(msg.chat.id, 'Привет! Бот на Render работает!');
    }
  });
}

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server confirmed running on port ${PORT}`);
});