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

bot.onText(/\/start|\/level/, async (msg) => {
  const chatId = msg.chat.id;
  userState.set(chatId.toString(), 'IDLE');
  await bot.sendMessage(chatId, '👋 *Welcome\\! Let\'s set up your profile\\.* \n\nSelect your English level or take a quick test:', {
    parse_mode: 'MarkdownV2',
    reply_markup: LEVEL_KEYBOARD
  });
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id.toString();
  userSettings.delete(chatId);
  userState.delete(chatId);
  sessionStore.delete(chatId);
  await bot.sendMessage(chatId, '🔄 *Memory cleared\\!* \n\nYou are now a new user\\. Type /start to begin\\.', { parse_mode: 'MarkdownV2' });
});

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id;
  if (!msg.text && !msg.voice) return;

  try {
    const currentState = userState.get(chatId.toString()) || 'IDLE';
    const hasLevel = userSettings.has(chatId.toString());

    if (currentState !== 'TESTING' && !hasLevel) {
      await bot.sendMessage(chatId, '⛔️ *Please select your English level first\\!*', {
        //parse_mode: 'MarkdownV2',
        reply_markup: LEVEL_KEYBOARD
      });
      return;
    }

    let userText = msg.text;

    if (msg.voice) {
      await bot.sendChatAction(chatId, 'typing');
      
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const oggIn = path.join(TMP_DIR, `in_${msg.voice.file_id}.ogg`);
      
      console.log(`Отправляю запрос на: ${BACKEND_URL}/chat`);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(oggIn, Buffer.from(arrayBuffer));

      const formData = new FormData();
      const fileBuffer = fs.readFileSync(oggIn); 

      formData.append('audio', fileBuffer, {
        filename: 'voice.ogg',
        contentType: 'audio/ogg', 
      });

      try {
        const tRes = await axios.post(`${BACKEND_URL}/api/transcribe`, formData, {
          headers: {
            ...formData.getHeaders(), 
            'Content-Length': formData.getLengthSync() 
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });
        userText = tRes.data.text;
      } catch (axiosError: any) {
        throw new Error(`STT Upload Error: ${axiosError.response?.status || 'Network'} | ${axiosError.message}`);
      } finally {
        if (fs.existsSync(oggIn)) fs.unlinkSync(oggIn);
      }
    }

    if (!userText || userText.trim().length < 2) {
      await bot.sendMessage(chatId, '👂 *I couldn\'t hear you clearly\\.* Please try again\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    if (currentState === 'TESTING') {
      if (userText.length < 15) {
        await bot.sendMessage(chatId, '📉 *Too short\\!* Please speak for at least 10 seconds\\.', { parse_mode: 'MarkdownV2' });
        return;
      }
      await bot.sendChatAction(chatId, 'typing');
      
      console.log(`Отправляю запрос на: ${BACKEND_URL}/chat`);
      const res = await fetch(`${BACKEND_URL}/api/assess-level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userText })
      });
      
      if (!res.ok) throw new Error(`Assess API Error: ${res.status}`);
      const result: any = await res.json(); 
      
      userSettings.set(chatId.toString(), result.level);
      userState.set(chatId.toString(), 'IDLE'); 

      const reply = `🎯 *Assessment Complete\\!*
      
📊 Your Level: *${escapeMd(result.level)}*
📝 Feedback: _${escapeMd(result.reply || "Good job!")}_

✅ Level set to *${escapeMd(result.level)}*\\. Let's chat\\!`;

      await bot.sendMessage(chatId, reply, { parse_mode: 'MarkdownV2' });
      return; 
    }

    await bot.sendChatAction(chatId, 'typing');
    const currentLevel = userSettings.get(chatId.toString())!;

    console.log(`Отправляю запрос на: ${BACKEND_URL}/chat`);
    const chatRes = await fetch(`${BACKEND_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: userText }], level: currentLevel }),
    });

    if (!chatRes.ok) throw new Error(`Chat API Error: ${chatRes.status}`);

    const data: any = await chatRes.json();
    const aiMessage = data.message;
    const analysis = aiMessage.analysis;

    sessionStore.set(chatId.toString(), analysis);

    if (aiMessage.content) {
       await bot.sendChatAction(chatId, 'record_voice');
       try {
         console.log(`Отправляю запрос на: ${BACKEND_URL}/chat`);
         const ttsRes = await fetch(`${BACKEND_URL}/api/tts`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ text: aiMessage.content })
         });
         const ttsData: any = await ttsRes.json();
         
         if (ttsData.audioUrl) {
           const audioUrl = `${BACKEND_URL}${ttsData.audioUrl}`;
           await bot.sendVoice(chatId, audioUrl);
         }
       } catch (e) {
         console.error('TTS Error:', e);
       }
    }

    if (aiMessage.content) {
        await bot.sendMessage(chatId, aiMessage.content);
    }

    if (analysis) {
        let buttons = [];

        if (analysis.is_perfect) {
            const cleanUserText = escapeMd(userText); 
            const msgText = `✅ _${cleanUserText}_`;
            
            if (analysis.better_alternatives && analysis.better_alternatives.length > 0) {
                buttons.push([{ text: '✨ Native style', callback_data: 'show_alternatives' }]);
            }

            await bot.sendMessage(chatId, msgText, {
                parse_mode: 'MarkdownV2',
                reply_markup: { inline_keyboard: buttons }
            });

        } 
        else {
            const rawDiff = analysis.diff_view || aiMessage.corrected_text;
            const safeDiff = escapeMd(rawDiff);
            const msgText = `💡 _${safeDiff}_`;

            if (analysis.user_errors && analysis.user_errors.length > 0) {
                buttons.push([{ text: 'Why?', callback_data: 'explain_mistakes' }]);
            }

            await bot.sendMessage(chatId, msgText, {
                parse_mode: 'MarkdownV2',
                reply_markup: { inline_keyboard: buttons }
            });
        }
    }

  } catch (err: any) {
    console.error('❌ ПОЛНАЯ ОШИБКА БОТА:', err);
    await bot.sendMessage(chatId, `⚠️ Oops, something went wrong.\nError: ${err.message}`, { parse_mode: undefined });
    userState.set(chatId.toString(), 'IDLE');
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId) return;
  const action = query.data;

  if (action === 'start_test') {
    userState.set(chatId.toString(), 'TESTING');
    const text = `🧐 *Time for a quick test\\!*
    
Please record a voice message answering this question:
👉 _"Tell me about your favorite hobby\\. Why do you like it?"_

\\(Speak for at least 10\\-20 seconds\\)`; 
    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (action?.startsWith('set_level_')) {
    const newLevel = action.replace('set_level_', '');
    userSettings.set(chatId.toString(), newLevel);
    userState.set(chatId.toString(), 'IDLE'); 
    await bot.sendMessage(chatId, `✅ Level set to *${newLevel}*\\. I will adjust my answers\\.`, { parse_mode: 'MarkdownV2' });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  const analysis = sessionStore.get(chatId.toString());
  
  if (!analysis) {
    await bot.answerCallbackQuery(query.id, { text: 'Session expired (old message)', show_alert: true });
    return;
  }

  try {
    if (action === 'explain_mistakes') {
      const errors = analysis.user_errors;

      if (!errors || errors.length === 0) {
         await bot.answerCallbackQuery(query.id, { text: 'No detailed errors found.', show_alert: true });
         return;
      }

      let text = '❌ *Mistakes Analysis:*';
      
      errors.forEach((err: any) => {
          text += `\n\n🔻 *Wrong:* ${escapeMd(err.error_part)}`;
          text += `\n✅ *Correct:* ${escapeMd(err.correction)}`;
          text += `\nℹ️ _${escapeMd(err.explanation)}_`;
      });
      
      await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
      await bot.answerCallbackQuery(query.id);
    }

    if (action === 'show_alternatives') {
      const alts = analysis.better_alternatives;

      if (!alts || alts.length === 0) {
        await bot.answerCallbackQuery(query.id, { text: 'No alternatives available.', show_alert: true });
        return;
      }

      let text = '✨ *Native ways to say it:*';
      alts.forEach((alt: string) => {
          text += `\n\n🔹 _${escapeMd(alt)}_`;
      });

      await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
      await bot.answerCallbackQuery(query.id);
    }

  } catch (err) {
    console.error('Callback Error:', err);
    await bot.sendMessage(chatId, "⚠️ Error showing details.");
  }
});