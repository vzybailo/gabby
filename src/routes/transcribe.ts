import express from 'express';
import multer from 'multer';
import { requireTelegramAuth } from '../middleware/telegramAuth.js';
import { aiLimiter, aiDailyLimiter } from '../middleware/rateLimit.js';
import { checkAudioLimit } from '../services/billingService.js';
import { transcribeAudio } from '../services/aiTools.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post('/transcribe', requireTelegramAuth, aiLimiter, aiDailyLimiter, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received' });
    }

    // Тот же дневной лимит голосовых, что и в боте
    const limit = await checkAudioLimit(req.userId!);
    if (!limit.allowed) {
      return res.status(402).json({ error: 'Audio limit reached', reason: limit.reason });
    }

    const text = await transcribeAudio(req.file.buffer);
    res.json({ text });
  } catch (err: any) {
    console.error('❌ Transcription Error:', err);
    res.status(500).json({ error: 'Failed to transcribe' });
  }
});

export default router;
