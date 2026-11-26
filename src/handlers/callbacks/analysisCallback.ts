import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../../lib/prisma.js';
import { sessionStore } from '../../lib/store.js';
import { generateMessageText, escapeHtml } from '../../utils/textUtils.js';
import { isUserPremium } from '../../services/billingService.js';
import { translateText } from '../../services/aiTools.js';
import { buildAnalysisKeyboard } from '../analysisKeyboard.js';

export async function handleAnalysisCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery, action: string, chatId: string, messageId: number) {
    const msgSessionKey = `${chatId}_${messageId}`;
    // Если данных нет (очень старое сообщение) — сообщаем, а не молчим
    const staleNotice = 'Это сообщение слишком старое — отправьте новое 🙂';
    const analysis = await sessionStore.get(msgSessionKey);
    
    if (analysis) { 
        const userText = analysis._user_text_cache || ""; 
        const streak = analysis._streak_cache || 0;
        const backButton = { inline_keyboard: [[{ text: '⬅️ Collapse', callback_data: 'collapse_text_view' }]] };

        if (action === 'explain_mistakes' || action === 'show_alternatives') {
            const hasPremium = await isUserPremium(chatId);

            if (!hasPremium) {
                await bot.answerCallbackQuery(query.id, { 
                    text: '💎 Эта функция доступна только в Premium.\n\nНажмите кнопку «Premium» в нижнем меню (Mini App), чтобы снять ограничения!', 
                    show_alert: true 
                });
                
                return; 
            }

            const viewType = action === 'explain_mistakes' ? 'expanded_errors' : 'expanded_alternatives';
            const newText = generateMessageText(userText, analysis, viewType, streak);
            await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: backButton });
        }
        
        if (action === 'collapse_text_view') {
             const newText = generateMessageText(userText, analysis, 'simple', streak);
             
             const hasPremium = await isUserPremium(chatId);
             await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: buildAnalysisKeyboard(analysis, hasPremium) });
        }
        
        if (action === 'translate_audio_caption' || action === 'show_audio_caption') {
            const originalText = analysis.reply; 
            let textToShow = escapeHtml(originalText);
            
            if (action === 'translate_audio_caption') {
                try {
                    const translation = await translateText(originalText, 'Russian');
                    textToShow = `${escapeHtml(originalText)}\n\n🇷🇺 <i>${escapeHtml(translation)}</i>`;
                } catch (e) {
                    textToShow = `${escapeHtml(originalText)}\n\n⚠️ Translation unavailable.`;
                }
            }
            
            await bot.editMessageCaption(textToShow, { 
                chat_id: chatId, message_id: messageId, parse_mode: 'HTML', 
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Hide', callback_data: 'hide_audio_caption' }]] } 
            });
        }
    }
    
    if (action === 'hide_audio_caption') {
        const userInDb = await prisma.user.findUnique({ where: { id: chatId } });
        const isLowLevel = ['A1', 'A2'].includes(userInDb?.level || 'B1');
        const audioKeyboard = isLowLevel ? [{ text: '🇷🇺 Translate', callback_data: 'translate_audio_caption' }] : [{ text: '📝 Text', callback_data: 'show_audio_caption' }];
        
        await bot.editMessageCaption('', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [audioKeyboard] } });
    }

    if (!analysis && action !== 'hide_audio_caption') {
        await bot.answerCallbackQuery(query.id, { text: staleNotice });
        return;
    }

    await bot.answerCallbackQuery(query.id);
}