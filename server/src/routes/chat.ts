import { Router } from 'express';
import crypto from 'crypto';
import * as Diff from 'diff';
import { prisma } from '../lib/prisma.js'; 
import { getChatResponse, generateSpeech } from '../services/ai.js'; // 🔥 Используем getChatResponse

const router = Router();

// --- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ DIFF ---
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

// --- ОСНОВНОЙ РОУТ ---
router.post('/', async (req, res) => {
  try {
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'UserId and Message are required' });
    }

    // 1. Получаем пользователя
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    // 🔥 ОБНОВЛЕНО: Формируем настройки с учетом нового поля speakingStyle
    const settings = {
        mode: user?.mode || 'chill',
        level: user?.level || 'A1',
        voice: user?.voice || 'alloy',             // Тембр (кто говорит)
        speakingStyle: user?.speakingStyle || 'standard' // Стиль (как говорит)
    };

    // 2. Сохраняем сообщение пользователя
    await prisma.message.create({
        data: { userId, text: message, role: 'user' }
    });

    // 3. История переписки
    const history = await prisma.message.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    
    const formattedHistory = history.reverse().map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.text
    }));

    // 4. 🔥 ЗАПРОС К AI (getChatResponse вместо getAIResponse)
    const aiResponse = await getChatResponse(formattedHistory, settings);

    // 5. Генерируем Diff
    const diffView = generateDiffView(message, aiResponse.corrected);

    // 6. Формируем ответ
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

    // 7. Сохраняем ответ бота
    await prisma.message.create({
        data: { userId, text: aiResponse.reply, role: 'assistant' }
    });

    // 8. 🔥 ГЕНЕРАЦИЯ РЕЧИ (Передаем Голос И Стиль)
    let audioUrl: string | undefined;
    if (assistantMessage.content && assistantMessage.content.trim() !== '') {
      try {
        // Теперь передаем 2 параметра: голос и стиль
        const speech = await generateSpeech(assistantMessage.content, settings.voice, settings.speakingStyle);
        audioUrl = speech.audioUrl;
      } catch (err) {
        console.error('TTS generation failed:', err);
      }
    }

    // 9. Отправляем ответ
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