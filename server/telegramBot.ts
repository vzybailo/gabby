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
    console.error('[LOG] Ошибка в /start:', e);
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
  if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id;
  if (!msg.text && !msg.voice) return;

  console.log(`[LOG] Получено сообщение от ${msg.from?.username || chatId}: ${msg.text || '[VOICE]'}`);

  try {
    // Подтверждаем получение сообщения пользователю
    await bot.sendChatAction(chatId, 'typing');
    
    const currentState = userState.get(chatId.toString()) || 'IDLE';
    const hasLevel = userSettings.has(chatId.toString());

    // 1. Проверка выбора уровня
    if (currentState !== 'TESTING' && !hasLevel) {
      console.log(`[LOG] Пользователь ${chatId} не выбрал уровень.`);
      await bot.sendMessage(chatId, '⛔️ Please select your English level first to start chatting:', {
        reply_markup: LEVEL_KEYBOARD
      });
      return;
    }

    let userText = msg.text;

    // 2. Обработка голоса через STT
    if (msg.voice) {
      console.log(`[LOG] Обработка голосового сообщения...`);
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const oggIn = path.join(TMP_DIR, `in_${msg.voice.file_id}.ogg`);
      
      const voiceFile = await axios.get(fileLink, { responseType: 'arraybuffer' });
      fs.writeFileSync(oggIn, Buffer.from(voiceFile.data));

      const formData = new FormData();
      formData.append('audio', fs.createReadStream(oggIn), { filename: 'voice.ogg' });

      try {
        const tRes = await axios.post(`${BACKEND_URL}/api/transcribe`, formData, {
          headers: { ...formData.getHeaders() }
        });
        userText = tRes.data.text;
        console.log(`[API] STT результат: ${userText}`);
      } catch (err: any) {
        throw new Error(`STT API Error: ${err.message}`);
      } finally {
        if (fs.existsSync(oggIn)) fs.unlinkSync(oggIn);
      }
    }

    if (!userText || userText.trim().length < 2) {
      await bot.sendMessage(chatId, '👂 I couldn\'t hear you clearly. Please try again.');
      return;
    }

    // 3. Логика теста уровня
    if (currentState === 'TESTING') {
      console.log(`[API] Запрос на Assess: ${BACKEND_URL}/api/assess-level`);
      const res = await axios.post(`${BACKEND_URL}/api/assess-level`, { text: userText });
      const result = res.data;
      
      userSettings.set(chatId.toString(), result.level);
      userState.set(chatId.toString(), 'IDLE'); 

      await bot.sendMessage(chatId, `🎯 Assessment Complete!\nYour Level: ${result.level}\n${result.reply || ''}`);
      return; 
    }

    // 4. Основной Чат (AI ответ)
    const currentLevel = userSettings.get(chatId.toString())!;
    console.log(`[API] Отправка в Чат: ${BACKEND_URL}/chat (Level: ${currentLevel})`);
    
    const chatRes = await axios.post(`${BACKEND_URL}/chat`, {
      messages: [{ role: 'user', content: userText }],
      level: currentLevel
    });

    console.log(`[LOG] Статус ответа API: ${chatRes.status}`);
    console.log(`[LOG] Тело ответа API:`, JSON.stringify(chatRes.data));

    const aiMessage = chatRes.data.message;
    const analysis = aiMessage.analysis;
    sessionStore.set(chatId.toString(), analysis);

    // 5. TTS (Озвучка)
    if (aiMessage.content) {
       try {
         console.log(`[API] Запрос на TTS...`);
         const ttsRes = await axios.post(`${BACKEND_URL}/api/tts`, { text: aiMessage.content });
         if (ttsRes.data.audioUrl) {
           await bot.sendVoice(chatId, `${BACKEND_URL}${ttsRes.data.audioUrl}`);
         }
       } catch (e) {
         console.error('[LOG] TTS Error:', e);
       }
       // Отправляем текст AI
       await bot.sendMessage(chatId, aiMessage.content);
    }

    // 6. Анализ ошибок и исправления
    if (analysis) {
        const isPerfect = analysis.is_perfect;
        const msgText = isPerfect ? `✅ ${userText}` : `💡 ${analysis.diff_view || aiMessage.corrected_text}`;
        
        let buttons = [];
        if (!isPerfect && analysis.user_errors?.length > 0) {
            buttons.push([{ text: 'Why? (Mistakes)', callback_data: 'explain_mistakes' }]);
        }
        if (isPerfect && analysis.better_alternatives?.length > 0) {
            buttons.push([{ text: '✨ Native style', callback_data: 'show_alternatives' }]);
        }

        await bot.sendMessage(chatId, msgText, {
            reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
        });
    }

  } catch (err: any) {
    console.error('❌ ПОЛНАЯ ОШИБКА БОТА:', err.message);
    await bot.sendMessage(chatId, `⚠️ Oops, something went wrong on the server.\nError: ${err.message}`);
  }
});

// --- ОБРАБОТКА КНОПОК ---

bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId) return;
  const action = query.data;

  try {
    if (action === 'start_test') {
      userState.set(chatId.toString(), 'TESTING');
      await bot.sendMessage(chatId, '🧐 Record a voice message: "Tell me about your favorite hobby. Why do you like it?"');
      await bot.answerCallbackQuery(query.id);
    } 
    else if (action?.startsWith('set_level_')) {
      const level = action.replace('set_level_', '');
      userSettings.set(chatId.toString(), level);
      userState.set(chatId.toString(), 'IDLE');
      await bot.sendMessage(chatId, `✅ Level set to ${level}. I'm ready to chat!`);
      await bot.answerCallbackQuery(query.id);
    }
    
    // Остальная логика Explain/Alternatives подтягивается из sessionStore
    const analysis = sessionStore.get(chatId.toString());
    if (!analysis && (action === 'explain_mistakes' || action === 'show_alternatives')) {
        await bot.answerCallbackQuery(query.id, { text: 'Session expired.', show_alert: true });
        return;
    }

    if (action === 'explain_mistakes') {
        let text = '❌ Mistakes Analysis:\n';
        analysis.user_errors.forEach((err: any) => {
            text += `\n• Wrong: ${err.error_part}\n• Correct: ${err.correction}\n• Info: ${err.explanation}\n`;
        });
        await bot.sendMessage(chatId, text);
        await bot.answerCallbackQuery(query.id);
    }

    if (action === 'show_alternatives') {
        let text = '✨ Native ways to say it:\n';
        analysis.better_alternatives.forEach((alt: string) => {
            text += `\n🔹 ${alt}`;
        });
        await bot.sendMessage(chatId, text);
        await bot.answerCallbackQuery(query.id);
    }

  } catch (e: any) {
    console.error('[LOG] Callback Error:', e);
    await bot.answerCallbackQuery(query.id, { text: 'Error.' });
  }
});