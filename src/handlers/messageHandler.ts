import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';
import { updateStreak } from '../services/streakService.js';
import { processVoiceInput } from '../services/audioService.js';
import { handleDictionaryHelper } from './dictionaryHandler.js';
import { handleStandardChat } from './standardChatHandler.js';
import { checkAudioLimit } from '../services/billingService.js';
import { getPaymentKeyboard } from '../lib/constants.js';

export async function handleMessage(bot: TelegramBot, msg: TelegramBot.Message) {
  if (msg.text?.startsWith('/')) return;
  if (!msg.text && !msg.voice) return;

  const chatId = msg.chat.id.toString();

  try {
    const user = await prisma.user.upsert({ 
      where: { id: chatId }, update: {}, create: { id: chatId } 
    });
    
    const streakResult = await updateStreak(chatId);
    const streakToShow = streakResult.shouldNotify ? streakResult.count : 0;

    let userText = msg.text || '';
    const audioDuration = msg.voice?.duration || 0; 

    if (msg.voice) {
        const limitCheck = await checkAudioLimit(chatId);
        
        if (!limitCheck.allowed) {
            return bot.sendMessage(chatId, `💎 <b>Лимит исчерпан!</b>\n\n${limitCheck.reason}`, {
                parse_mode: 'HTML',
                reply_markup: getPaymentKeyboard(chatId) 
            });
        }
        
        userText = await processVoiceInput(bot, msg.voice.file_id);
    }

    if (!userText || userText.trim().length < 2) {
      return bot.sendMessage(chatId, '👂 Couldn\'t hear you clearly. Try again!');
    }

    const cyrillicPattern = /[а-яА-ЯёЁїЇєЄіІ]/;
    if (cyrillicPattern.test(userText)) {
        return bot.sendMessage(chatId, '🇬🇧 <b>Oops!</b> I only understand English. Please speak or write in English to continue our practice!', { parse_mode: 'HTML' });
    }

    if (prisma.message) {
        await prisma.message.create({ 
            data: { userId: chatId, role: 'user', text: userText, isAudio: !!msg.voice, audioDuration: audioDuration > 0 ? audioDuration : null } 
        });
    }

    if (msg.reply_to_message && msg.reply_to_message.from?.is_bot && userText.split(' ').length <= 5) {
        return await handleDictionaryHelper(bot, chatId, msg.message_id, userText);
    }

    await handleStandardChat(bot, chatId, user, userText, streakToShow, audioDuration);

  } catch (err: any) {
    console.error('❌ Bot Error:', err.message);
    await bot.sendMessage(chatId, `⚠️ Server Error: ${err.message}`);
  }
}