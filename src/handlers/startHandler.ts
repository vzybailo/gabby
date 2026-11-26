import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';
import {
    TRIAL_DAYS,
    welcomeNewText,
    welcomeNewKeyboard,
    welcomeBackText,
    welcomeBackKeyboard
} from '../lib/onboarding.js';

export async function handleStart(bot: TelegramBot, msg: TelegramBot.Message) {
  const chatId = msg.chat.id.toString();
  const firstName = msg.from?.first_name || 'друг';
  const username = msg.from?.username || null;

  let user;
  let isNewUser = false;

  try {
    user = await prisma.user.findUnique({ where: { id: chatId } });
    isNewUser = !user;

    if (isNewUser) {
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);

        user = await prisma.user.create({
            data: {
                id: chatId,
                username,
                level: null,
                voice: 'alloy',
                isPremium: true,
                premiumUntil: trialEndDate
            }
        });
    } else if (user && user.username !== username) {
        user = await prisma.user.update({ where: { id: chatId }, data: { username } });
    }
  } catch (e: any) {
    // Подробности — в логах сервера (pm2 logs), пользователю — понятное сообщение
    console.error(`Start Handler DB Error for ${chatId}:`, e?.message || e);
    await bot.sendMessage(chatId, '⚠️ Не получилось подготовить твой профиль. Попробуй ещё раз через минуту — /start').catch(() => {});
    return;
  }

  try {
    // Новичок (или не закончил настройку) — приветствие и мастер настройки
    if (isNewUser || !user?.level) {
        await bot.sendMessage(chatId, welcomeNewText(firstName), {
            parse_mode: 'HTML',
            reply_markup: welcomeNewKeyboard
        });
        return;
    }

    // Уже знакомы — короткое меню без повторной настройки
    await bot.sendMessage(chatId, welcomeBackText(firstName, user.level), {
        parse_mode: 'HTML',
        reply_markup: welcomeBackKeyboard
    });
  } catch (e: any) {
    console.error(`Start Handler Send Error for ${chatId}:`, e?.response?.body?.description || e?.message || e);
    await bot.sendMessage(chatId, '👋 Привет! Напиши мне что-нибудь по-английски, и начнём.').catch(() => {});
  }
}
