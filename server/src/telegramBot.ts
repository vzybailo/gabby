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
// Экспортируем бота, если нужно, но главное - логика ниже
export const bot = new TelegramBot(TOKEN, { polling: true });

const TMP_DIR = path.resolve('./tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

initStreakReminder(bot);

const LEVEL_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🌱 A1 (Beginner)', callback_data: 'set_level_A1' }, { text: '🌿 A2 (Elementary)', callback_data: 'set_level_A2' }],
    [{ text: '🔥 B1 (Intermediate)', callback_data: 'set_level_B1' }, { text: '🚀 B2 (Upper-Inter)', callback_data: 'set_level_B2' }],
    [{ text: '💎 C1 (Advanced)', callback_data: 'set_level_C1' }, { text: '👑 C2 (Proficiency)', callback_data: 'set_level_C2' }],
    [{ text: '🤷‍♂️ I don\'t know, test me!', callback_data: 'start_test' }]
  ]
};

// --- ЭКСПОРТИРУЕМАЯ ФУНКЦИЯ ДЛЯ API ---
// Эту функцию будет вызывать index.ts, когда придет запрос с сайта
export async function triggerAction(chatId: string, action: string) {
    console.log(`⚡️ Triggering action '${action}' for ${chatId}`);
    
    if (action === '/level') {
        await bot.sendMessage(chatId, '🎚 <b>Change Difficulty</b>\n\nSelect a new level:', { parse_mode: 'HTML', reply_markup: LEVEL_KEYBOARD });
    } 
    else if (action === '/reset') {
        try {
            await prisma.user.update({ where: { id: chatId }, data: { level: null, streakCount: 0 } });
            if (prisma.message) await prisma.message.deleteMany({ where: { userId: chatId } });
            userState.delete(chatId);
            await bot.sendMessage(chatId, '🔄 <b>Reset Complete!</b>\n\nYour history is cleared. Type /start to begin.', { parse_mode: 'HTML' });
        } catch (e) {
            await bot.sendMessage(chatId, '⚠️ Error resetting data.');
        }
    }
    else if (action === 'support') {
         await bot.sendMessage(chatId, '👨‍💻 <b>Support</b>\n\nPlease contact the developer directly.', { parse_mode: 'HTML' });
    }
}

// --- ОБРАБОТЧИКИ (из чата) ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    userState.set(chatId, 'IDLE');
    await bot.sendMessage(chatId, '👋 <b>Welcome!</b>\n\nOpen the <b>Menu</b> to see your profile or change settings.', { parse_mode: 'HTML' });
});

bot.onText(/\/level/, (msg) => triggerAction(msg.chat.id.toString(), '/level'));
bot.onText(/\/reset/, (msg) => triggerAction(msg.chat.id.toString(), '/reset'));

bot.on('message', (msg) => {
    if (!msg.text?.startsWith('/')) handleMessage(bot, msg);
});

bot.on('callback_query', (query) => handleCallback(bot, query));

console.log('🚀 Bot Logic Started');