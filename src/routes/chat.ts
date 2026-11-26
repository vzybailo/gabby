import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js'; 
import { getChatResponse, generateSpeech } from '../services/ai.js'; 
import { updateDailyStats } from '../services/statService.js';
import { generateDiffView } from '../utils/textUtils.js';
import { pickVocabularyForChat, creditWordsUsedInMessage } from '../services/vocabularyService.js';
import { maybeUpdateLearnerProfile } from '../services/learnerProfileService.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    // userId берём только из проверенного initData, а не из тела запроса
    const userId = req.userId!;
    const message = String(req.body.message || '').slice(0, 2000);

    if (!message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
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
        learnerProfile: user.learnerProfile || null,
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

    const vocabulary = await pickVocabularyForChat(userId);

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

    const usedWords = await creditWordsUsedInMessage(userId, message, aiResponse.user_errors)
        .catch(err => { console.error('Vocab credit failed:', err); return [] as string[]; });

    void maybeUpdateLearnerProfile(userId);

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
        grammarScore: grammarScore,
        praise: aiResponse.praise,
        used_vocabulary: usedWords,
        new_vocabulary: aiResponse.new_vocabulary
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