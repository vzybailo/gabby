import { Router } from 'express';
import crypto from 'crypto';
import * as Diff from 'diff';
import { getAIResponse, generateSpeech } from '../services/ai';

const router = Router();

function generateDiffView(original: string, corrected: string): string {
  if (!original || !corrected || original.trim() === corrected.trim()) {
    return corrected;
  }

  const diff = Diff.diffWords(original, corrected);
  let result = '';

  diff.forEach((part) => {
    const val = part.value.trim();
    
    if (!val) return; 

    if (part.removed) {
      result += `~${val}~ `; 
    } else if (part.added) {
      result += `*${val}* `; 
    } else {
      result += `${val} `;
    }
  });

  return result
    .replace(/\s+/g, ' ') 
    .replace(/ \./g, '.')
    .replace(/ ,/g, ',')
    .replace(/ \?/g, '?')
    .replace(/ !/g, '!')
    .replace(/ '/g, "'")
    .trim();
}

router.post('/', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages are required' });
  }

  try {
    const lastUserMsg = messages
      .slice().reverse().find((m: any) => m.role === 'user');
    
    const originalText = lastUserMsg ? lastUserMsg.content : '';
    const aiResponse = await getAIResponse(messages);
    const diffView = generateDiffView(originalText, aiResponse.corrected);

    const message = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: aiResponse.reply,
      analysis: {
        is_perfect: aiResponse.is_correct,
        corrected_text: aiResponse.corrected,
        diff_view: diffView,
        user_errors: aiResponse.user_errors,
        better_alternatives: aiResponse.better_alternatives,
      }
    };

    let audioUrl: string | undefined;
    if (message.content && message.content.trim() !== '') {
      try {
        const speech = await generateSpeech(message.content);
        audioUrl = speech.audioUrl;
      } catch (err) {
        console.error('TTS generation failed:', err);
      }
    }

    return res.json({
      message,
      audioUrl,
    });

  } catch (err) {
    console.error('AI ERROR:', err);
    return res.status(500).json({ error: 'AI error' });
  }
});

export default router;