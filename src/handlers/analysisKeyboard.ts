import type TelegramBot from 'node-telegram-bot-api';

/** Кнопки под сообщением с разбором: Why? / Native style и сохранение новых слов из ответа бота. */
export function buildAnalysisKeyboard(analysis: any, hasPremium: boolean): TelegramBot.InlineKeyboardMarkup {
    const rows: TelegramBot.InlineKeyboardButton[][] = [];
    const row1: TelegramBot.InlineKeyboardButton[] = [];

    if (!analysis.is_perfect && analysis.user_errors?.length > 0) {
        row1.push({ text: hasPremium ? 'Why?' : '🔒 Why?', callback_data: 'explain_mistakes' });
    }
    if (analysis.better_alternatives?.length > 0) {
        row1.push({ text: hasPremium ? 'Native style' : '🔒 Native style', callback_data: 'show_alternatives' });
    }
    if (row1.length > 0) rows.push(row1);

    const saved: number[] = analysis.saved_vocab || [];
    (analysis.new_vocabulary || []).forEach((v: any, i: number) => {
        const label = saved.includes(i) ? `✅ ${v.word}` : `📌 Сохранить: ${v.word}`;
        rows.push([{ text: label.slice(0, 60), callback_data: saved.includes(i) ? 'noop' : `save_vocab_${i}` }]);
    });

    return { inline_keyboard: rows };
}
