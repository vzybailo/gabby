import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios'; 
import * as Diff from 'diff';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const BACKEND_URL = process.env.SERVER_URL; 

const bot = new TelegramBot(TOKEN, { polling: true });

const TMP_DIR = path.resolve('./tmp');
const DB_FILE = path.resolve('./users.json');
const SESSIONS_FILE = path.resolve('./sessions.json');

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// --- DATABASE ---
let userSettings = new Map<string, string>();
let sessionStore = new Map<string, any>(); 

function loadData() {
  if (fs.existsSync(DB_FILE)) {
    try {
      userSettings = new Map(Object.entries(JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'))));
    } catch (e) { console.error('Error users.json:', e); }
  }
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      sessionStore = new Map(Object.entries(JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'))));
    } catch (e) { console.error('Error sessions.json:', e); }
  }
}

function saveUsers() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(Object.fromEntries(userSettings), null, 2)); } catch (e) { }
}

function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessionStore), null, 2)); } catch (e) { }
}

loadData();

const userState = new Map<string, 'IDLE' | 'TESTING'>(); 

const LEVEL_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🌱 A1', callback_data: 'set_level_A1' }, { text: '🌿 A2', callback_data: 'set_level_A2' }, { text: '🔥 B1', callback_data: 'set_level_B1' }],
    [{ text: '🚀 B2', callback_data: 'set_level_B2' }, { text: '💎 C1', callback_data: 'set_level_C1' }, { text: '👑 C2', callback_data: 'set_level_C2' }],
    [{ text: '🤷‍♂️ I don\'t know, check me!', callback_data: 'start_test' }]
  ]
};

// --- HELPER FUNCTIONS ---

function escapeHtml(unsafe: string | undefined | null): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 🔥 UPDATED: Logic to render visual difference
function buildDiff(original: string, corrected: string): string {
  const changes = Diff.diffWordsWithSpace(original, corrected);

  return changes.map(part => {
    const text = escapeHtml(part.value);
    if (part.removed) {
      return `~${text}~`; 
    }
    if (part.added) {
      return `*${text}*`;
    }
    return text;
  }).join('');
}

// 🔥 UPDATED: Converts markup to Telegram HTML
function formatDiffToHtml(text: string): string {
  let safeText = text;

  safeText = safeText.replace(/~([^~]+)~/g, '<s>$1</s>');
  safeText = safeText.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  safeText = safeText.replace(/<\/s>\s*<b>/g, '</s> <b>');

  return safeText;
}

function generateMessageText(
  userText: string,
  analysis: any,
  mode: 'simple' | 'expanded_errors' | 'expanded_alternatives'
): string {

  const safeUserText = escapeHtml(userText);
  let baseText = '';

  if (analysis.is_perfect) {
    baseText = `✅ <i>${safeUserText}</i>`;
  } else {
    const corrected = analysis.corrected || analysis.corrected_text || userText;
    const diffText = buildDiff(userText, corrected);
    const htmlDiff = formatDiffToHtml(diffText);
    
    baseText = `💡 <i>${htmlDiff}</i>`;
  }

  if (mode === 'simple') return baseText;

  if (mode === 'expanded_errors' && analysis.user_errors) {
    let errText = '';
    analysis.user_errors.forEach((err: any) => {
      const explanation = err.explanation_ru || err.explanation;
      
      errText += `\n\n🔻 <s>${escapeHtml(err.error_part)}</s> → <b>${escapeHtml(err.correction)}</b>`;
      errText += `\nℹ️ <i>${escapeHtml(explanation)}</i>`;
    });
    return baseText + errText;
  }

  if (mode === 'expanded_alternatives' && analysis.better_alternatives) {
    let altText = '\n';
    analysis.better_alternatives.forEach((alt: string) => {
      altText += `\n🔹 ${escapeHtml(alt)}`;
    });
    return baseText + altText;
  }

  return baseText;
}

// --- COMMANDS ---

bot.onText(/\/start|\/level/, async (msg) => {
  const chatId = msg.chat.id;
  userState.set(chatId.toString(), 'IDLE');
  await bot.sendMessage(chatId, '👋 <b>Welcome!</b> \n\nSelect your English level:', { parse_mode: 'HTML', reply_markup: LEVEL_KEYBOARD });
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id.toString();
  userSettings.delete(chatId);
  saveUsers(); 
  userState.delete(chatId);
  await bot.sendMessage(chatId, '🔄 Memory cleared!');
});

