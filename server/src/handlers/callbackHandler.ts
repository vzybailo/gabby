import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { sessionStore, userState } from '../lib/store.js';
import { generateMessageText, escapeHtml } from '../utils/textUtils.js';
import { getChatResponse, generateSpeech } from '../services/ai.js';

const BACKEND_URL = process.env.SERVER_URL || 'http://localhost:3001';

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

    if (action?.startsWith('rp_')) {
        const scenarios: Record<string, string> = {
            'rp_cafe': 'Ordering coffee at a busy cafe. You are the barista.',
            'rp_airport': 'Check-in counter at the airport. You are the airline staff.',
            'rp_hotel': 'Checking into a hotel. You are the receptionist.',
            'rp_taxi': 'Giving directions in a taxi. You are the driver.',
            'rp_doctor': 'Describing symptoms. You are the doctor.',
            'rp_shop': 'Buying groceries. You are the cashier.'
        };

        const scenarioContext = scenarios[action];

        if (scenarioContext) {
            const user = await prisma.user.update({
                where: { id: chatId },
                data: { roleplayContext: scenarioContext, mode: 'roleplay' }
            });

            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(chatId, `🎬 <b>Scenario:</b> ${scenarioContext}`, { parse_mode: 'HTML' });
            await bot.sendChatAction(chatId, 'record_voice');

            const aiResponse = await getChatResponse(
                [{ role: 'user', content: `Start the roleplay scenario: ${scenarioContext}. You start first!` }],
                { 
                    mode: 'roleplay', 
                    level: user.level || 'A1', 
                    voice: user.voice || 'alloy', 
                    speakingStyle: user.speakingStyle || 'standard',
                    roleplayContext: scenarioContext
                }
            );

            await bot.sendMessage(chatId, aiResponse.reply);
            
            try {
                const speech = await generateSpeech(aiResponse.reply, user.voice || 'alloy', user.speakingStyle || 'standard');
                if (speech.audioUrl) {
                    const cleanPath = speech.audioUrl.replace(/^\/audio\//, '');
                    const localFilePath = path.resolve('./audio', cleanPath);
                    if (fs.existsSync(localFilePath)) {
                        await bot.sendVoice(chatId, fs.createReadStream(localFilePath));
                    }
                }
            } catch(e) { console.error('TTS Error (RP):', e); }
            
            return; 
        }
    }

    if (action?.startsWith('add_word_')) {
        const rawWord = action.replace('add_word_', '');
        const sessionKey = `vocab_${chatId}_${rawWord.toLowerCase()}`;
        let wordData = sessionStore.get(sessionKey);

        if (!wordData) {
            wordData = { 
                word: rawWord, 
                translation: 'Saved', 
                definition: 'Manual save', 
                example: '' 
            };
        }

        try {
            const existing = await prisma.vocabularyItem.findFirst({
                where: { userId: chatId, word: wordData.word }
            });

            if (!existing) {
                await prisma.vocabularyItem.create({
                    data: {
                        userId: chatId,
                        word: wordData.word,
                        translation: wordData.translation,
                        definition: wordData.definition,
                        context: wordData.example 
                    }
                });
            }

            await bot.editMessageReplyMarkup({
                inline_keyboard: [[{ text: '✅ Saved', callback_data: 'noop' }]]
            }, { chat_id: chatId, message_id: messageId });
            
            await bot.answerCallbackQuery(query.id, { text: `"${wordData.word}" saved!` });

        } catch (e) {
            console.error("Save Word Error:", e);
            await bot.answerCallbackQuery(query.id, { text: "Error saving word." });
        }
        return;
    }

    if (action === 'noop') {
        await bot.answerCallbackQuery(query.id);
        return;
    }
    
    const msgSessionKey = `${chatId}_${messageId}`;
    const analysis = sessionStore.get(msgSessionKey);
    
    if (!analysis) {
        await bot.answerCallbackQuery(query.id, { text: 'Session expired (old message)', show_alert: false });
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
    
    if (action === 'translate_audio_caption' || action === 'show_audio_caption') {
        const originalText = analysis.reply; 
        let textToShow = originalText;
        
        if (action === 'translate_audio_caption') {
            try {
                const transRes = await axios.post(`${BACKEND_URL}/api/translate`, { text: originalText, targetLang: 'Russian' });
                const russianText = transRes.data.translation;
                
                textToShow = `${originalText}\n\n🇷🇺 <i>${russianText}</i>`;
            } catch (e) {
                textToShow = `${originalText}\n\n⚠️ Translation unavailable.`;
            }
        }
        
        await bot.editMessageCaption(textToShow, { 
            chat_id: chatId, 
            message_id: messageId, 
            parse_mode: 'HTML', 
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Hide', callback_data: 'hide_audio_caption' }]] } 
        });
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