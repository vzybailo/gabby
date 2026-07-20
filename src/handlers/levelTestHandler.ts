import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { userState } from '../lib/store.js';

const BACKEND_URL = process.env.SERVER_URL || 'http://localhost:3001';

const VOICE_KEYBOARD = {
    inline_keyboard: [
        [{ text: '🇺🇸 Alloy (Neutral)', callback_data: 'preview_voice_alloy' }, { text: '🇺🇸 Echo (Male)', callback_data: 'preview_voice_echo' }],
        [{ text: '🇺🇸 Shimmer (Female)', callback_data: 'preview_voice_shimmer' }, { text: '🇬🇧 Fable (British)', callback_data: 'preview_voice_fable' }]
    ]
};

export async function handleLevelTest(bot: TelegramBot, chatId: string, userText: string) {
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