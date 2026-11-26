import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../../lib/prisma.js';
import { userState } from '../../lib/store.js';
import { generateSpeech } from '../../services/ai.js';
import { LEVEL_KEYBOARD } from '../../telegramBot.js';
import { HELP_TEXT, helpKeyboard, firstQuestion } from '../../lib/onboarding.js';

const VOICE_KEYBOARD = {
    inline_keyboard: [
        [{ text: '🇺🇸 Alloy (Neutral)', callback_data: 'preview_voice_alloy' }, { text: '🇺🇸 Echo (Male)', callback_data: 'preview_voice_echo' }],
        [{ text: '🇺🇸 Shimmer (Female)', callback_data: 'preview_voice_shimmer' }, { text: '🇬🇧 Fable (British)', callback_data: 'preview_voice_fable' }]
    ]
};

export async function handleSetupCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery, action: string, chatId: string, messageId: number) {
    if (action === 'wizard_start') {
        await bot.editMessageText('Шаг 1 из 2: <b>Выбери свой уровень английского</b> 📊', {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: LEVEL_KEYBOARD
        });
        await bot.answerCallbackQuery(query.id);
        return;
    }

    if (action.startsWith('set_level_')) {
        const level = action.replace('set_level_', '');
        await prisma.user.update({ where: { id: chatId }, data: { level: level } });
        await bot.editMessageText(`✅ Уровень <b>${level}</b> сохранен.\n\nШаг 2 из 2: <b>Выбери голос репетитора</b> 🗣\nНажми на кнопку, чтобы послушать пример.`, { 
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: VOICE_KEYBOARD
        });
        await bot.answerCallbackQuery(query.id);
        return;
    }

    if (action.startsWith('preview_voice_')) {
        const voiceName = action.replace('preview_voice_', '');
        const demoText = "Hello! I am your AI English tutor. I can help you improve your speaking skills. Do you like my voice?";
        
        try {
            await bot.sendChatAction(chatId, 'record_voice');
            const speech = await generateSpeech(demoText, voiceName, 'standard');
            
            if (speech.audioBuffer) {
                await bot.sendVoice(
                    chatId, speech.audioBuffer, 
                    {
                        caption: `🎧 Это голос <b>${voiceName}</b>.\nНравится?`,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✅ Выбрать этот', callback_data: `confirm_voice_${voiceName}` }],
                                [{ text: '⬅️ Назад к списку', callback_data: 'back_to_voices' }]
                            ]
                        }
                    },
                    { filename: 'preview.mp3', contentType: 'audio/mpeg' }
                );
            }
        } catch (e: any) {
            if (e.response?.body?.description?.includes('VOICE_MESSAGES_FORBIDDEN')) {
                await bot.sendMessage(chatId, '⚠️ У тебя в настройках Telegram Premium запрещены голосовые сообщения!', { parse_mode: 'HTML' });
            } else {
                console.error('Voice Preview Error:', e);
                await bot.sendMessage(chatId, '⚠️ Не удалось загрузить пример голоса. Попробуй позже.');
            }
        }
        await bot.answerCallbackQuery(query.id);
        return;
    }

    if (action === 'back_to_voices') {
        await bot.sendMessage(chatId, 'Шаг 2 из 2: <b>Выбери голос репетитора</b> 🗣', { parse_mode: 'HTML', reply_markup: VOICE_KEYBOARD });
        await bot.deleteMessage(chatId, messageId);
        await bot.answerCallbackQuery(query.id);
        return;
    }

    if (action.startsWith('confirm_voice_')) {
        const voice = action.replace('confirm_voice_', '');
        const user = await prisma.user.update({ where: { id: chatId }, data: { voice: voice } });
        await bot.answerCallbackQuery(query.id);
        await bot.deleteMessage(chatId, messageId).catch(() => {});

        // Короткая памятка и сразу первый вопрос — новичку не нужно придумывать, с чего начать
        await bot.sendMessage(chatId,
            `🎉 <b>Готово!</b> Уровень: <b>${user.level || '—'}</b>, голос: <b>${voice}</b>.\n\n` +
            `Как это работает:\n` +
            `🎙 Отвечай голосом или текстом по-английски\n` +
            `✍️ Под каждым ответом я покажу твою фразу с исправлениями\n` +
            `🇷🇺 Не знаешь, как сказать? Напиши по-русски — подскажу\n\n` +
            `Подробнее — /help. А теперь давай знакомиться 👇`,
            { parse_mode: 'HTML' });
        await bot.sendMessage(chatId, firstQuestion(user.level));
        await prisma.message.create({ data: { userId: chatId, role: 'assistant', text: firstQuestion(user.level) } }).catch(() => {});
        return;
    }

    if (action === 'show_help') {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, HELP_TEXT, { parse_mode: 'HTML', reply_markup: helpKeyboard });
        return;
    }

    if (action === 'start_test') {
        userState.set(chatId, 'TESTING');
        await bot.editMessageText('🧐 <b>Давай определим твой уровень!</b>\n\nПожалуйста, отправь мне небольшое голосовое сообщение (или текст) на английском. \n\nНапример, расскажи немного о себе: как тебя зовут, откуда ты, чем занимаешься или какое у тебя хобби.\n\n<i>Не бойся делать ошибки, просто говори как можешь! Я слушаю</i> 🎙', { 
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML' 
        });
        await bot.answerCallbackQuery(query.id);
        return;
    }

    // Предложение сменить уровень (еженедельная проверка прогресса)
    if (action.startsWith('level_accept_')) {
        const level = action.replace('level_accept_', '');
        if (!['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(level)) return bot.answerCallbackQuery(query.id);
        await prisma.user.update({ where: { id: chatId }, data: { level } });
        await bot.editMessageText(`✅ Готово! Теперь твой уровень — <b>${level}</b>. Продолжаем 💪`, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML'
        });
        await bot.answerCallbackQuery(query.id);
        return;
    }

    if (action === 'level_keep') {
        await bot.editMessageText('👌 Хорошо, оставляем текущий уровень.', { chat_id: chatId, message_id: messageId });
        await bot.answerCallbackQuery(query.id);
        return;
    }
}
