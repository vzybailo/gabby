import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';
import { sessionStore } from '../lib/store.js';
import { getChatResponse, generateSpeech, cleanForSpeech } from '../services/ai.js';
import { generateDiffView, generateMessageText } from '../utils/textUtils.js';
import { updateDailyStats } from '../services/statService.js';
import { sendVoiceSafely } from '../services/audioService.js';
import { isUserPremium } from '../services/billingService.js';
import { pickVocabularyForChat, creditWordsUsedInMessage } from '../services/vocabularyService.js';
import { buildAnalysisKeyboard } from './analysisKeyboard.js';
import { maybeUpdateLearnerProfile } from '../services/learnerProfileService.js';

export async function handleStandardChat(
    bot: TelegramBot, 
    chatId: string, 
    user: any, 
    userText: string, 
    streakToShow: number, 
    audioDuration: number
) {
    let chatHistory = [];
    if (prisma.message) {
        const history = await prisma.message.findMany({ 
            where: { userId: chatId.toString() }, 
            orderBy: { createdAt: 'desc' }, 
            take: 6 
        });
        chatHistory = history.reverse().map(m => ({ role: m.role as 'user'|'assistant', content: m.text }));
    } else {
        chatHistory = [{ role: 'user' as const, content: userText }]; 
    }

    const userSettings = { 
        level: user.level || 'A1', 
        voice: user.voice || 'alloy', 
        speakingStyle: user.speakingStyle || 'standard',
        learnerProfile: user.learnerProfile || null
    };
    
    // Персональный словарь пользователя: бот естественно использует эти слова в разговоре
    const vocabulary = await pickVocabularyForChat(chatId.toString()).catch(() => []);
    const aiResponse = await getChatResponse(chatHistory, userSettings, vocabulary);
    let grammarScore = aiResponse.grammarScore ?? Math.max(0, 100 - ((aiResponse.user_errors?.length || 0) * 10));

    // 🟢 1. СОХРАНЯЕМ ОТВЕТ АССИСТЕНТА (сообщение пользователя уже сохранено в messageHandler)
    if (prisma.message && aiResponse.reply) {
        try {
            await prisma.message.create({
                data: { userId: chatId.toString(), role: 'assistant', text: aiResponse.reply, grammarScore, grammarFixes: aiResponse.user_errors }
            });
        } catch (e) {
            console.error("Message create error:", e);
        }
    }

    // Слова из словаря, которые пользователь сам употребил, засчитываются в SRS
    const usedWords = await creditWordsUsedInMessage(chatId.toString(), userText, aiResponse.user_errors)
        .catch(e => { console.error('Vocab credit error:', e); return [] as string[]; });

    try {
        await updateDailyStats(chatId.toString(), audioDuration || 0, grammarScore || 0);
        console.log(`[Stats Debug] Daily stats successfully updated for user: ${chatId}`);
    } catch (e) {
        console.error("Stats update error:", e);
    }

    const analysis = {
        is_perfect: aiResponse.is_correct,
        corrected_text: aiResponse.corrected,
        diff_view: generateDiffView(userText, aiResponse.corrected),
        user_errors: aiResponse.user_errors,
        better_alternatives: aiResponse.better_alternatives,
        reply: aiResponse.reply,
        grammarScore: grammarScore,
        praise: aiResponse.praise,
        used_vocabulary: usedWords,
        new_vocabulary: aiResponse.new_vocabulary,
        saved_vocab: [] as number[],
        _user_text_cache: userText,
        _streak_cache: streakToShow
    };

    // Фоновое обновление «памяти» об ученике (не задерживает ответ)
    void maybeUpdateLearnerProfile(chatId.toString());

    const hasPremium = await isUserPremium(chatId);
    const msgText = generateMessageText(userText, analysis, 'simple', streakToShow);
    const sentMsg = await bot.sendMessage(chatId, msgText, { 
        parse_mode: 'HTML', 
        reply_markup: buildAnalysisKeyboard(analysis, hasPremium)
    });
    
    await sessionStore.set(`${chatId}_${sentMsg.message_id}`, analysis);

    await bot.sendChatAction(chatId, 'record_voice');
    let textToSpeak = aiResponse.reply || '';
    if (textToSpeak) textToSpeak = cleanForSpeech(textToSpeak).substring(0, 797);

    try {
        if (textToSpeak && textToSpeak.trim().length > 1) {
            const speech = await generateSpeech(textToSpeak, userSettings.voice, userSettings.speakingStyle);
            if (speech.audioBuffer) {
                const isLowLevel = ['A1', 'A2'].includes(userSettings.level || 'B1');
                const audioKeyboard = isLowLevel 
                    ? [{ text: '🇷🇺 Translate', callback_data: 'translate_audio_caption' }] 
                    : [{ text: '📝 Text', callback_data: 'show_audio_caption' }];
                
                await sendVoiceSafely(bot, chatId, speech.audioBuffer, { inline_keyboard: [audioKeyboard] }, analysis);
            }
        }
    } catch (e: any) {
        console.error('TTS Error:', e.message);
    }
}