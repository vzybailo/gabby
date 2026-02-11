import { Router } from 'express';
import crypto from 'crypto';
import * as Diff from 'diff';
import { prisma } from '../lib/prisma.js'; 
import { getChatResponse, generateSpeech } from '../services/ai.js'; 

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
  try {
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'UserId and Message are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    const settings = {
        mode: user?.mode || 'chill',
        level: user?.level || 'A1',
        voice: user?.voice || 'alloy',          
        speakingStyle: user?.speakingStyle || 'standard' 
    };

    await prisma.message.create({
        data: { userId, text: message, role: 'user' }
    });

    const history = await prisma.message.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    
    const formattedHistory = history.reverse().map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.text
    }));

    const aiResponse = await getChatResponse(formattedHistory, settings);
    const diffView = generateDiffView(message, aiResponse.corrected);

    const assistantMessage = {
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

    await prisma.message.create({
        data: { userId, text: aiResponse.reply, role: 'assistant' }
    });

    let audioUrl: string | undefined;
    if (assistantMessage.content && assistantMessage.content.trim() !== '') {
      try {
        const speech = await generateSpeech(assistantMessage.content, settings.voice, settings.speakingStyle);
        audioUrl = speech.audioUrl;
      } catch (err) {
        console.error('TTS generation failed:', err);
      }
    }

    return res.json({
      message: assistantMessage,
      audioUrl,
    });

  } catch (err) {
    console.error('AI ERROR:', err);
    return res.status(500).json({ error: 'AI processing error' });
  }
});

export default router;