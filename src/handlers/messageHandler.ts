import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { sessionStore, userState } from '../lib/store.js';
import { updateStreak } from '../services/streakService.js';
import { generateMessageText, generateDiffView } from '../utils/textUtils.js';
import { getChatResponse, generateSpeech } from '../services/ai.js';
import { updateDailyStats } from '../services/statService.js';

const BACKEND_URL = process.env.SERVER_URL || 'http://localhost:3001';
const TMP_DIR = path.resolve('./tmp');

const LEVEL_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🌱 A1', callback_data: 'set_level_A1' }, { text: '🌿 A2', callback_data: 'set_level_A2' }, { text: '🔥 B1', callback_data: 'set_level_B1' }],
    [{ text: '🚀 B2', callback_data: 'set_level_B2' }, { text: '💎 C1', callback_data: 'set_level_C1' }, { text: '👑 C2', callback_data: 'set_level_C2' }],
    [{ text: '🤷‍♂️ I don\'t know, check me!', callback_data: 'start_test' }]
  ]
};

const VOICE_KEYBOARD = {
    inline_keyboard: [
        [{ text: '🇺🇸 Alloy (Neutral)', callback_data: 'preview_voice_alloy' }, { text: '🇺🇸 Echo (Male)', callback_data: 'preview_voice_echo' }],
        [{ text: '🇺🇸 Shimmer (Female)', callback_data: 'preview_voice_shimmer' }, { text: '🇬🇧 Fable (British)', callback_data: 'preview_voice_fable' }]
    ]
};

export async function handleMessage(bot: TelegramBot, msg: TelegramBot.Message) {
  if (msg.text?.startsWith('/')) return;
  const chatId = msg.chat.id.toString();

  if (!msg.text && !msg.voice) return;

  try {
    if (!prisma.user) throw new Error("Prisma Client broken");
    
    const user = await prisma.user.upsert({ where: { id: chatId }, update: {}, create: { id: chatId } });
    const streakResult = await updateStreak(chatId);
    const streakToShow = streakResult.shouldNotify ? streakResult.count : 0;
    const currentState = userState.get(chatId) || 'IDLE';

    if (!user.level && currentState !== 'TESTING') {
      return bot.sendMessage(chatId, '⛔️ <b>Сначала нужно выбрать уровень!</b>\n\nПожалуйста, выбери свой уровень в меню выше или нажми "Я не знаю", чтобы я мог настроить обучение под тебя.', { 
          parse_mode: 'HTML',
          reply_markup: LEVEL_KEYBOARD 
      });
    }

    await bot.sendChatAction(chatId, 'typing');

    let userText = msg.text || '';
    let audioDuration = msg.voice?.duration || 0; 

    if (msg.voice) {
        userText = await processVoiceInput(bot, msg.voice.file_id);
    }

    if (!userText || userText.trim().length < 2) {
      return bot.sendMessage(chatId, '👂 Couldn\'t hear you clearly. Try again!');
    }

    const cyrillicPattern = /[а-яА-ЯёЁїЇєЄіІ]/;
    if (cyrillicPattern.test(userText) && currentState !== 'TESTING') {
        return bot.sendMessage(chatId, '🇬🇧 <b>Oops!</b> I only understand English. Please speak or write in English to continue our practice!', { parse_mode: 'HTML' });
    }

    if (currentState === 'TESTING') {
        return await handleLevelTest(bot, chatId, userText);
    }

    if (user.mode === 'interview' && !user.interviewContext) {
        return await handleInterviewSetup(bot, chatId, user, userText);
    }

    if (user.mode === 'roleplay' && !user.roleplayContext) {
        return await handleRoleplaySetup(bot, chatId, user, userText);
    }

    if (prisma.message) {
        await prisma.message.create({ 
            data: { userId: chatId, role: 'user', text: userText, isAudio: !!msg.voice, audioDuration: audioDuration > 0 ? audioDuration : null } 
        });
    }

    if (msg.reply_to_message && msg.reply_to_message.from?.is_bot && userText.split(' ').length <= 5) {
        return await handleDictionaryHelper(bot, chatId, msg.message_id, userText);
    }

    await handleStandardChat(bot, chatId, user, userText, streakToShow, audioDuration);

  } catch (err: any) {
    console.error('❌ Bot Error:', err.message);
    await bot.sendMessage(chatId, `⚠️ Server Error: ${err.message}`);
  }
}

