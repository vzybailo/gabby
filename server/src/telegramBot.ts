import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { prisma, checkDbConnection } from './lib/prisma.js';
import { userState } from './lib/store.js';
import { handleMessage } from './handlers/messageHandler.js';
import { handleCallback } from './handlers/callbackHandler.js';
import { initStreakReminder } from './cron/streakReminder.js';

checkDbConnection();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new TelegramBot(TOKEN, { polling: true });

const TMP_DIR = path.resolve('./tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

initStreakReminder(bot);

// --- КЛАВИАТУРА (можно тоже вынести в utils/constants.ts, но пока оставим тут для наглядности) ---
const LEVEL_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🌱 A1', callback_data: 'set_level_A1' }, { text: '🌿 A2', callback_data: 'set_level_A2' }, { text: '🔥 B1', callback_data: 'set_level_B1' }],
    [{ text: '🚀 B2', callback_data: 'set_level_B2' }, { text: '💎 C1', callback_data: 'set_level_C1' }, { text: '👑 C2', callback_data: 'set_level_C2' }],
    [{ text: '🤷‍♂️ I don\'t know, check me!', callback_data: 'start_test' }]
  ]
};

bot.onText(/\/start|\/level/, async (msg) => {
  const chatId = msg.chat.id.toString();
  userState.set(chatId, 'IDLE');
  try {
    if (!prisma.user) throw new Error("Prisma Client broken");
    await prisma.user.upsert({ where: { id: chatId }, update: {}, create: { id: chatId } });
    await bot.sendMessage(chatId, '👋 <b>Welcome!</b> \n\nSelect your English level:', { parse_mode: 'HTML', reply_markup: LEVEL_KEYBOARD });
  } catch (e: any) {
    console.error('DB Error on Start:', e);
    await bot.sendMessage(chatId, `⚠️ Database Error: ${e.message}`);
  }
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id.toString();
  try {
    await prisma.user.update({ where: { id: chatId }, data: { level: null, streakCount: 0 } });
    if (prisma.message) {
        await prisma.message.deleteMany({ where: { userId: chatId } });
    }
    userState.delete(chatId);
    await bot.sendMessage(chatId, '🔄 <b>Memory cleared!</b>', { parse_mode: 'HTML' });
  } catch (e) {
    await bot.sendMessage(chatId, '⚠️ Error clearing data.');
  }
});

bot.on('message', (msg) => handleMessage(bot, msg));
bot.on('callback_query', (query) => handleCallback(bot, query));

console.log('🚀 Bot Service Started');