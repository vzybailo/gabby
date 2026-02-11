// src/handlers/messageHandler.ts
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import * as Diff from 'diff'; // Нужно для генерации разницы текста
import { prisma } from '../lib/prisma.js';
import { sessionStore, userState } from '../lib/store.js';
import { updateStreak } from '../services/streakService.js';
import { generateMessageText } from '../utils/textUtils.js';
// 🔥 Импортируем наши новые сервисы напрямую
import { getChatResponse, generateSpeech } from '../services/ai.js';

const BACKEND_URL = process.env.SERVER_URL || 'http://localhost:3001';
const TMP_DIR = path.resolve('./tmp');

// --- HELPER: DIFF VIEW ---
function generateDiffView(original: string, corrected: string): string {
  if (!original || !corrected || original.trim() === corrected.trim()) return corrected;
  const diff = Diff.diffWords(original, corrected);
  let result = '';
  diff.forEach((part) => {
    const val = part.value.trim();
    if (!val) return; 
    if (part.removed) result += `~${val}~ `; 
    else if (part.added) result += `*${val}* `; 
    else result += `${val} `;
  });
  return result.replace(/\s+/g, ' ').replace(/ \./g, '.').replace(/ ,/g, ',').replace(/ \?/g, '?').replace(/ !/g, '!').replace(/ '/g, "'").trim();
}

const LEVEL_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🌱 A1', callback_data: 'set_level_A1' }, { text: '🌿 A2', callback_data: 'set_level_A2' }, { text: '🔥 B1', callback_data: 'set_level_B1' }],
    [{ text: '🚀 B2', callback_data: 'set_level_B2' }, { text: '💎 C1', callback_data: 'set_level_C1' }, { text: '👑 C2', callback_data: 'set_level_C2' }],
    [{ text: '🤷‍♂️ I don\'t know, check me!', callback_data: 'start_test' }]
  ]
};

