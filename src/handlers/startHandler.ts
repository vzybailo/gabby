import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';

export async function handleStart(bot: TelegramBot, msg: TelegramBot.Message) {
  const chatId = msg.chat.id.toString();
  const firstName = msg.from?.first_name || 'Friend';
  const username = msg.from?.username || null;

  try {
    await prisma.user.upsert({
      where: { id: chatId },
      update: { 
          username: username 
      },
      create: {
        id: chatId,
        username: username,
        level: null, 
        voice: 'alloy',
        mode: 'chill'
      }
    });

    await bot.sendMessage(
      chatId,
      `👋 <b>Hi, ${firstName}! Welcome to Say It.</b>\n\n` +
      `Я — твой ИИ-репетитор. Со мной можно говорить голосом, и я буду отвечать, как носитель.\n\n` +
      `🚀 <b>Как это работает:</b>\n` +
      `1️⃣ <b>Говори:</b> Отправляй голосовые сообщения.\n` +
      `2️⃣ <b>Слушай:</b> Я отвечу, исправлю ошибки и объясню грамматику.\n` +
      `3️⃣ <b>Учи:</b> Сохраняй новые слова в словарь.\n\n` +
      `Давай быстро настроим твой уровень и голос бота! 👇`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Начать настройку', callback_data: 'wizard_start' }]
          ]
        }
      }
    );

  } catch (e) {
    console.error('Start Handler Error:', e);
    await bot.sendMessage(chatId, '⚠️ Ошибка при запуске. Попробуйте позже.');
  }
}