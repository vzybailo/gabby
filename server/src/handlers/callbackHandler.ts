// src/handlers/callbackHandler.ts
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { sessionStore, userState } from '../lib/store.js';
import { generateMessageText, escapeHtml } from '../utils/textUtils.js';

const BACKEND_URL = process.env.SERVER_URL;

export async function handleCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery) {
  const chatId = query.message?.chat.id.toString();
  const messageId = query.message?.message_id; 
  if (!chatId || !messageId) return;
  const action = query.data;

  try {
    if (action === 'start_test') {
        userState.set(chatId, 'TESTING');
        await bot.sendMessage(chatId, '🧐 <b>Level Test</b>\n\nPlease send a voice message or text.', { parse_mode: 'HTML' });
        await bot.answerCallbackQuery(query.id);
        return;
    } 
    if (action?.startsWith('set_level_')) {
        const level = action.replace('set_level_', '');
        await prisma.user.update({ where: { id: chatId }, data: { level: level } });
        await bot.editMessageText(`✅ Level set to: <b>${level}</b>.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
        await bot.answerCallbackQuery(query.id);
        return;
    }
    
    const sessionKey = `${chatId}_${messageId}`;
    const analysis = sessionStore.get(sessionKey);
    if (!analysis) {
        await bot.answerCallbackQuery(query.id, { text: 'Session expired', show_alert: true });
        return;
    }
    const userText = analysis._user_text_cache || ""; 
    const streak = analysis._streak_cache || 0;
    const backButton = { inline_keyboard: [[{ text: '⬅️ Collapse', callback_data: 'collapse_text_view' }]] };

    if (action === 'explain_mistakes') {
         const newText = generateMessageText(userText, analysis, 'expanded_errors', streak);
         await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: backButton });
    }
    if (action === 'show_alternatives') {
         const newText = generateMessageText(userText, analysis, 'expanded_alternatives', streak);
         await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: backButton });
    }
    if (action === 'collapse_text_view') {
         const newText = generateMessageText(userText, analysis, 'simple', streak);
         let row1 = [];
         if (!analysis.is_perfect && analysis.user_errors?.length > 0) row1.push({ text: 'Why?', callback_data: 'explain_mistakes' });
         if (analysis.better_alternatives?.length > 0) row1.push({ text: 'Native style', callback_data: 'show_alternatives' });
         await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [row1] } });
    }
    
    // --- CLASSIC AUDIO CAPTION ---
    if (action === 'translate_audio_caption' || action === 'show_audio_caption') {
        // Берем стандартный ответ бота
        let textToShow = analysis.reply; 
        
        if (action === 'translate_audio_caption') {
            try {
                const transRes = await axios.post(`${BACKEND_URL}/api/translate`, { text: textToShow, targetLang: 'Russian' });
                textToShow = transRes.data.translation;
            } catch (e) {
                textToShow = "Translation failed.";
            }
        }
        await bot.editMessageCaption(escapeHtml(textToShow), { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Hide', callback_data: 'hide_audio_caption' }]] } });
    }
    if (action === 'hide_audio_caption') {
        const userInDb = await prisma.user.findUnique({ where: { id: chatId } });
        const isLowLevel = ['A1', 'A2'].includes(userInDb?.level || 'B1');
        let audioKeyboard = isLowLevel ? [{ text: '🇷🇺 Translate', callback_data: 'translate_audio_caption' }] : [{ text: '📝 Text', callback_data: 'show_audio_caption' }];
        await bot.editMessageCaption('', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [audioKeyboard] } });
    }
    await bot.answerCallbackQuery(query.id);
  } catch (e: any) {
    console.error('Callback Error:', e.message);
    await bot.answerCallbackQuery(query.id);
  }
}