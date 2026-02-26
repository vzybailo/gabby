import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const router = express.Router();

const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } 
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// @ts-ignore
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  let tempPath = '';
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received' });
    }

    const originalPath = req.file.path;
    tempPath = path.join(path.dirname(originalPath), `${req.file.filename}.ogg`);
    
    fs.renameSync(originalPath, tempPath);

    console.log(`🎤 Transcribing file: ${tempPath}`);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      prompt: "Hello! This is a casual conversation in English. Please transcribe carefully."
    });

    console.log('✅ Transcription result:', transcription.text);
    res.json({ text: transcription.text });

  } catch (err: any) {
    console.error('❌ Transcription Error:', err);
    res.status(500).json({ error: 'Failed to transcribe', details: err.message });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {
        console.error('Failed to delete temp file:', e);
      }
    }
  }
});

export default router;