async function handleLevelTest(bot: TelegramBot, chatId: string, userText: string) {
    console.log(`🔍 Анализ уровня для ${chatId}. Текст: "${userText}"`);
    try {
        const res = await axios.post(`${BACKEND_URL}/api/assess-level`, { text: userText });
        const result = res.data;
        
        if (!result || !result.level) {
            throw new Error("Invalid API response");
        }

        const detectedLevel = result.level;
        
        await prisma.user.update({ where: { id: chatId }, data: { level: detectedLevel } });
        userState.set(chatId, 'IDLE'); 
        
        await bot.sendMessage(chatId, `🎯 <b>Твой уровень определен: ${detectedLevel}</b>\n\n${result.reply || ''}`, { parse_mode: 'HTML' });
        
        await bot.sendMessage(chatId, `Шаг 2 из 2: <b>Выбери голос репетитора</b> 🗣`, { 
            parse_mode: 'HTML',
            reply_markup: VOICE_KEYBOARD
        });
    } catch (error: any) {
        console.error("Test Error:", error.message);
        await bot.sendMessage(chatId, "⚠️ <b>Не удалось распознать уровень.</b>\n\nПопробуй сказать еще раз на английском (более 5-7 слов), чтобы я мог тебя оценить.", { parse_mode: 'HTML' });
    }
}

async function handleInterviewSetup(bot: TelegramBot, chatId: string, user: any, userText: string) {
    if (userText.length <= 2) {
        return bot.sendMessage(chatId, "💼 To start <b>Interview Mode</b>, please type the <b>Job Position</b> (e.g. <i>Barista</i>).", { parse_mode: 'HTML' });
    }
    
    await prisma.user.update({ where: { id: chatId }, data: { interviewContext: userText } });
    const startPrompt = `I am applying for the position of ${userText}. Please start the interview now.`;
    const tempSettings = { mode: 'interview', level: user.level || 'A1', voice: user.voice || 'alloy', speakingStyle: user.speakingStyle || 'standard', interviewContext: userText };

    const aiResponse = await getChatResponse([{ role: 'user', content: startPrompt }], tempSettings);
    if (prisma.message) await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: aiResponse.reply } });

    await bot.sendMessage(chatId, `💼 <b>Interview Started: ${userText}</b>\n\n${aiResponse.reply}`, { parse_mode: 'HTML' });
    const speech = await generateSpeech(aiResponse.reply, user.voice || 'alloy', user.speakingStyle || 'standard');
    
    if (speech.audioUrl) await sendVoiceSafely(bot, chatId, speech.audioUrl);
}

async function handleRoleplaySetup(bot: TelegramBot, chatId: string, user: any, userText: string) {
    if (userText.length <= 3) {
        return bot.sendMessage(chatId, "🎭 To start <b>Roleplay</b>, please choose a scenario above OR describe your own.", { parse_mode: 'HTML' });
    }
    
    await prisma.user.update({ where: { id: chatId }, data: { roleplayContext: userText } });
    const startPrompt = `Let's start a roleplay. Scenario: ${userText}. You start first!`;
    const tempSettings = { mode: 'roleplay', level: user.level || 'A1', voice: user.voice || 'alloy', speakingStyle: user.speakingStyle || 'standard', roleplayContext: userText };

    const aiResponse = await getChatResponse([{ role: 'user', content: startPrompt }], tempSettings);
    if (prisma.message) await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: aiResponse.reply } });

    await bot.sendMessage(chatId, `🎬 <b>Scenario:</b> ${userText}\n\n${aiResponse.reply}`, { parse_mode: 'HTML' });
    const speech = await generateSpeech(aiResponse.reply, user.voice || 'alloy', user.speakingStyle || 'standard');
    
    if (speech.audioUrl) await sendVoiceSafely(bot, chatId, speech.audioUrl);
}

async function handleDictionaryHelper(bot: TelegramBot, chatId: string, messageId: number, userText: string) {
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
        
        sessionStore.set(`vocab_${chatId}_${data.word.toLowerCase()}`, data); 

        await bot.sendMessage(chatId, replyText, {
            parse_mode: 'HTML',
            reply_to_message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '➕ Add to Vocabulary', callback_data: `add_word_${data.word.substring(0, 20)}` }]] }
        });
    } catch (e) {
        console.error("Vocab Error:", e);
    }
}

