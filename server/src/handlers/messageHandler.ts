import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import * as Diff from 'diff'; 
import { prisma } from '../lib/prisma.js';
import { sessionStore, userState } from '../lib/store.js';
import { updateStreak } from '../services/streakService.js';
import { generateMessageText } from '../utils/textUtils.js';
import { getChatResponse, generateSpeech } from '../services/ai.js';

const BACKEND_URL = process.env.SERVER_URL || 'http://localhost:3001';
const TMP_DIR = path.resolve('./tmp');

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
    
    let user = await prisma.user.upsert({ where: { id: chatId }, update: {}, create: { id: chatId } });

    const streakResult = await updateStreak(chatId);
    const streakToShow = streakResult.shouldNotify ? streakResult.count : 0;
    
    const currentState = userState.get(chatId) || 'IDLE';

    if (currentState !== 'TESTING' && !user.level) {
      await bot.sendMessage(chatId, '⛔️ Please select your English level first:', { reply_markup: LEVEL_KEYBOARD });
      return;
    }

    await bot.sendChatAction(chatId, 'typing');
    let userText = msg.text || '';

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

    if (currentState === 'TESTING') {
      const res = await axios.post(`${BACKEND_URL}/api/assess-level`, { text: userText });
      const result = res.data;
      await prisma.user.update({ where: { id: chatId }, data: { level: result.level } });
      userState.set(chatId, 'IDLE'); 
      await bot.sendMessage(chatId, `🎯 <b>Level detected: ${result.level}</b>\n\n${result.reply || ''}`, { parse_mode: 'HTML' });
      return; 
    }

    if (user.mode === 'interview' && !user.interviewContext) {
        if (userText.length > 2) {
             user = await prisma.user.update({
                 where: { id: chatId },
                 data: { interviewContext: userText }
             });
             
             const startPrompt = `I am applying for the position of ${userText}. Please start the interview now.`;
             
             const tempSettings = {
                 mode: 'interview',
                 level: user.level || 'A1',
                 voice: user.voice || 'alloy',
                 speakingStyle: user.speakingStyle || 'standard',
                 interviewContext: userText
             };

             const aiResponse = await getChatResponse([{ role: 'user', content: startPrompt }], tempSettings);

             if (prisma.message) {
                 await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: aiResponse.reply } });
             }

             await bot.sendMessage(chatId, `💼 <b>Interview Started: ${userText}</b>\n\n${aiResponse.reply}`, { parse_mode: 'HTML' });

             const speech = await generateSpeech(aiResponse.reply, user.voice || 'alloy', user.speakingStyle || 'standard');
             if (speech.audioUrl) {
                 const cleanPath = speech.audioUrl.replace(/^\/audio\//, '');
                 const localFilePath = path.resolve('./audio', cleanPath);
                 if (fs.existsSync(localFilePath)) await bot.sendVoice(chatId, fs.createReadStream(localFilePath));
             }
             return; 
        } else {
             await bot.sendMessage(chatId, "💼 To start <b>Interview Mode</b>, please type the <b>Job Position</b> (e.g. <i>Barista</i>).", { parse_mode: 'HTML' });
             return;
        }
    }

    if (user.mode === 'roleplay' && !user.roleplayContext) {
        if (userText.length > 3) {
             const customScenario = userText;
             
             user = await prisma.user.update({
                 where: { id: chatId },
                 data: { roleplayContext: customScenario }
             });

             const startPrompt = `Let's start a roleplay. Scenario: ${customScenario}. You start first!`;
             
             const tempSettings = {
                 mode: 'roleplay',
                 level: user.level || 'A1',
                 voice: user.voice || 'alloy',
                 speakingStyle: user.speakingStyle || 'standard',
                 roleplayContext: customScenario
             };

             const aiResponse = await getChatResponse([{ role: 'user', content: startPrompt }], tempSettings);

             if (prisma.message) {
                 await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: aiResponse.reply } });
             }

             await bot.sendMessage(chatId, `🎬 <b>Scenario:</b> ${customScenario}\n\n${aiResponse.reply}`, { parse_mode: 'HTML' });
             
             const speech = await generateSpeech(aiResponse.reply, user.voice || 'alloy', user.speakingStyle || 'standard');
             if (speech.audioUrl) {
                 const cleanPath = speech.audioUrl.replace(/^\/audio\//, '');
                 const localFilePath = path.resolve('./audio', cleanPath);
                 if (fs.existsSync(localFilePath)) await bot.sendVoice(chatId, fs.createReadStream(localFilePath));
             }
             return;
        } else {
             await bot.sendMessage(chatId, "🎭 To start <b>Roleplay</b>, please choose a scenario above OR describe your own (e.g., <i>Buying tickets at the cinema</i>).", { parse_mode: 'HTML' });
             return;
        }
    }

    if (prisma.message) {
        await prisma.message.create({ data: { userId: chatId, role: 'user', text: userText } });
    }

    if (msg.reply_to_message && msg.reply_to_message.from?.is_bot) {
        const wordsCount = userText.split(' ').length;
        
        if (wordsCount <= 5) {
            try {
                const completion = await axios.post('https://api.openai.com/v1/chat/completions', {
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: "You are a dictionary helper. The user sends a word. Return a JSON with: 'word' (cleaned), 'translation' (Russian), 'definition' (Simple English, max 10 words), 'example' (Short usage sentence)." },
                        { role: "user", content: `Define: "${userText}"` }
                    ],
                    response_format: { type: "json_object" }
                }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });

                const data = JSON.parse(completion.data.choices[0].message.content);
                const replyText = `📖 <b>${data.word}</b> — ${data.translation}\n\nRunning: <i>${data.definition}</i>\nEx: <i>"${data.example}"</i>`;
                
                const callbackData = `add_word_${data.word.substring(0, 20)}`; 
                
                const sessionKey = `vocab_${chatId}_${data.word.toLowerCase()}`;
                sessionStore.set(sessionKey, data); 

                await bot.sendMessage(chatId, replyText, {
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id,
                    reply_markup: {
                        inline_keyboard: [[{ text: '➕ Add to Vocabulary', callback_data: callbackData }]]
                    }
                });
                return; 
            } catch (e) {
                console.error("Vocab Error:", e);
            }
        }
    }

    let chatHistory = [];
    if (prisma.message) {
        const history = await prisma.message.findMany({ where: { userId: chatId }, orderBy: { createdAt: 'desc' }, take: 6 });
        chatHistory = history.reverse().map(m => ({ role: m.role as 'user'|'assistant', content: m.text }));
    } else {
        chatHistory = [{ role: 'user' as const, content: userText }]; 
    }

    const userSettings = {
        mode: user.mode || 'chill',
        level: user.level || 'A1',
        voice: user.voice || 'alloy',             
        speakingStyle: user.speakingStyle || 'standard',
        interviewContext: user.interviewContext,
        roleplayContext: user.roleplayContext 
    };

    const aiResponse = await getChatResponse(chatHistory, userSettings);
    
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

    if (prisma.message && aiResponse.reply) {
        await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: aiResponse.reply } });
    }

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