// --- MAIN CHAT LOGIC ---

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id;
  if (!msg.text && !msg.voice) return;

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
      } catch (err: any) { throw new Error(`STT Error: ${err.message}`); } 
      finally { if (fs.existsSync(oggIn)) fs.unlinkSync(oggIn); }
    }

    if (!userText || userText.trim().length < 2) {
      await bot.sendMessage(chatId, '👂 Couldn\'t hear you.');
      return;
    }

    if (currentState === 'TESTING') {
      const res = await axios.post(`${BACKEND_URL}/api/assess-level`, { text: userText });
      const result = res.data;
      userSettings.set(chatId.toString(), result.level);
      saveUsers();
      userState.set(chatId.toString(), 'IDLE'); 
      await bot.sendMessage(chatId, `🎯 Level detected: ${result.level}\n${result.reply || ''}`);
      return; 
    }

    // 3. AI Chat
    const currentLevel = userSettings.get(chatId.toString())!;
    
    const chatRes = await axios.post(`${BACKEND_URL}/chat`, {
      messages: [{ role: 'user', content: userText }],
      level: currentLevel
    });

    const data = chatRes.data;
    const aiMessage = data.message;
    const analysis = aiMessage.analysis;

    // --- SEND CORRECTION TEXT ---
    if (analysis) {
        const msgText = generateMessageText(userText, analysis, 'simple');

        let row1 = [];
        if (!analysis.is_perfect && analysis.user_errors?.length > 0) row1.push({ text: 'Why?', callback_data: 'explain_mistakes' });
        if (analysis.better_alternatives?.length > 0) row1.push({ text: 'Native style', callback_data: 'show_alternatives' });
        
        const keyboard = { inline_keyboard: [row1].filter(r => r.length > 0) };

        const sentMsg = await bot.sendMessage(chatId, msgText, { parse_mode: 'HTML', reply_markup: keyboard });
        
        const sessionKey = `${chatId}_${sentMsg.message_id}`;
        analysis._user_text_cache = userText; 
        analysis.reply = aiMessage.content || analysis.reply; 
        sessionStore.set(sessionKey, analysis);
        saveSessions();
    }

    // --- SEND AUDIO ---
    await bot.sendChatAction(chatId, 'record_voice');
    const audioUrl = data.audioUrl || aiMessage.audioUrl;

    const isLowLevel = ['A1', 'A2'].includes(currentLevel);
    let audioKeyboard = [];
    if (isLowLevel) {
        audioKeyboard.push([{ text: '🇷🇺 Translate', callback_data: 'translate_audio_caption' }]);
    } else {
        audioKeyboard.push([{ text: '📝 Text', callback_data: 'show_audio_caption' }]);
    }

    let sentAudioMsg;
    if (audioUrl) {
        try {
            const cleanPath = audioUrl.replace(/^\/audio\//, ''); 
            const localFilePath = path.resolve('./audio', cleanPath);
            let audioSource: any = fs.existsSync(localFilePath) ? fs.createReadStream(localFilePath) : `${BACKEND_URL}${audioUrl}`;

            sentAudioMsg = await bot.sendVoice(chatId, audioSource, { 
                reply_markup: { inline_keyboard: audioKeyboard } 
            });
        } catch (e: any) {
            await bot.sendMessage(chatId, `(Voice Error) ${escapeHtml(aiMessage.content)}`, { parse_mode: 'HTML' });
        }
    } else {
        try {
            const ttsRes = await axios.post(`${BACKEND_URL}/api/tts`, { text: aiMessage.content });
            if (ttsRes.data.audioUrl) {
                 sentAudioMsg = await bot.sendVoice(chatId, `${BACKEND_URL}${ttsRes.data.audioUrl}`, {
                    reply_markup: { inline_keyboard: audioKeyboard }
                 });
            }
        } catch (e) {
            // Fallback
        }
    }

    if (sentAudioMsg && analysis) {
        const audioSessionKey = `${chatId}_${sentAudioMsg.message_id}`;
        sessionStore.set(audioSessionKey, analysis);
        saveSessions();
    }

  } catch (err: any) {
    console.error('❌ Error:', err.message);
    await bot.sendMessage(chatId, `⚠️ Server Error`);
  }
});

// --- CALLBACKS ---

bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id.toString();
  const messageId = query.message?.message_id; 
  if (!chatId || !messageId) return;
  const action = query.data;

  try {
    if (action === 'start_test') { /* ... */ return; } 
    if (action?.startsWith('set_level_')) {
        const level = action.replace('set_level_', '');
        userSettings.set(chatId, level);
        saveUsers();
        await bot.editMessageText(`✅ Level set to: <b>${level}</b>`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
        await bot.answerCallbackQuery(query.id);
        return;
    }
    
    const sessionKey = `${chatId}_${messageId}`;
    const analysis = sessionStore.get(sessionKey);
    
    if (!analysis) {
        await bot.answerCallbackQuery(query.id, { text: 'Expired', show_alert: true });
        return;
    }

    const userText = analysis._user_text_cache || "Your text"; 
    const isLowLevel = ['A1', 'A2'].includes(userSettings.get(chatId) || 'B1');
    const backButtonText = { inline_keyboard: [[{ text: '⬅️ Collapse', callback_data: 'collapse_text_view' }]] };

    // --- BUTTON: WHY ---
    if (action === 'explain_mistakes') {
        if (isLowLevel && analysis.user_errors && !analysis.user_errors[0].explanation_ru) {
            try {
                const explanations = analysis.user_errors.map((e: any) => e.explanation).join(' ||| ');
                const transRes = await axios.post(`${BACKEND_URL}/api/translate`, { 
                    text: explanations, 
                    targetLang: 'Russian' 
                });
                const translatedString = transRes.data.translation || "";
                const translatedArray = translatedString.split('|||');

                analysis.user_errors.forEach((err: any, index: number) => {
                    if (translatedArray[index]) {
                        err.explanation_ru = translatedArray[index].trim();
                    }
                });

                sessionStore.set(sessionKey, analysis);
                saveSessions();

            } catch (e) {
                console.error("Translation error", e);
            }
        }

        const newText = generateMessageText(userText, analysis, 'expanded_errors');
        await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: backButtonText });
        await bot.answerCallbackQuery(query.id);
    }

    if (action === 'show_alternatives') {
        const newText = generateMessageText(userText, analysis, 'expanded_alternatives');
        await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: backButtonText });
        await bot.answerCallbackQuery(query.id);
    }

    if (action === 'collapse_text_view') {
        const newText = generateMessageText(userText, analysis, 'simple');
        let row1 = [];
        if (!analysis.is_perfect && analysis.user_errors?.length > 0) row1.push({ text: 'Why?', callback_data: 'explain_mistakes' });
        if (analysis.better_alternatives?.length > 0) row1.push({ text: 'Native style', callback_data: 'show_alternatives' });
        const keyboard = { inline_keyboard: [row1] };
        await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: keyboard });
        await bot.answerCallbackQuery(query.id);
    }

    // --- AUDIO BUTTONS ---
    const backButtonAudio = { inline_keyboard: [[{ text: '⬅️ Hide', callback_data: 'hide_audio_caption' }]] };

    if (action === 'translate_audio_caption') {
        if (!analysis._translation) {
            try {
                const transRes = await axios.post(`${BACKEND_URL}/api/translate`, { text: analysis.reply, targetLang: 'Russian' });
                analysis._translation = transRes.data.translation;
                sessionStore.set(sessionKey, analysis);
                saveSessions();
            } catch (e) { await bot.answerCallbackQuery(query.id, { text: 'Error', show_alert: true }); return; }
        }
        await bot.editMessageCaption(`${escapeHtml(analysis._translation)}`, { 
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: backButtonAudio 
        });
        await bot.answerCallbackQuery(query.id);
    }

    if (action === 'show_audio_caption') {
        await bot.editMessageCaption(`${escapeHtml(analysis.reply)}`, { 
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: backButtonAudio 
        });
        await bot.answerCallbackQuery(query.id);
    }

    if (action === 'hide_audio_caption') {
        let audioKeyboard = [];
        if (isLowLevel) audioKeyboard.push([{ text: 'Translate', callback_data: 'translate_audio_caption' }]);
        else audioKeyboard.push([{ text: 'Text', callback_data: 'show_audio_caption' }]);

        await bot.editMessageCaption('', { 
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: audioKeyboard } 
        });
        await bot.answerCallbackQuery(query.id);
    }

  } catch (e: any) {
    if (!e.message.includes('message is not modified')) console.error('Callback Error:', e);
    await bot.answerCallbackQuery(query.id);
  }
});