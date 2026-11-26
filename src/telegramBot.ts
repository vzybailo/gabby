import 'dotenv/config';
// Opt in to node-telegram-bot-api's new file-sending behaviour: silences the
// "content-type of files" deprecation warning printed on every voice message.
process.env.NTBA_FIX_350 = '1';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { prisma, checkDbConnection } from './lib/prisma.js';
import { userState } from './lib/store.js';
import { handleMessage } from './handlers/messageHandler.js';
import { handleCallback } from './handlers/callbackHandler.js';
import { handleStart } from './handlers/startHandler.js'; 
import { initStreakReminder } from './cron/streakReminder.js';
import { initLearningReminders } from './cron/learningReminders.js';
import { HELP_TEXT, helpKeyboard, BOT_COMMANDS } from './lib/onboarding.js';


checkDbConnection();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
export const bot = new TelegramBot(TOKEN, { polling: true });

const TMP_DIR = path.resolve('./tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

initStreakReminder(bot);
initLearningReminders(bot);

export const LEVEL_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🌱 A1 (Beginner)', callback_data: 'set_level_A1' }, { text: '🌿 A2 (Elementary)', callback_data: 'set_level_A2' }],
    [{ text: '🔥 B1 (Intermediate)', callback_data: 'set_level_B1' }, { text: '🚀 B2 (Upper-Inter)', callback_data: 'set_level_B2' }],
    [{ text: '💎 C1 (Advanced)', callback_data: 'set_level_C1' }, { text: '👑 C2 (Proficiency)', callback_data: 'set_level_C2' }],
    [{ text: '🤷‍♂️ Я не знаю, проверь меня!', callback_data: 'start_test' }]
  ]
};

export async function triggerAction(chatId: string, action: string) {
    console.log(`⚡️ Triggering action '${action}' for ${chatId}`);
    
    if (action === '/level') {
        await bot.sendMessage(chatId, '🎚 <b>Выбери уровень английского</b>', { parse_mode: 'HTML', reply_markup: CHANGE_LEVEL_KEYBOARD });
    } 
    else if (action === '/reset') {
        try {
            await prisma.user.update({ where: { id: chatId }, data: { level: null, streakCount: 0 } });
            if (prisma.message) await prisma.message.deleteMany({ where: { userId: chatId } });
            userState.delete(chatId);
            await handleStart(bot, { chat: { id: parseInt(chatId) }, from: { first_name: 'User' } } as any); // Перезапуск визарда
        } catch (e) {
            await bot.sendMessage(chatId, '⚠️ Error resetting data.');
        }
    }
    else if (action === 'support') {
         await bot.sendMessage(chatId, '👨‍💻 <b>Support</b>\n\nPlease contact the developer directly.', { parse_mode: 'HTML' });
    }
}

// Смена уровня в любой момент: кнопки сразу сохраняют уровень (без перехода к выбору голоса)
const CHANGE_LEVEL_KEYBOARD = {
  inline_keyboard: [
    [{ text: 'A1', callback_data: 'level_accept_A1' }, { text: 'A2', callback_data: 'level_accept_A2' }, { text: 'B1', callback_data: 'level_accept_B1' }],
    [{ text: 'B2', callback_data: 'level_accept_B2' }, { text: 'C1', callback_data: 'level_accept_C1' }, { text: 'C2', callback_data: 'level_accept_C2' }]
  ]
};

bot.onText(/^\/start\b/, (msg) => handleStart(bot, msg));
bot.onText(/^\/help\b/, (msg) => {
  bot.sendMessage(msg.chat.id, HELP_TEXT, { parse_mode: 'HTML', reply_markup: helpKeyboard })
    .catch(e => console.error('Help send error:', e?.message));
});
bot.onText(/^\/level\b/, (msg) => {
  bot.sendMessage(msg.chat.id, '🎚 <b>Выбери уровень английского</b>\n\nЯ подстрою под него словарь, скорость и сложность фраз.', { parse_mode: 'HTML', reply_markup: CHANGE_LEVEL_KEYBOARD })
    .catch(e => console.error('Level send error:', e?.message));
});

// Меню команд в Telegram (кнопка «Меню» рядом с полем ввода)
bot.setMyCommands(BOT_COMMANDS).catch(e => console.error('setMyCommands error:', e?.message));

bot.on('message', (msg) => {
    if (msg.successful_payment) return;
    
    if (!msg.text?.startsWith('/')) handleMessage(bot, msg);
});

bot.on('callback_query', (query) => handleCallback(bot, query));

console.log('🚀 Bot Logic Started');