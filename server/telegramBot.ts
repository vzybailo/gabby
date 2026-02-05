import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios'; 

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const BACKEND_URL = process.env.SERVER_URL; 

// Инициализация бота
const bot = new TelegramBot(TOKEN, { polling: true });

const TMP_DIR = path.resolve('./tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const sessionStore = new Map<string, any>(); 
const userSettings = new Map<string, string>(); 
const userState = new Map<string, 'IDLE' | 'TESTING'>(); 

// Функция экранирования для MarkdownV2
function escapeMd(text: string | undefined | null) {
  if (!text) return '';
  return text.replace(/[_\[\]()>`#+\-=|{}.!\\]/g, '\\$&');
}

const LEVEL_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🌱 A1', callback_data: 'set_level_A1' }, { text: '🌿 A2', callback_data: 'set_level_A2' }, { text: '🔥 B1', callback_data: 'set_level_B1' }],
    [{ text: '🚀 B2', callback_data: 'set_level_B2' }, { text: '💎 C1', callback_data: 'set_level_C1' }, { text: '👑 C2', callback_data: 'set_level_C2' }],
    [{ text: '🤷‍♂️ I don\'t know, check me!', callback_data: 'start_test' }]
  ]
};

// --- КОМАНДЫ ---

bot.onText(/\/start|\/level/, async (msg) => {
  const chatId = msg.chat.id;
  userState.set(chatId.toString(), 'IDLE');
  try {
    await bot.sendMessage(chatId, '👋 *Welcome\\! Let\'s set up your profile\\.* \n\nSelect your English level or take a quick test:', {
      parse_mode: 'MarkdownV2',
      reply_markup: LEVEL_KEYBOARD
    });
  } catch (e) {
    console.error('Ошибка в /start:', e);
  }
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id.toString();
  userSettings.delete(chatId);
  userState.delete(chatId);
  sessionStore.delete(chatId);
  await bot.sendMessage(chatId, '🔄 Memory cleared! Type /start to begin.');
});

// --- ОСНОВНОЙ ОБРАБОТЧИК ---

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  console.log("!!! МАГИЯ: Я ПОЛУЧИЛ СООБЩЕНИЕ:", msg.text);
  
  try {
    await bot.sendMessage(chatId, "БОТ ЖИВ! Я тебя вижу.");
    console.log("!!! УСПЕХ: Ответ отправлен в Telegram");
  } catch (e) {
    console.error("!!! ОШИБКА ОТПРАВКИ:", e);
  }
});

// --- CALLBACK QUERIES ---

bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId) return;
  const action = query.data;

  try {
    if (action === 'start_test') {
      userState.set(chatId.toString(), 'TESTING');
      await bot.sendMessage(chatId, '🧐 Time for a test! Record a voice message: "Tell me about your favorite hobby."');
      await bot.answerCallbackQuery(query.id);
    } 
    else if (action?.startsWith('set_level_')) {
      const level = action.replace('set_level_', '');
      userSettings.set(chatId.toString(), level);
      userState.set(chatId.toString(), 'IDLE');
      await bot.sendMessage(chatId, `✅ Level set to ${level}. Let's chat!`);
      await bot.answerCallbackQuery(query.id);
    }
    // ... остальные обработки Explain/Alternatives аналогично без сложного Markdown для теста
  } catch (e) {
    console.error('Callback Error:', e);
  }
});