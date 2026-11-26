import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';
import { updateStreak } from '../services/streakService.js';
import { processVoiceInput } from '../services/audioService.js';
import { handleDictionaryHelper } from './dictionaryHandler.js';
import { handleStandardChat } from './standardChatHandler.js';
import { checkAudioLimit } from '../services/billingService.js';
import { getPaymentKeyboard } from '../lib/constants.js';
import { helpSayInEnglish } from '../services/aiTools.js';
import { generateSpeech } from '../services/ai.js';
import { sessionStore } from '../lib/store.js';
import { escapeHtml } from '../utils/textUtils.js';

/** Текст сообщения бота, на которое ответил пользователь (для голосовых — текст ответа из сохранённого анализа). */
async function getRepliedBotText(chatId: string, reply: TelegramBot.Message): Promise<string> {
  const direct = reply.text || reply.caption;
  if (direct) return direct;
  const analysis = await sessionStore.get<any>(`${chatId}_${reply.message_id}`).catch(() => null);
  return analysis?.reply || '';
}

/** Запрос в словарь — только если все слова из ответа есть в сообщении бота (а не обычная реплика через Reply). */
function isWordLookup(userText: string, botText: string): boolean {
  const tokens = (s: string) => s.toLowerCase().match(/[a-z']+/g) || [];
  const asked = tokens(userText);
  if (asked.length === 0 || asked.length > 5) return false;
  const source = new Set(tokens(botText));
  return asked.every(t => source.has(t));
}

async function handleRussianMessage(bot: TelegramBot, chatId: string, user: any, userText: string) {
  try {
    const help = await helpSayInEnglish(userText, user.level || 'A1');
    if (!help.english) throw new Error('empty help');

    const note = help.note ? `\n\n💡 ${escapeHtml(help.note)}` : '';
    await bot.sendMessage(chatId,
      `🇬🇧 <b>По-английски это можно сказать так:</b>\n\n<i>${escapeHtml(help.english)}</i>${note}\n\nПопробуй повторить это сам — голосом или текстом 🙂`,
      { parse_mode: 'HTML' });

    // Озвучиваем фразу, чтобы было что повторить
    const speech = await generateSpeech(help.english, user.voice || 'alloy', 'teacher').catch(() => ({ audioBuffer: undefined }));
    if (speech.audioBuffer) {
      await bot.sendVoice(chatId, speech.audioBuffer, {}, { filename: 'phrase.mp3', contentType: 'audio/mpeg' }).catch(() => {});
    }
  } catch (e) {
    console.error('Russian help error:', e);
    await bot.sendMessage(chatId, '🇬🇧 Попробуй сказать это по-английски — даже с ошибками, я помогу!');
  }
}

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

    // Ученик не знает, как сказать по-английски — помогаем, а не отказываем
    const cyrillicPattern = /[а-яА-ЯёЁїЇєЄіІ]/;
    if (cyrillicPattern.test(userText)) {
        return await handleRussianMessage(bot, chatId, user, userText);
    }

    if (prisma.message) {
        await prisma.message.create({ 
            data: { userId: chatId, role: 'user', text: userText, isAudio: !!msg.voice, audioDuration: audioDuration > 0 ? audioDuration : null } 
        });
    }

    if (msg.reply_to_message && msg.reply_to_message.from?.is_bot) {
        const botText = await getRepliedBotText(chatId, msg.reply_to_message);
        if (isWordLookup(userText, botText)) {
            return await handleDictionaryHelper(bot, chatId, msg.message_id, userText, botText);
        }
    }

    await handleStandardChat(bot, chatId, user, userText, streakToShow, audioDuration);

  } catch (err: any) {
    console.error('❌ Bot Error:', err.message);
    await bot.sendMessage(chatId, `⚠️ Server Error: ${err.message}`);
  }
}