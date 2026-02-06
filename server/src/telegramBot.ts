import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios'; 

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const BACKEND_URL = process.env.SERVER_URL; 

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

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

/**
 * Превращает формат бэкенда (~bad~ *good*) в HTML Телеграма (<s>bad</s> <b>good</b>)
 */
function formatDiffToHtml(text: string): string {
  if (!text) return '';
  
  // Заменяем ~текст~ на <s>текст</s> (зачеркивание)
  let html = text.replace(/~([^~]+)~/g, '<s>$1</s>');
  
  // Заменяем *текст* на <b>текст</b> (жирный)
  html = html.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  
  return html;
}

// --- КОМАНДЫ ---

bot.onText(/\/start|\/level/, async (msg) => {
  const chatId = msg.chat.id;
  userState.set(chatId.toString(), 'IDLE');
  await bot.sendMessage(chatId, '👋 <b>Welcome!</b> \n\nSelect your English level:', {
    parse_mode: 'HTML',
    reply_markup: LEVEL_KEYBOARD
  });
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id.toString();
  userSettings.delete(chatId);
  userState.delete(chatId);
  sessionStore.delete(chatId);
  await bot.sendMessage(chatId, '🔄 Memory cleared!');
});

// --- ОСНОВНОЙ ОБРАБОТЧИК ---

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id;
  if (!msg.text && !msg.voice) return;

  console.log(`[LOG] Сообщение от ${msg.from?.username}: ${msg.text || '[VOICE]'}`);

  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const currentState = userState.get(chatId.toString()) || 'IDLE';
    const hasLevel = userSettings.has(chatId.toString());

    if (currentState !== 'TESTING' && !hasLevel) {
      await bot.sendMessage(chatId, '⛔️ Please select your English level first:', { reply_markup: LEVEL_KEYBOARD });
      return;
    }

    let userText = msg.text;

    // 1. STT
    if (msg.voice) {
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const oggIn = path.join(TMP_DIR, `in_${msg.voice.file_id}.ogg`);
      
      const voiceFile = await axios.get(fileLink, { responseType: 'arraybuffer' });
      fs.writeFileSync(oggIn, Buffer.from(voiceFile.data));

      const formData = new FormData();
      formData.append('audio', fs.createReadStream(oggIn), { filename: 'voice.ogg' });

      try {
        const tRes = await axios.post(`${BACKEND_URL}/api/transcribe`, formData, { headers: { ...formData.getHeaders() } });
        userText = tRes.data.text;
      } catch (err: any) {
        throw new Error(`STT Error: ${err.message}`);
      } finally {
        if (fs.existsSync(oggIn)) fs.unlinkSync(oggIn);
      }
    }

    if (!userText || userText.trim().length < 2) {
      await bot.sendMessage(chatId, '👂 Couldn\'t hear you.');
      return;
    }

    // 2. Тестирование (оставил как есть, тут текст нужен)
    if (currentState === 'TESTING') {
      const res = await axios.post(`${BACKEND_URL}/api/assess-level`, { text: userText });
      const result = res.data;
      userSettings.set(chatId.toString(), result.level);
      userState.set(chatId.toString(), 'IDLE'); 
      await bot.sendMessage(chatId, `🎯 Level: ${result.level}\n${result.reply || ''}`);
      return; 
    }

    // 3. Основной чат
    const currentLevel = userSettings.get(chatId.toString())!;
    
    // Запускаем запрос к AI
    const chatRes = await axios.post(`${BACKEND_URL}/chat`, {
      messages: [{ role: 'user', content: userText }],
      level: currentLevel
    });

    const data = chatRes.data;
    const aiMessage = data.message;
    const analysis = aiMessage.analysis;
    sessionStore.set(chatId.toString(), analysis);

    // --- ШАГ 1: ОТПРАВЛЯЕМ КОРРЕКЦИЮ ВАШЕГО ТЕКСТА ---
    if (analysis) {
        const isPerfect = analysis.is_perfect;
        let msgText = '';

        if (isPerfect) {
             // Если ошибок нет, просто подтверждаем (можно вообще убрать, если хотите полную тишину)
             msgText = `✅ <i>${userText}</i>`;
        } else {
             // Если есть ошибки: берем diff_view (где ~ошибки~ и *исправления*) и форматируем
             // Если diff_view нет, берем просто исправленный текст
             const rawDiff = analysis.diff_view || aiMessage.corrected_text;
             const formattedDiff = formatDiffToHtml(rawDiff);
             msgText = `💡 ${formattedDiff}`;
        }

        // Кнопки оставляем, они полезны
        let buttons = [];
        if (!isPerfect && analysis.user_errors?.length > 0) {
            buttons.push([{ text: 'Why?', callback_data: 'explain_mistakes' }]);
        }
        if (analysis.better_alternatives?.length > 0) {
            buttons.push([{ text: 'Native style', callback_data: 'show_alternatives' }]);
        }

        await bot.sendMessage(chatId, msgText, {
            parse_mode: 'HTML',
            reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
        });
    }

    // --- ШАГ 2: ОТПРАВЛЯЕМ ТОЛЬКО ГОЛОСОВОЙ ОТВЕТ (БЕЗ ТЕКСТА AI) ---
    
    // Сначала показываем статус "записывает голосовое...", пока качаем файл
    await bot.sendChatAction(chatId, 'record_voice');

    const audioUrl = data.audioUrl || aiMessage.audioUrl;
    
    if (audioUrl) {
        try {
            await bot.sendVoice(chatId, `${BACKEND_URL}${audioUrl}`);
        } catch (e: any) {
            console.error('[LOG] Ошибка аудио:', e.message);
            // Если аудио сломалось, можно отправить текст как запасной вариант
            await bot.sendMessage(chatId, `(Audio Error) ${aiMessage.content}`);
        }
    } else {
        // Если ссылки нет, пробуем сгенерировать
        try {
            const ttsRes = await axios.post(`${BACKEND_URL}/api/tts`, { text: aiMessage.content });
            if (ttsRes.data.audioUrl) {
                await bot.sendVoice(chatId, `${BACKEND_URL}${ttsRes.data.audioUrl}`);
            }
        } catch (e) {
            // Только если все сломалось - шлем текст
            await bot.sendMessage(chatId, aiMessage.content);
        }
    }

  } catch (err: any) {
    console.error('❌ Error:', err.message);
    await bot.sendMessage(chatId, `⚠️ Server Error`);
  }
});

