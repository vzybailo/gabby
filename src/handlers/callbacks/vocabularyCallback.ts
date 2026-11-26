import TelegramBot from 'node-telegram-bot-api';
import { sessionStore } from '../../lib/store.js';
import { saveVocabularyItem, type VocabEntry } from '../../services/vocabularyService.js';
import { isUserPremium } from '../../services/billingService.js';
import { buildAnalysisKeyboard } from '../analysisKeyboard.js';

const STALE_TEXT = 'Кнопка устарела — отправьте слово ещё раз 🙂';

export async function handleVocabularyCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery, action: string, chatId: string, messageId: number) {
    // ➕ под объяснением слова из словаря-помощника (данные лежат по id этого сообщения)
    if (action.startsWith('add_word')) {
        const wordData = await sessionStore.get<VocabEntry>(`vocab_${chatId}_${messageId}`);
        if (!wordData?.word) {
            await bot.answerCallbackQuery(query.id, { text: STALE_TEXT, show_alert: true });
            return;
        }

        try {
            const created = await saveVocabularyItem(chatId, wordData);
            await bot.editMessageReplyMarkup({
                inline_keyboard: [[{ text: '✅ Saved', callback_data: 'noop' }]]
            }, { chat_id: chatId, message_id: messageId });

            await bot.answerCallbackQuery(query.id, { text: created ? `"${wordData.word}" saved!` : `"${wordData.word}" уже в словаре` });
        } catch (e) {
            console.error("Save Word Error:", e);
            await bot.answerCallbackQuery(query.id, { text: "Error saving word." });
        }
        return;
    }

    // 📌 новое слово/идиома из ответа бота
    if (action.startsWith('save_vocab_')) {
        const index = Number(action.replace('save_vocab_', ''));
        const key = `${chatId}_${messageId}`;
        const analysis = await sessionStore.get<any>(key);
        const entry: VocabEntry | undefined = analysis?.new_vocabulary?.[index];

        if (!entry?.word) {
            await bot.answerCallbackQuery(query.id, { text: STALE_TEXT, show_alert: true });
            return;
        }

        try {
            const created = await saveVocabularyItem(chatId, entry);
            analysis.saved_vocab = Array.from(new Set([...(analysis.saved_vocab || []), index]));
            await sessionStore.set(key, analysis);

            const hasPremium = await isUserPremium(chatId);
            await bot.editMessageReplyMarkup(buildAnalysisKeyboard(analysis, hasPremium), { chat_id: chatId, message_id: messageId });
            await bot.answerCallbackQuery(query.id, { text: created ? `"${entry.word}" добавлено в словарь!` : `"${entry.word}" уже в словаре` });
        } catch (e) {
            console.error("Save vocab error:", e);
            await bot.answerCallbackQuery(query.id, { text: "Error saving word." });
        }
    }
}
