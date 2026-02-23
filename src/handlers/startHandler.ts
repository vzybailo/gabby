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
      `Я — твой ИИ-репетитор. Со мной можно общаться голосом или текстом, а я буду отвечать тебе как настоящий носитель языка.\n\n` +
      `🎯 <b>Наша главная цель</b> — сломать языковой барьер. Не бойся делать ошибки! Просто начни говорить, чтобы довести английскую речь до автоматизма и чувствовать себя уверенно в любом диалоге.\n\n` +
      `🚀 <b>Как это работает:</b>\n` +
      `1️⃣ <b>Говори:</b> Отправляй мне голосовые или кружочки.\n` +
      `2️⃣ <b>Слушай:</b> Я поддержу беседу, мягко исправлю ошибки и подскажу крутые нейтив-фразы.\n` +
      `3️⃣ <b>Учи:</b> Просто ответь (Reply) на любое мое сообщение с незнакомым словом, чтобы сохранить его в свой словарь.\n\n` +
      `Давай быстро настроим твой уровень и выберем мне голос! 👇`,
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