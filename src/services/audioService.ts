import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import { sessionStore } from '../lib/store.js';

const BACKEND_URL = process.env.SERVER_URL || 'http://localhost:3001';
const TMP_DIR = path.resolve('./tmp');

export async function processVoiceInput(bot: TelegramBot, fileId: string): Promise<string> {
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

export async function sendVoiceSafely(bot: TelegramBot, chatId: string, audioUrl: string, replyMarkup?: any, analysis?: any) {
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