export async function handleMessage(bot: TelegramBot, msg: TelegramBot.Message) {
  if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id.toString();
  if (!msg.text && !msg.voice) return;

  try {
    if (!prisma.user) throw new Error("Prisma Client broken (no User model)");
    
    // 1. Получаем/Создаем юзера
    let user = await prisma.user.upsert({ where: { id: chatId }, update: {}, create: { id: chatId } });

    // Стрики
    const streakResult = await updateStreak(chatId);
    const streakToShow = streakResult.shouldNotify ? streakResult.count : 0;
    
    // 🔥 ФОРМИРУЕМ НАСТРОЙКИ (Updated for new AI Service)
    const userSettings = {
        mode: user.mode || 'chill',
        level: user.level || 'A1',
        voice: user.voice || 'alloy',             // Тембр (кто говорит)
        speakingStyle: user.speakingStyle || 'standard' // Стиль (как говорит)
    };

    const currentState = userState.get(chatId) || 'IDLE';

    if (currentState !== 'TESTING' && !user.level) {
      await bot.sendMessage(chatId, '⛔️ Please select your English level first:', { reply_markup: LEVEL_KEYBOARD });
      return;
    }

    await bot.sendChatAction(chatId, 'typing');
    let userText = msg.text || '';

    // 2. STT (Voice to Text)
    if (msg.voice) {
      if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const oggIn = path.join(TMP_DIR, `in_${msg.voice.file_id}.ogg`);
      
      const voiceFile = await axios.get(fileLink, { responseType: 'arraybuffer' });
      fs.writeFileSync(oggIn, Buffer.from(voiceFile.data));
      
      const formData = new FormData();
      formData.append('audio', fs.createReadStream(oggIn), { filename: 'voice.ogg' });
      
      try {
        const tRes = await axios.post(`${BACKEND_URL}/api/transcribe`, formData, { headers: { ...formData.getHeaders() } });
        userText = tRes.data.text;
      } catch (err: any) { throw new Error(`STT Error: ${err.message}`); } 
      finally { if (fs.existsSync(oggIn)) fs.unlinkSync(oggIn); }
      
      await bot.sendMessage(chatId, `🗣 <i>You said:</i> "${userText}"`, { parse_mode: 'HTML' });
    }

    if (!userText || userText.trim().length < 2) {
      await bot.sendMessage(chatId, '👂 Couldn\'t hear you clearly. Try again!');
      return;
    }

    // 3. TESTING MODE
    if (currentState === 'TESTING') {
      const res = await axios.post(`${BACKEND_URL}/api/assess-level`, { text: userText });
      const result = res.data;
      await prisma.user.update({ where: { id: chatId }, data: { level: result.level } });
      userState.set(chatId, 'IDLE'); 
      await bot.sendMessage(chatId, `🎯 <b>Level detected: ${result.level}</b>\n\n${result.reply || ''}`, { parse_mode: 'HTML' });
      return; 
    }

    // 4. DIALOG HISTORY
    if (prisma.message) {
        await prisma.message.create({ data: { userId: chatId, role: 'user', text: userText } });
    }

    let chatHistory = [];
    if (prisma.message) {
        const history = await prisma.message.findMany({ where: { userId: chatId }, orderBy: { createdAt: 'desc' }, take: 6 });
        chatHistory = history.reverse().map(m => ({ role: m.role as 'user'|'assistant', content: m.text }));
    } else {
        chatHistory = [{ role: 'user' as const, content: userText }]; 
    }

    // 5. 🔥 AI REQUEST
    const aiResponse = await getChatResponse(chatHistory, userSettings);
    
    // Генерируем Diff
    const diffView = generateDiffView(userText, aiResponse.corrected);

    const analysis = {
        is_perfect: aiResponse.is_correct,
        corrected_text: aiResponse.corrected,
        diff_view: diffView,
        user_errors: aiResponse.user_errors,
        better_alternatives: aiResponse.better_alternatives,
        reply: aiResponse.reply,
        _user_text_cache: userText,
        _streak_cache: streakToShow
    };

    // Сохраняем ответ бота
    if (prisma.message && aiResponse.reply) {
        await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: aiResponse.reply } });
    }

    // 6. SEND RESPONSE (TEXT)
    if (analysis) {
        const msgText = generateMessageText(userText, analysis, 'simple', streakToShow);
        let row1 = [];
        if (!analysis.is_perfect && analysis.user_errors?.length > 0) row1.push({ text: 'Why?', callback_data: 'explain_mistakes' });
        if (analysis.better_alternatives?.length > 0) row1.push({ text: 'Native style', callback_data: 'show_alternatives' });
        
        const keyboard = { inline_keyboard: [row1].filter(r => r.length > 0) };
        const sentMsg = await bot.sendMessage(chatId, msgText, { parse_mode: 'HTML', reply_markup: keyboard });
        
        const sessionKey = `${chatId}_${sentMsg.message_id}`;
        sessionStore.set(sessionKey, analysis);
    }

    // 7. 🔥 TTS GENERATION (Передаем voice И speakingStyle)
    await bot.sendChatAction(chatId, 'record_voice');
    
    let textToSpeak = aiResponse.reply || '';
    if (textToSpeak) {
        textToSpeak = textToSpeak.replace(/[*_~`]/g, '');
        if (textToSpeak.length > 800) textToSpeak = textToSpeak.substring(0, 797) + '...';
    }

    const isLowLevel = ['A1', 'A2'].includes(userSettings.level || 'B1');
    let audioKeyboard = [];
    if (isLowLevel) audioKeyboard.push([{ text: '🇷🇺 Translate', callback_data: 'translate_audio_caption' }]);
    else audioKeyboard.push([{ text: '📝 Text', callback_data: 'show_audio_caption' }]);

    try {
        if (textToSpeak && textToSpeak.trim().length > 1) {
            // 🔥 ПЕРЕДАЕМ: Текст, Тембр, Стиль
            const speech = await generateSpeech(textToSpeak, userSettings.voice, userSettings.speakingStyle);
            
            if (speech.audioUrl) {
                const cleanPath = speech.audioUrl.replace(/^\/audio\//, '');
                const localFilePath = path.resolve('./audio', cleanPath);
                
                if (fs.existsSync(localFilePath)) {
                    const sentAudioMsg = await bot.sendVoice(chatId, fs.createReadStream(localFilePath), { 
                        reply_markup: { inline_keyboard: audioKeyboard } 
                    });
                    if (sentAudioMsg && analysis) sessionStore.set(`${chatId}_${sentAudioMsg.message_id}`, analysis);
                }
            }
        }
    } catch (e: any) {
        console.error('TTS Error:', e.message);
    }

  } catch (err: any) {
    console.error('❌ Bot Error:', err.message);
    await bot.sendMessage(chatId, `⚠️ Server Error: ${err.message}`);
  }
}