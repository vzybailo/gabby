// src/handlers/messageHandler.ts
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { sessionStore, userState } from '../lib/store.js';
import { updateStreak } from '../services/streakService.js';
import { generateMessageText } from '../utils/textUtils.js';

const BACKEND_URL = process.env.SERVER_URL;
const TMP_DIR = path.resolve('./tmp');

// Клавиатура выбора уровня
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
    
    let user = await prisma.user.upsert({ where: { id: chatId }, update: {}, create: { id: chatId } });

    const streakResult = await updateStreak(chatId);
    const streakToShow = streakResult.shouldNotify ? streakResult.count : 0;
    
    const currentState = userState.get(chatId) || 'IDLE';
    const currentLevel = user.level;

    if (currentState !== 'TESTING' && !currentLevel) {
      await bot.sendMessage(chatId, '⛔️ Please select your English level first:', { reply_markup: LEVEL_KEYBOARD });
      return;
    }

    await bot.sendChatAction(chatId, 'typing');
    let userText = msg.text;

    // STT (Voice to Text)
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
    }

    if (!userText || userText.trim().length < 2) {
      await bot.sendMessage(chatId, '👂 Couldn\'t hear you clearly. Try again!');
      return;
    }

    // TESTING MODE
    if (currentState === 'TESTING') {
      const res = await axios.post(`${BACKEND_URL}/api/assess-level`, { text: userText });
      const result = res.data;
      await prisma.user.update({ where: { id: chatId }, data: { level: result.level } });
      userState.set(chatId, 'IDLE'); 
      await bot.sendMessage(chatId, `🎯 <b>Level detected: ${result.level}</b>\n\n${result.reply || ''}`, { parse_mode: 'HTML' });
      return; 
    }

    // DIALOG CONTEXT & HISTORY
    if (prisma.message) {
        await prisma.message.create({ data: { userId: chatId, role: 'user', content: userText } });
    }

    let chatHistory = [];
    if (prisma.message) {
        const history = await prisma.message.findMany({ where: { userId: chatId }, orderBy: { createdAt: 'desc' }, take: 6 });
        chatHistory = history.reverse().map(m => ({ role: m.role, content: m.content }));
    } else {
        chatHistory = [{ role: 'user', content: userText }]; 
    }

    // AI CHAT REQUEST
    const chatRes = await axios.post(`${BACKEND_URL}/chat`, { messages: chatHistory, level: currentLevel });
    const data = chatRes.data;
    const aiMessage = data.message;
    const analysis = aiMessage.analysis;

    if (prisma.message && aiMessage.content) {
        await prisma.message.create({ data: { userId: chatId, role: 'assistant', content: aiMessage.content } });
    }

    // SEND RESPONSE
    if (analysis) {
        const msgText = generateMessageText(userText, analysis, 'simple', streakToShow);
        let row1 = [];
        if (!analysis.is_perfect && analysis.user_errors?.length > 0) row1.push({ text: 'Why?', callback_data: 'explain_mistakes' });
        if (analysis.better_alternatives?.length > 0) row1.push({ text: 'Native style', callback_data: 'show_alternatives' });
        
        const keyboard = { inline_keyboard: [row1].filter(r => r.length > 0) };
        const sentMsg = await bot.sendMessage(chatId, msgText, { parse_mode: 'HTML', reply_markup: keyboard });
        
        const sessionKey = `${chatId}_${sentMsg.message_id}`;
        analysis._user_text_cache = userText; 
        analysis._streak_cache = streakToShow; 
        analysis.reply = aiMessage.content || analysis.reply; 
        sessionStore.set(sessionKey, analysis);
    }

    // SMART TTS
    await bot.sendChatAction(chatId, 'record_voice');
    
    let textToSpeak = '';
    if (analysis) {
        if (!analysis.is_perfect && (analysis.corrected || analysis.corrected_text)) {
            textToSpeak = analysis.corrected || analysis.corrected_text;
        } else if (analysis.better_alternatives && analysis.better_alternatives.length > 0) {
            textToSpeak = analysis.better_alternatives[0];
        } else {
            textToSpeak = aiMessage.content;
        }
    } else {
        textToSpeak = aiMessage.content;
    }

    if (textToSpeak) {
        textToSpeak = textToSpeak.replace(/[*_~`]/g, '');
        if (textToSpeak.length > 200) textToSpeak = textToSpeak.substring(0, 197) + '...';
    }

    const audioUrl = data.audioUrl || aiMessage.audioUrl; 
    const isLowLevel = ['A1', 'A2'].includes(currentLevel || 'B1');
    let audioKeyboard = [];
    if (isLowLevel) audioKeyboard.push([{ text: '🇷🇺 Translate', callback_data: 'translate_audio_caption' }]);
    else audioKeyboard.push([{ text: '📝 Text', callback_data: 'show_audio_caption' }]);

    try {
        if (audioUrl) {
            const cleanPath = audioUrl.replace(/^\/audio\//, ''); 
            const localFilePath = path.resolve('./audio', cleanPath);
            let audioSource: any = fs.existsSync(localFilePath) ? fs.createReadStream(localFilePath) : `${BACKEND_URL}${audioUrl}`;
            analysis.reply = textToSpeak; 
            const sentAudioMsg = await bot.sendVoice(chatId, audioSource, { reply_markup: { inline_keyboard: audioKeyboard } });
            if (sentAudioMsg && analysis) sessionStore.set(`${chatId}_${sentAudioMsg.message_id}`, analysis);
        } else if (textToSpeak && textToSpeak.trim().length > 1) {
            const ttsRes = await axios.post(`${BACKEND_URL}/api/tts`, { text: textToSpeak });
            if (ttsRes.data.audioUrl) {
                const newAudioUrl = ttsRes.data.audioUrl;
                const cleanPath = newAudioUrl.replace(/^\/audio\//, ''); 
                const localFilePath = path.resolve('./audio', cleanPath);
                analysis.reply = textToSpeak; 
                const sentAudioMsg = await bot.sendVoice(chatId, fs.createReadStream(localFilePath), { reply_markup: { inline_keyboard: audioKeyboard } });
                if (sentAudioMsg && analysis) sessionStore.set(`${chatId}_${sentAudioMsg.message_id}`, analysis);
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