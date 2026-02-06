import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import chatRouter from './routes/chat';
import transcribeRouter from './routes/transcribe';
import { generateSpeech, assessLevel } from './services/ai'; 
import { File } from 'node:buffer';
import './telegramBot'; 
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

globalThis.File = File as any;

const app = express();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001; 

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use('/audio', express.static(path.resolve('audio')));
app.use('/chat', chatRouter);
app.use('/api', transcribeRouter);

app.get('/', (req, res) => {
  res.send('Say It Bot Server is running and Bot is Active!');
});

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

app.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLang = 'Russian' } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        { 
          role: "system", 
          content: `You are a translator. Translate the following text to ${targetLang}. Keep the formatting (bold, italics) if possible. Be natural.` 
        },
        { role: "user", content: text }
      ],
      temperature: 0.3,
    });

    const translation = completion.choices[0]?.message?.content || "";
    
    res.json({ translation });
  } catch (error) {
    console.error('Translation Error:', error);
    res.status(500).json({ error: 'Translation failed' });
  }
});

app.use((req, res, next) => {
  if (req.path === '/') return next(); 
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server confirmed running on port ${PORT}`);
});