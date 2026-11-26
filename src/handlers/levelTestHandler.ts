import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';
import { userState } from '../lib/store.js';
import { assessLevelText } from '../services/aiTools.js';


const VOICE_KEYBOARD = {
    inline_keyboard: [
        [{ text: '🇺🇸 Alloy (Neutral)', callback_data: 'preview_voice_alloy' }, { text: '🇺🇸 Echo (Male)', callback_data: 'preview_voice_echo' }],
        [{ text: '🇺🇸 Shimmer (Female)', callback_data: 'preview_voice_shimmer' }, { text: '🇬🇧 Fable (British)', callback_data: 'preview_voice_fable' }]
    ]
};

export async function handleLevelTest(bot: TelegramBot, chatId: string, userText: string) {
    console.log(`🔍 Анализ уровня для ${chatId}. Текст: "${userText}"`);
    try {
        const result = await assessLevelText(userText);
        
        if (!result || !result.level) {
            throw new Error("Invalid API response");
        }

        // Модель иногда отвечает «A0» или «B1+» — приводим к допустимым уровням
        const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const raw = String(result.level).toUpperCase().match(/[ABC][0-2]/)?.[0] || 'A1';
        const detectedLevel = LEVELS.includes(raw) ? raw : (raw.startsWith('C') ? 'C1' : 'A1');
        
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