async function handleStandardChat(bot: TelegramBot, chatId: string, user: any, userText: string, streakToShow: number, audioDuration: number) {
    let chatHistory = [];
    if (prisma.message) {
        const history = await prisma.message.findMany({ where: { userId: chatId }, orderBy: { createdAt: 'desc' }, take: 6 });
        chatHistory = history.reverse().map(m => ({ role: m.role as 'user'|'assistant', content: m.text }));
    } else {
        chatHistory = [{ role: 'user' as const, content: userText }]; 
    }

    const userSettings = { mode: user.mode || 'chill', level: user.level || 'A1', voice: user.voice || 'alloy', speakingStyle: user.speakingStyle || 'standard', interviewContext: user.interviewContext, roleplayContext: user.roleplayContext };
    const aiResponse = await getChatResponse(chatHistory, userSettings);
    
    let grammarScore = aiResponse.grammarScore ?? Math.max(0, 100 - ((aiResponse.user_errors?.length || 0) * 10));

    const analysis = {
        is_perfect: aiResponse.is_correct,
        corrected_text: aiResponse.corrected,
        diff_view: generateDiffView(userText, aiResponse.corrected),
        user_errors: aiResponse.user_errors,
        better_alternatives: aiResponse.better_alternatives,
        reply: aiResponse.reply,
        grammarScore: grammarScore,
        _user_text_cache: userText,
        _streak_cache: streakToShow
    };

    if (prisma.message && aiResponse.reply) {
        await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: aiResponse.reply, grammarScore: grammarScore, grammarFixes: aiResponse.user_errors } });
        updateDailyStats(chatId, audioDuration, grammarScore).catch(e => console.error("Stats update error:", e));
    }

    const msgText = generateMessageText(userText, analysis, 'simple', streakToShow);
    let row1 = [];
    if (!analysis.is_perfect && analysis.user_errors?.length > 0) row1.push({ text: 'Why?', callback_data: 'explain_mistakes' });
    if (analysis.better_alternatives?.length > 0) row1.push({ text: 'Native style', callback_data: 'show_alternatives' });
    
    const sentMsg = await bot.sendMessage(chatId, msgText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [row1].filter(r => r.length > 0) } });
    sessionStore.set(`${chatId}_${sentMsg.message_id}`, analysis);

    await bot.sendChatAction(chatId, 'record_voice');
    let textToSpeak = aiResponse.reply || '';
    if (textToSpeak) textToSpeak = textToSpeak.replace(/[*_~`]/g, '').substring(0, 797);

    try {
        if (textToSpeak && textToSpeak.trim().length > 1) {
            const speech = await generateSpeech(textToSpeak, userSettings.voice, userSettings.speakingStyle);
            if (speech.audioUrl) {
                const isLowLevel = ['A1', 'A2'].includes(userSettings.level || 'B1');
                const audioKeyboard = isLowLevel ? [{ text: '🇷🇺 Translate', callback_data: 'translate_audio_caption' }] : [{ text: '📝 Text', callback_data: 'show_audio_caption' }];
                
                await sendVoiceSafely(bot, chatId, speech.audioUrl, { inline_keyboard: [audioKeyboard] }, analysis);
            }
        }
    } catch (e: any) {
        console.error('TTS Error:', e.message);
    }
}

async function processVoiceInput(bot: TelegramBot, fileId: string): Promise<string> {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    const fileLink = await bot.getFileLink(fileId);
    const oggIn = path.join(TMP_DIR, `in_${fileId}.ogg`);
    
    const voiceFile = await axios.get(fileLink, { responseType: 'arraybuffer' });
    fs.writeFileSync(oggIn, Buffer.from(voiceFile.data));
    
    const formData = new FormData();
    formData.append('audio', fs.createReadStream(oggIn), { filename: 'voice.ogg' });
    
    try {
        const tRes = await axios.post(`${BACKEND_URL}/api/transcribe`, formData, { headers: { ...formData.getHeaders() } });
        return tRes.data.text;
    } catch (err: any) { 
        throw new Error(`STT Error: ${err.message}`); 
    } finally { 
        if (fs.existsSync(oggIn)) fs.unlinkSync(oggIn); 
    }
}

async function sendVoiceSafely(bot: TelegramBot, chatId: string, audioUrl: string, replyMarkup?: any, analysis?: any) {
    const cleanPath = audioUrl.replace(/^\/audio\//, '');
    const localFilePath = path.resolve('./audio', cleanPath);

    if (!fs.existsSync(localFilePath)) return;

    try {
        const options: any = {};
        if (replyMarkup) options.reply_markup = replyMarkup;

        const sentAudioMsg = await bot.sendVoice(chatId, fs.createReadStream(localFilePath), options);
        if (sentAudioMsg && analysis) {
            sessionStore.set(`${chatId}_${sentAudioMsg.message_id}`, analysis);
        }
    } catch (telegramError: any) {
        if (telegramError.response?.body?.description?.includes('VOICE_MESSAGES_FORBIDDEN')) {
            await bot.sendMessage(chatId, '⚠️ <b>Внимание:</b> У тебя в настройках Telegram Premium запрещены голосовые сообщения!\n\nПожалуйста, добавь этого бота в исключения (Настройки -> Конфиденциальность -> Голосовые сообщения), иначе я не смогу отвечать голосом.', { parse_mode: 'HTML' });
        } else {
            console.error('TTS Send Error:', telegramError.message);
        }
    } finally {
        const isPreviewFile = ['alloy.mp3', 'echo.mp3', 'fable.mp3', 'nova.mp3', 'onyx.mp3', 'shimmer.mp3'].includes(cleanPath);
        if (!isPreviewFile && fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
    }
}