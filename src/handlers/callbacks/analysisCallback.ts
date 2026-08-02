import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { prisma } from '../../lib/prisma.js';
import { sessionStore } from '../../lib/store.js';
import { generateMessageText } from '../../utils/textUtils.js';
import { isUserPremium } from '../../services/billingService.js';

const BACKEND_URL = process.env.SERVER_URL || 'http://localhost:3001';

export async function handleAnalysisCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery, action: string, chatId: string, messageId: number) {
    const msgSessionKey = `${chatId}_${messageId}`;
    const analysis = sessionStore.get(msgSessionKey);
    
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
             let row1 = [];
             
             if (!analysis.is_perfect && analysis.user_errors?.length > 0) {
                 row1.push({ text: hasPremium ? 'Why?' : '🔒 Why?', callback_data: 'explain_mistakes' });
             }
             if (analysis.better_alternatives?.length > 0) {
                 row1.push({ text: hasPremium ? 'Native style' : '🔒 Native style', callback_data: 'show_alternatives' });
             }
             
             await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [row1] } });
        }
        
        if (action === 'translate_audio_caption' || action === 'show_audio_caption') {
            const originalText = analysis.reply; 
            let textToShow = originalText;
            
            if (action === 'translate_audio_caption') {
                try {
                    const transRes = await axios.post(`${BACKEND_URL}/api/translate`, { text: originalText, targetLang: 'Russian' });
                    textToShow = `${originalText}\n\n🇷🇺 <i>${transRes.data.translation}</i>`;
                } catch (e) {
                    textToShow = `${originalText}\n\n⚠️ Translation unavailable.`;
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
    
    await bot.answerCallbackQuery(query.id);
}