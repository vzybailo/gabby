import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';
import { sessionStore } from '../lib/store.js';
import { getChatResponse, generateSpeech } from '../services/ai.js';
import { generateDiffView, generateMessageText } from '../utils/textUtils.js';
import { updateDailyStats } from '../services/statService.js';
import { sendVoiceSafely } from '../services/audioService.js'; // Импортируем из нового сервиса!

export async function handleStandardChat(bot: TelegramBot, chatId: string, user: any, userText: string, streakToShow: number, audioDuration: number) {
    let chatHistory = [];
    if (prisma.message) {
        const history = await prisma.message.findMany({ where: { userId: chatId }, orderBy: { createdAt: 'desc' }, take: 6 });
        chatHistory = history.reverse().map(m => ({ role: m.role as 'user'|'assistant', content: m.text }));
    } else {
        chatHistory = [{ role: 'user' as const, content: userText }]; 
    }

    const userSettings = { 
        level: user.level || 'A1', 
        voice: user.voice || 'alloy', 
        speakingStyle: user.speakingStyle || 'standard' 
    };
    
    const aiResponse = await getChatResponse(chatHistory, userSettings);
    let grammarScore = aiResponse.grammarScore ?? Math.max(0, 100 - ((aiResponse.user_errors?.length || 0) * 10));

    const analysis = {
        is_perfect: aiResponse.is_correct,
        corrected_text: aiResponse.corrected,
        diff_view: generateDiffView(userText, aiResponse.corrected),
        user_errors: aiResponse.user_errors,
        better_alternatives: aiResponse.better_alternatives,
        reply: aiResponse.reply,
        grammarScore: grammarScore,
        _user_text_cache: userText,
        _streak_cache: streakToShow
    };

    if (prisma.message && aiResponse.reply) {
        await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: aiResponse.reply, grammarScore: grammarScore, grammarFixes: aiResponse.user_errors } });
        updateDailyStats(chatId, audioDuration, grammarScore).catch(e => console.error("Stats update error:", e));
    }

    const msgText = generateMessageText(userText, analysis, 'simple', streakToShow);
    let row1 = [];
    if (!analysis.is_perfect && analysis.user_errors?.length > 0) row1.push({ text: 'Why?', callback_data: 'explain_mistakes' });
    if (analysis.better_alternatives?.length > 0) row1.push({ text: 'Native style', callback_data: 'show_alternatives' });
    
    const sentMsg = await bot.sendMessage(chatId, msgText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [row1].filter(r => r.length > 0) } });
    sessionStore.set(`${chatId}_${sentMsg.message_id}`, analysis);

    await bot.sendChatAction(chatId, 'record_voice');
    let textToSpeak = aiResponse.reply || '';
    if (textToSpeak) textToSpeak = textToSpeak.replace(/[*_~`]/g, '').substring(0, 797);

    try {
        if (textToSpeak && textToSpeak.trim().length > 1) {
            const speech = await generateSpeech(textToSpeak, userSettings.voice, userSettings.speakingStyle);
            if (speech.audioUrl) {
                const isLowLevel = ['A1', 'A2'].includes(userSettings.level || 'B1');
                const audioKeyboard = isLowLevel ? [{ text: '🇷🇺 Translate', callback_data: 'translate_audio_caption' }] : [{ text: '📝 Text', callback_data: 'show_audio_caption' }];
                
                await sendVoiceSafely(bot, chatId, speech.audioUrl, { inline_keyboard: [audioKeyboard] }, analysis);
            }
        }
    } catch (e: any) {
        console.error('TTS Error:', e.message);
    }
}