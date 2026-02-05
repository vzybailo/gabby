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
  if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id;
  if (!msg.text && !msg.voice) return;

  console.log(`[LOG] Сообщение от ${msg.from?.username || chatId}: ${msg.text || '[Голос]'}`);

  try {
    // 1. Эхо-ответ для проверки жизни бота
    await bot.sendChatAction(chatId, 'typing');
    
    const currentState = userState.get(chatId.toString()) || 'IDLE';
    const hasLevel = userSettings.has(chatId.toString());

    // 2. Проверка уровня (без MarkdownV2 для стабильности)
    if (currentState !== 'TESTING' && !hasLevel) {
      console.log(`[LOG] Спрашиваю уровень у ${chatId}`);
      await bot.sendMessage(chatId, '⛔️ Please select your English level first to start chatting:', {
        reply_markup: LEVEL_KEYBOARD
      });
      return;
    }

    let userText = msg.text;

    // 3. Обработка голосового сообщения
    if (msg.voice) {
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const oggIn = path.join(TMP_DIR, `in_${msg.voice.file_id}.ogg`);
      
      const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
      fs.writeFileSync(oggIn, response.data);

      const formData = new FormData();
      formData.append('audio', fs.createReadStream(oggIn), { filename: 'voice.ogg' });

      console.log(`[API] Запрос на STT: ${BACKEND_URL}/api/transcribe`);
      try {
        const tRes = await axios.post(`${BACKEND_URL}/api/transcribe`, formData, {
          headers: { ...formData.getHeaders() }
        });
        userText = tRes.data.text;
      } catch (sttErr: any) {
        throw new Error(`STT Failed: ${sttErr.message}`);
      } finally {
        if (fs.existsSync(oggIn)) fs.unlinkSync(oggIn);
      }
    }

    if (!userText || userText.trim().length < 2) {
      await bot.sendMessage(chatId, '👂 I couldn\'t hear you clearly. Please try again.');
      return;
    }

    // 4. Режим тестирования
    if (currentState === 'TESTING') {
      console.log(`[API] Запрос на Assess: ${BACKEND_URL}/api/assess-level`);
      const res = await axios.post(`${BACKEND_URL}/api/assess-level`, { text: userText });
      const result = res.data;
      
      userSettings.set(chatId.toString(), result.level);
      userState.set(chatId.toString(), 'IDLE'); 

      await bot.sendMessage(chatId, `🎯 Assessment Complete!\nLevel: ${result.level}\n${result.reply || ''}`);
      return; 
    }

    // 5. Основная логика чата
    const currentLevel = userSettings.get(chatId.toString())!;
    console.log(`[API] Запрос в Чат: ${BACKEND_URL}/chat (Level: ${currentLevel})`);
    
    const chatRes = await axios.post(`${BACKEND_URL}/chat`, {
      messages: [{ role: 'user', content: userText }],
      level: currentLevel
    });

    const aiMessage = chatRes.data.message;
    const analysis = aiMessage.analysis;
    sessionStore.set(chatId.toString(), analysis);

    // 6. TTS и Ответ
    if (aiMessage.content) {
       try {
         const ttsRes = await axios.post(`${BACKEND_URL}/api/tts`, { text: aiMessage.content });
         if (ttsRes.data.audioUrl) {
           await bot.sendVoice(chatId, `${BACKEND_URL}${ttsRes.data.audioUrl}`);
         }
       } catch (e) {
         console.error('[LOG] TTS Error:', e);
       }
       await bot.sendMessage(chatId, aiMessage.content);
    }

    // 7. Показ исправлений (анализ)
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
    // Отправляем ошибку без Markdown, чтобы она точно дошла
    await bot.sendMessage(chatId, `⚠️ System error: ${err.message}`);
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