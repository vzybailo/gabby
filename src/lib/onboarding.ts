// Тексты и кнопки знакомства с ботом: приветствие, инструкция (/help), первый вопрос после настройки.
import type TelegramBot from 'node-telegram-bot-api';
import { escapeHtml } from '../utils/textUtils.js';

const BOT_USERNAME = process.env.BOT_USERNAME || 'SpeakWithMeNowBot';
export const MINI_APP_LINK = `https://t.me/${BOT_USERNAME}?startapp`;
export const MINI_APP_VOCAB_LINK = `https://t.me/${BOT_USERNAME}?startapp=vocab`;

export const TRIAL_DAYS = 3;

export function welcomeNewText(firstName: string): string {
    return `👋 <b>Привет, ${escapeHtml(firstName)}! Я Say It — твой собеседник для практики английского.</b>

Со мной можно говорить на любые темы и не бояться ошибок: я отвечаю как живой человек, мягко поправляю и помогаю звучать естественнее.

🎁 В подарок — <b>${TRIAL_DAYS} дня Premium</b>: безлимитные голосовые и подробный разбор ошибок.

Настроим всё за минуту 👇`;
}

export function welcomeBackText(firstName: string, level: string | null): string {
    return `👋 <b>С возвращением, ${escapeHtml(firstName)}!</b>${level ? ` Твой уровень: <b>${escapeHtml(level)}</b>.` : ''}

Просто напиши или скажи мне что-нибудь по-английски — и продолжим 🙂`;
}

export const welcomeNewKeyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [[{ text: '🚀 Начать настройку', callback_data: 'wizard_start' }]]
};

export const welcomeBackKeyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
        [{ text: '📚 Словарь и прогресс', url: MINI_APP_LINK }],
        [
            { text: '❓ Как пользоваться', callback_data: 'show_help' },
            { text: '⚙️ Настроить заново', callback_data: 'wizard_start' }
        ]
    ]
};

export const HELP_TEXT = `📖 <b>Как заниматься с Say It</b>

🎙 <b>Говори или пиши</b> по-английски на любую тему. Голосом — лучше всего: так тренируется речь.

✍️ <b>Под каждым сообщением</b> — твоя фраза с исправлениями.
• <b>Why?</b> — почему это ошибка
• <b>Native style</b> — как сказал бы носитель

🇷🇺 <b>Не знаешь, как сказать?</b> Напиши по-русски — я подскажу английский вариант.

📌 <b>Новые слова</b> сохраняй кнопкой «Сохранить» под моим ответом или ответь (Reply) на моё сообщение незнакомым словом.

🧠 <b>Повторяй слова</b> в мини-приложении (кнопка «Словарь»). А если используешь слово из словаря в разговоре — я это засчитаю.

🔥 <b>Занимайся каждый день</b> хотя бы 5 минут — так держится серия и быстрее растёт уровень.

<b>Команды:</b>
/start — главное меню
/help — эта инструкция
/level — сменить уровень`;

export const helpKeyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [[{ text: '📚 Открыть словарь', url: MINI_APP_VOCAB_LINK }]]
};

/** Первый вопрос после настройки, чтобы новичку не пришлось придумывать, с чего начать. */
export function firstQuestion(level: string | null): string {
    switch (level) {
        case 'A1':
        case 'A2':
            return "Hi! Nice to meet you 😊 What's your name, and where are you from?";
        case 'B1':
            return 'Hey! Great to meet you 😊 Tell me a bit about yourself — what do you do, and why are you learning English?';
        default:
            return "Hey there! 😊 So, what's been keeping you busy lately? Anything exciting going on?";
    }
}

export const BOT_COMMANDS: TelegramBot.BotCommand[] = [
    { command: 'start', description: 'Главное меню' },
    { command: 'help', description: 'Как пользоваться ботом' },
    { command: 'level', description: 'Сменить уровень английского' }
];
