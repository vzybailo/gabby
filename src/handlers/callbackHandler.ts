import TelegramBot from 'node-telegram-bot-api';
import { handleSetupCallback } from './callbacks/setupCallback.js';
import { handleVocabularyCallback } from './callbacks/vocabularyCallback.js';
import { handleAnalysisCallback } from './callbacks/analysisCallback.js';

export async function handleCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery) {
  const chatId = query.message?.chat.id.toString();
  const messageId = query.message?.message_id; 
  const action = query.data;

  if (!chatId || !messageId || !action) return;

  try {
    if (action === 'noop') {
        await bot.answerCallbackQuery(query.id);
        return;
    }

    if (
        action === 'wizard_start' ||
        action.startsWith('set_level_') ||
        action.startsWith('preview_voice_') ||
        action === 'back_to_voices' ||
        action.startsWith('confirm_voice_') ||
        action === 'start_test'
    ) {
        return await handleSetupCallback(bot, query, action, chatId, messageId);
    }

    if (action.startsWith('add_word_')) {
        return await handleVocabularyCallback(bot, query, action, chatId, messageId);
    }

    if (
        action === 'explain_mistakes' ||
        action === 'show_alternatives' ||
        action === 'collapse_text_view' ||
        action === 'translate_audio_caption' ||
        action === 'show_audio_caption' ||
        action === 'hide_audio_caption'
    ) {
        return await handleAnalysisCallback(bot, query, action, chatId, messageId);
    }

    await bot.answerCallbackQuery(query.id);

  } catch (e: any) {
    console.error('Callback Router Error:', e.message);
    try { await bot.answerCallbackQuery(query.id); } catch {}
  }
}