// --- КНОПКИ (Остались без изменений) ---
bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId) return;
  const action = query.data;

  try {
    if (action === 'start_test') {
      userState.set(chatId.toString(), 'TESTING');
      await bot.sendMessage(chatId, '🧐 Record a voice message about your hobby.');
      await bot.answerCallbackQuery(query.id);
    } 
    else if (action?.startsWith('set_level_')) {
      const level = action.replace('set_level_', '');
      userSettings.set(chatId.toString(), level);
      userState.set(chatId.toString(), 'IDLE');
      await bot.sendMessage(chatId, `✅ Level: ${level}`);
      await bot.answerCallbackQuery(query.id);
    }
    
    const analysis = sessionStore.get(chatId.toString());
    if (!analysis && (action === 'explain_mistakes' || action === 'show_alternatives')) {
        await bot.answerCallbackQuery(query.id, { text: 'Expired', show_alert: true });
        return;
    }

    if (action === 'explain_mistakes') {
        let text = '❌ <b>Mistakes:</b>\n';
        analysis.user_errors.forEach((err: any) => {
            text += `\n🔻 <s>${err.error_part}</s> \n✅ <b>${err.correction}</b>\nℹ️ <i>${err.explanation}</i>\n`;
        });
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        await bot.answerCallbackQuery(query.id);
    }

    if (action === 'show_alternatives') {
        let text = '✨ <b>Native style:</b>\n';
        analysis.better_alternatives.forEach((alt: string) => {
            text += `\n🔹 ${alt}`;
        });
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        await bot.answerCallbackQuery(query.id);
    }

  } catch (e) {
    await bot.answerCallbackQuery(query.id);
  }
});