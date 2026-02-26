import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';

const VIDEO_NOTE_1_FILE_ID = 'DQACAgIAAxkBAANoaaDKsoiGg4qqEUiELZyv9ajkuvIAAn2JAAL9bQlJFmYz18NTMdo6BA'; 
const VIDEO_NOTE_2_FILE_ID = 'DQACAgIAAxkBAANqaaDK8PPDVIgPsUqEv5Dk0uuz4MkAAoCJAAL9bQlJZbqNFSAzR186BA'; 

export async function handleStart(bot: TelegramBot, msg: TelegramBot.Message) {
  const chatId = msg.chat.id.toString();
  const firstName = msg.from?.first_name || 'Friend';
  const username = msg.from?.username || null;

  try {
    await prisma.user.upsert({
      where: { id: chatId },
      update: { 
          username: username,
      },
      create: {
        id: chatId,
        username: username,
        level: null, 
        voice: 'alloy',
        mode: 'chill'
      }
    });

    const introText = `👋 <b>Привет, ${firstName}! Добро пожаловать в Say It.</b>\n\n` +
      `Я — твой ИИ-репетитор для практики разговорного английского.\n\n` +
      `🎯 <b>Моя цель</b> — помочь тебе сломать языковой барьер. Со мной можно говорить на любые темы, не боясь сделать ошибку!\n\n` +
      `🚀 <b>Как со мной общаться:</b>\n` +
      `🎙 <b>Говори:</b> Просто отправляй мне голосовые сообщения.\n` +
      `🎧 <b>Слушай:</b> Я отвечу тебе голосом носителя.\n` +
      `✍️ <b>Учись:</b> Я буду мягко исправлять твои ошибки прямо в тексте и подсказывать, как звучать естественнее.\n\n` +
      `👀 <i>Посмотри короткие видео ниже, чтобы понять, как это работает!</i>`;

    const outroText = `Давай за 1 минуту настроим твой уровень и выберем мне голос 👇`;
    
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '🚀 Начать настройку', callback_data: 'wizard_start' }]
      ]
    };

    await bot.sendMessage(chatId, introText, { parse_mode: 'HTML' });

    if (VIDEO_NOTE_1_FILE_ID) {
        try {
            await bot.sendVideoNote(chatId, VIDEO_NOTE_1_FILE_ID);
        } catch (error) {
            console.error('Не удалось отправить первый кружочек:', error);
        }
    }

    if (VIDEO_NOTE_2_FILE_ID) {
        try {
            await bot.sendVideoNote(chatId, VIDEO_NOTE_2_FILE_ID);
        } catch (error) {
            console.error('Не удалось отправить второй кружочек:', error);
        }
    }

    await bot.sendMessage(chatId, outroText, { parse_mode: 'HTML', reply_markup: replyMarkup });

  } catch (e) {
    console.error('Start Handler Error:', e);
    await bot.sendMessage(chatId, '⚠️ Ошибка при запуске. Попробуйте позже.');
  }
}