import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../../lib/prisma.js';
import { sessionStore } from '../../lib/store.js';

export async function handleVocabularyCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery, action: string, chatId: string, messageId: number) {
    if (action.startsWith('add_word_')) {
        const rawWord = action.replace('add_word_', '');
        let wordData = null;
        
        for (const key of sessionStore.keys()) {
            if (key.startsWith(`vocab_${chatId}_`) && key.includes(rawWord.toLowerCase())) {
                wordData = sessionStore.get(key);
                break;
            }
        }

        if (!wordData) {
            wordData = { word: rawWord, translation: 'Saved', definition: 'Manual save', example: '' };
        }

        try {
            const existing = await prisma.vocabularyItem.findFirst({
                where: { userId: chatId, word: wordData.word } 
            });

            if (!existing) {
                await prisma.vocabularyItem.create({
                    data: {
                        userId: chatId,
                        word: wordData.word,
                        translation: wordData.translation,
                        definition: wordData.definition,
                        context: wordData.example 
                    }
                });
            }

            await bot.editMessageReplyMarkup({
                inline_keyboard: [[{ text: '✅ Saved', callback_data: 'noop' }]]
            }, { chat_id: chatId, message_id: messageId });
            
            await bot.answerCallbackQuery(query.id, { text: `"${wordData.word}" saved!` });
        } catch (e) {
            console.error("Save Word Error:", e);
            await bot.answerCallbackQuery(query.id, { text: "Error saving word." });
        }
    }
}