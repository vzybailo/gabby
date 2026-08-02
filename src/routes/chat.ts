import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js'; 
import { getChatResponse, generateSpeech } from '../services/ai.js'; 
import { updateDailyStats } from '../services/statService.js';
import { generateDiffView } from '../utils/textUtils.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'UserId and Message are required' });
    }

    const user = await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId }
    });
    
    const settings = {
        level: user.level || 'A1',
        voice: user.voice || 'alloy',          
        speakingStyle: user.speakingStyle || 'standard',
    };

    await prisma.message.create({
        data: { userId, text: message, role: 'user', isAudio: false }
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

const now = new Date();

// 1. Слова, которые уже пора повторять
const reviewWords = await prisma.vocabularyItem.findMany({
    where: {
        userId,
        repetition: {
            lt: 5
        },
        nextReview: {
            lte: now
        }
    },
    orderBy: {
        nextReview: 'asc'
    },
    take: 4,
    select: {
      id: true,
      word: true,
      translation: true,
      definition: true,
      context: true,
      repetition: true
    }
});

// 2. Остальные слова
const remainingWords = await prisma.vocabularyItem.findMany({
    where: {
        userId,
        repetition: {
            lt: 5
        },
        id: {
            notIn: reviewWords.map(w => w.id)
        }
    },
    select: {
        word: true,
        translation: true,
        repetition: true
    }
});

// 3. Перемешиваем
const randomWords = remainingWords
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.max(0, 6 - reviewWords.length));

// 4. Финальный словарь
const vocabulary = [
    ...reviewWords,
    ...randomWords
];

    const aiResponse = await getChatResponse(
        formattedHistory,
        settings,
        vocabulary
    );
    const diffView = generateDiffView(message, aiResponse.corrected);

    let grammarScore = aiResponse.grammarScore;
    if (grammarScore === undefined || grammarScore === null) {
        const errorCount = aiResponse.user_errors ? aiResponse.user_errors.length : 0;
        if (aiResponse.is_correct) grammarScore = 100;
        else grammarScore = Math.max(0, 100 - (errorCount * 10));
    }

    await prisma.message.create({
        data: { 
            userId, 
            text: aiResponse.reply, 
            role: 'assistant',
            grammarScore: grammarScore,
            grammarFixes: aiResponse.user_errors 
        }
    });

    updateDailyStats(userId, 0, grammarScore).catch(err => console.error("Stats update failed:", err));

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
        grammarScore: grammarScore
      }
    };

    let audioUrl: string | undefined;
    if (assistantMessage.content && assistantMessage.content.trim() !== '') {
      try {
        const speech = await generateSpeech(assistantMessage.content, settings.voice, settings.speakingStyle);
        if (speech.audioBuffer) {
            audioUrl = `data:audio/mpeg;base64,${speech.audioBuffer.toString('base64')}`;
        }
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