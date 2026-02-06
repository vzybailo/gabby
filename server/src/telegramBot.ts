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
    // Используем HTML парсинг, он проще и надежнее для базового форматирования
    await bot.sendMessage(chatId, '👋 <b>Welcome! Let\'s set up your profile.</b> \n\nSelect your English level or take a quick test:', {
      parse_mode: 'HTML',
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
    // Подтверждаем получение (статус "печатает")
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

    // 2. Обработка голоса (STT)
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
    
    // Отправляем запрос
    const chatRes = await axios.post(`${BACKEND_URL}/chat`, {
      messages: [{ role: 'user', content: userText }],
      level: currentLevel
    });

    console.log(`[LOG] Статус ответа API: ${chatRes.status}`);
    
    const data = chatRes.data;
    const aiMessage = data.message;
    const analysis = aiMessage.analysis;
    sessionStore.set(chatId.toString(), analysis);

    // --- ИЗМЕНЕНИЕ: Сначала текст, потом голос ---

    // 5. Отправляем Текстовый Ответ
    if (aiMessage.content) {
       await bot.sendMessage(chatId, aiMessage.content);
    }

    // 6. Отправляем Голосовой Ответ (TTS)
    // Сначала проверяем, прислал ли сервер готовую ссылку (data.audioUrl)
    const audioUrl = data.audioUrl || aiMessage.audioUrl;

    if (audioUrl) {
        try {
            // Если ссылка есть, просто пересылаем её (мгновенно)
            const fullUrl = `${BACKEND_URL}${audioUrl}`;
            console.log(`[LOG] Отправка готового аудио: ${fullUrl}`);
            await bot.sendVoice(chatId, fullUrl);
        } catch (e: any) {
            console.error('[LOG] Ошибка отправки ссылки аудио:', e.message);
        }
    } else if (aiMessage.content) {
        // Резервный вариант: если ссылки нет, пробуем сгенерировать
        try {
            console.log(`[API] Генерация TTS (резерв)...`);
            const ttsRes = await axios.post(`${BACKEND_URL}/api/tts`, { text: aiMessage.content });
            if (ttsRes.data.audioUrl) {
                await bot.sendVoice(chatId, `${BACKEND_URL}${ttsRes.data.audioUrl}`);
            }
        } catch (e) {
            console.error('[LOG] Ошибка генерации TTS:', e);
        }
    }

    // 7. Анализ ошибок (Исправлен вывод текста)
    if (analysis) {
        const isPerfect = analysis.is_perfect;
        
        // ВАЖНО: Вместо 'diff_view' (с ~ и *) показываем чистый 'corrected_text'
        const correctVersion = aiMessage.corrected_text || analysis.diff_view;
        const msgText = isPerfect 
            ? `✅ Perfect! "${userText}"` 
            : `💡 <b>Correction:</b> ${correctVersion}`;

        let buttons = [];
        if (!isPerfect && analysis.user_errors?.length > 0) {
            buttons.push([{ text: 'Why? (Mistakes)', callback_data: 'explain_mistakes' }]);
        }
        if (analysis.better_alternatives?.length > 0) {
            buttons.push([{ text: '✨ Native style', callback_data: 'show_alternatives' }]);
        }

        await bot.sendMessage(chatId, msgText, {
            parse_mode: 'HTML', // Используем HTML чтобы работало жирное выделение
            reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
        });
    }

  } catch (err: any) {
    console.error('❌ ПОЛНАЯ ОШИБКА БОТА:', err.message);
    await bot.sendMessage(chatId, `⚠️ Oops, something went wrong on the server.`);
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
      await bot.sendMessage(chatId, `✅ Level set to ${level}. Let's chat!`);
      await bot.answerCallbackQuery(query.id);
    }
    
    // Работа с анализом ошибок
    const analysis = sessionStore.get(chatId.toString());
    
    // Если сессия истекла
    if (!analysis && (action === 'explain_mistakes' || action === 'show_alternatives')) {
        await bot.answerCallbackQuery(query.id, { text: 'Message too old. Please try a new one.', show_alert: true });
        return;
    }

    if (action === 'explain_mistakes') {
        let text = '❌ <b>Mistakes Analysis:</b>\n';
        analysis.user_errors.forEach((err: any) => {
            text += `\n🔻 <b>Wrong:</b> ${err.error_part}`;
            text += `\n✅ <b>Correct:</b> ${err.correction}`;
            text += `\nℹ️ <i>${err.explanation}</i>\n`;
        });
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        await bot.answerCallbackQuery(query.id);
    }

    if (action === 'show_alternatives') {
        let text = '✨ <b>Native ways to say it:</b>\n';
        analysis.better_alternatives.forEach((alt: string) => {
            text += `\n🔹 ${alt}`;
        });
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        await bot.answerCallbackQuery(query.id);
    }

  } catch (e: any) {
    console.error('[LOG] Callback Error:', e);
    await bot.answerCallbackQuery(query.id, { text: 'Error.' });
  }
});