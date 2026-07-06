import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';

const router = express.Router();

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } 
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received' });
    }

    console.log(`🎤 Transcribing in-memory audio buffer...`);

    const audioFile = await OpenAI.toFile(
      req.file.buffer, 
      'voice.ogg', 
      { type: 'audio/ogg' }
    );

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      prompt: "Hello! This is a casual conversation in English. Please transcribe carefully."
    });

    console.log('✅ Transcription result:', transcription.text);
    res.json({ text: transcription.text });

  } catch (err: any) {
    console.error('❌ Transcription Error:', err);
    res.status(500).json({ error: 'Failed to transcribe', details: err.message });
  }
});

export default router;