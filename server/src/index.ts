import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import chatRouter from './routes/chat';
import transcribeRouter from './routes/transcribe';
import { generateSpeech, assessLevel } from './services/ai'; 
import { File } from 'node:buffer';

globalThis.File = File as any;

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10); // Render сам подставит нужное число в process.env.PORT

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.json());
app.use('/audio', express.static(path.resolve('audio')));
app.use('/chat', chatRouter);
app.use('/api', transcribeRouter);

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
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const result = await generateSpeech(text);
    
    res.json(result);
  } catch (error) {
    console.error('TTS API Error:', error);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

app.use((err: any, req: any, res: any, next: any) => {
  console.error('Server Internal Error:', err);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});