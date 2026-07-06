import TelegramBot from 'node-telegram-bot-api';
import FormData from 'form-data';
import axios from 'axios';
import { sessionStore } from '../lib/store.js';

const BACKEND_URL = process.env.SERVER_URL || 'http://localhost:3001';

export async function processVoiceInput(bot: TelegramBot, fileId: string): Promise<string> {
    const fileLink = await bot.getFileLink(fileId);
    const voiceFile = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const voiceBuffer = Buffer.from(voiceFile.data);
    const formData = new FormData();

    formData.append('audio', voiceBuffer, { 
        filename: 'voice.ogg',
        contentType: 'audio/ogg' 
    });
    
    try {
        const tRes = await axios.post(`${BACKEND_URL}/api/transcribe`, formData, { 
            headers: { ...formData.getHeaders() } 
        });
        return tRes.data.text;
    } catch (err: any) { 
        throw new Error(`STT Error: ${err.message}`); 
    }
}

export async function sendVoiceSafely(bot: TelegramBot, chatId: string, audioBuffer: Buffer, replyMarkup?: any, analysis?: any) {
    try {
        const options: any = {};
        if (replyMarkup) options.reply_markup = replyMarkup;

        const fileOptions = {
            filename: 'voice.mp3',
            contentType: 'audio/mpeg',
        };

        const sentAudioMsg = await bot.sendVoice(chatId, audioBuffer, options, fileOptions);
        
        if (sentAudioMsg && analysis) {
            sessionStore.set(`${chatId}_${sentAudioMsg.message_id}`, analysis);
        }
    } catch (telegramError: any) {
        if (telegramError.response?.body?.description?.includes('VOICE_MESSAGES_FORBIDDEN')) {
            await bot.sendMessage(chatId, '⚠️ <b>Внимание:</b> У тебя в настройках Telegram Premium запрещены голосовые сообщения!', { parse_mode: 'HTML' });
        } else {
            console.error('TTS Send Error:', telegramError.message);
        }
    }
}