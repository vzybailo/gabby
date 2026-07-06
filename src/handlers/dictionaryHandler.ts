import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { sessionStore } from '../lib/store.js';

export async function handleDictionaryHelper(bot: TelegramBot, chatId: string, messageId: number, userText: string) {
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