import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { sessionStore } from '../lib/store.js';
import { escapeHtml } from '../utils/textUtils.js';

export async function handleDictionaryHelper(bot: TelegramBot, chatId: string, messageId: number, userText: string, contextText = '') {
    try {
        const completion = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a dictionary helper for a Russian-speaking English learner. The user sends a word or phrase they saw in a message. Return JSON with: 'word' (base form, lowercase unless a proper noun), 'translation' (Russian, lowercase, the meaning IN THAT CONTEXT — e.g. 'garbage disposal' → 'измельчитель пищевых отходов', not a loose guess), 'definition' (simple English, max 10 words), 'example' (short natural usage sentence)." },
                { role: "user", content: `Define: "${userText}"${contextText ? `\nContext where the student saw it: "${contextText.slice(0, 500)}"` : ''}` }
            ],
            response_format: { type: "json_object" }
        }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });

        const data = JSON.parse(completion.data.choices[0].message.content);
        if (!data?.word) return;
        const replyText = `📖 <b>${escapeHtml(data.word)}</b> — ${escapeHtml(data.translation)}\n\n<i>${escapeHtml(data.definition)}</i>\nEx: <i>"${escapeHtml(data.example)}"</i>`;

        const sent = await bot.sendMessage(chatId, replyText, {
            parse_mode: 'HTML',
            reply_to_message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '➕ Add to Vocabulary', callback_data: 'add_word' }]] }
        });

        // Данные для кнопки привязаны к id отправленного сообщения и хранятся в БД
        await sessionStore.set(`vocab_${chatId}_${sent.message_id}`, data);
    } catch (e) {
        console.error("Vocab Error:", e);
    }
}