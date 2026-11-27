import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';
import { sessionStore } from '../lib/store.js';
import { buildErrorDigest } from '../services/aiTools.js';
import { escapeHtml } from '../utils/textUtils.js';
import { localDateString } from '../services/streakCalc.js';
import { miniAppButton } from '../lib/onboarding.js';

function pluralRu(n: number, one: string, few: string, many: string): string {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
}


const REVIEW_REMINDER_HOUR = 12;      // местное время пользователя
const REVIEW_MIN_DUE = 5;             // напоминаем, только если накопилось столько слов
const DIGEST_WEEKDAY = 0;             // воскресенье
const DIGEST_HOUR = 18;
const DIGEST_MIN_ERRORS = 5;
const ACTIVE_WITHIN_DAYS = 14;        // не беспокоим тех, кто давно не заходил
const LEVEL_CHECK_HOUR = 17;          // воскресенье, до разбора ошибок
const LEVEL_MIN_MESSAGES = 30;        // за 2 недели
const LEVEL_UP_SCORE = 92;
const LEVEL_UP_MIN_WORDS = 8;         // средняя длина сообщения — признак развёрнутой речи
const LEVEL_DOWN_SCORE = 55;
const LEVEL_SUGGEST_COOLDOWN_DAYS = 21;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function localHourAndWeekday(now: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hour: '2-digit', hour12: false, weekday: 'short'
    }).formatToParts(now);
    const hour = Number(parts.find(p => p.type === 'hour')?.value) % 24;
    const weekdayName = parts.find(p => p.type === 'weekday')?.value || 'Sun';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
    return { hour, weekday };
}

function sameLocalDay(a: Date | null, b: Date, timezone: string) {
    return !!a && localDateString(a, timezone) === localDateString(b, timezone);
}

async function sendReviewReminder(bot: TelegramBot, userId: string, now: Date) {
    const due = await prisma.vocabularyItem.count({ where: { userId, nextReview: { lte: now } } });
    if (due < REVIEW_MIN_DUE) return;

    await bot.sendMessage(userId,
        `🧠 <b>${due} ${pluralRu(due, 'слово ждёт', 'слова ждут', 'слов ждут')} повторения</b>\n\nПара минут сейчас — и они останутся в памяти надолго.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[miniAppButton('🧠 Начать тренировку', 'vocab')]] } }
    );
    await prisma.user.update({ where: { id: userId }, data: { lastReviewReminderAt: now } });
}

async function sendErrorDigest(bot: TelegramBot, userId: string, now: Date) {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const messages = await prisma.message.findMany({
        where: { userId, role: 'assistant', createdAt: { gte: weekAgo } },
        select: { grammarFixes: true }
    });

    const errors = messages.flatMap(m => (Array.isArray(m.grammarFixes) ? m.grammarFixes as any[] : []))
        .filter(e => e && e.error_part && e.correction);

    // Отмечаем попытку в любом случае, чтобы не пересчитывать каждый час
    await prisma.user.update({ where: { id: userId }, data: { lastErrorDigestAt: now } });
    if (errors.length < DIGEST_MIN_ERRORS) return;

    const items = await buildErrorDigest(errors);
    if (items.length === 0) return;

    const body = items.map((it, i) =>
        `<b>${i + 1}. ${escapeHtml(it.pattern)}</b>\n` +
        `${escapeHtml(it.explanation)}\n` +
        `❌ <s>${escapeHtml(it.example_wrong)}</s>\n` +
        `✅ <b>${escapeHtml(it.example_right)}</b>\n` +
        `✍️ <i>${escapeHtml(it.practice)}</i>`
    ).join('\n\n');

    await bot.sendMessage(userId,
        `📊 <b>Твои частые ошибки за неделю</b>\n\n${body}\n\nОтветь мне прямо здесь — потренируемся 💪`,
        { parse_mode: 'HTML' }
    );
}

async function maybeSuggestLevelChange(bot: TelegramBot, userId: string, level: string | null, now: Date) {
    const idx = LEVELS.indexOf(level || '');
    if (idx === -1) return;

    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const [scored, userMsgs] = await Promise.all([
        prisma.message.findMany({
            where: { userId, role: 'assistant', createdAt: { gte: twoWeeksAgo }, grammarScore: { not: null } },
            select: { grammarScore: true }
        }),
        prisma.message.findMany({
            where: { userId, role: 'user', createdAt: { gte: twoWeeksAgo } },
            select: { text: true }
        })
    ]);
    if (scored.length < LEVEL_MIN_MESSAGES) return;

    const avgScore = scored.reduce((s, m) => s + (m.grammarScore || 0), 0) / scored.length;
    const avgWords = userMsgs.reduce((s, m) => s + m.text.split(/\s+/).filter(Boolean).length, 0) / Math.max(1, userMsgs.length);

    let target: string | null = null;
    let text = '';
    if (avgScore >= LEVEL_UP_SCORE && avgWords >= LEVEL_UP_MIN_WORDS && idx < LEVELS.length - 1) {
        target = LEVELS[idx + 1]!;
        text = `🚀 <b>Ты растёшь!</b>\n\nЗа последние 2 недели средняя точность — <b>${Math.round(avgScore)}%</b>, и ты отвечаешь развёрнуто.\nПохоже, тебе уже по силам <b>${target}</b>: я буду говорить чуть сложнее и использовать больше живых выражений.`;
    } else if (avgScore <= LEVEL_DOWN_SCORE && idx > 0) {
        target = LEVELS[idx - 1]!;
        text = `🤝 <b>Давай немного упростим?</b>\n\nСейчас много ошибок (точность ~${Math.round(avgScore)}%) — так учиться тяжело.\nНа уровне <b>${target}</b> я буду говорить проще, и прогресс пойдёт быстрее.`;
    }

    await prisma.user.update({ where: { id: userId }, data: { lastLevelSuggestAt: now } });
    if (!target) return;

    await bot.sendMessage(userId, text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                { text: `✅ Перейти на ${target}`, callback_data: `level_accept_${target}` },
                { text: `Остаться на ${level}`, callback_data: 'level_keep' }
            ]]
        }
    });
}

export function initLearningReminders(bot: TelegramBot) {
    // Каждый час: напоминание о повторении слов и еженедельный разбор ошибок
    cron.schedule('5 * * * *', async () => {
        const now = new Date();
        const activeSince = new Date(now.getTime() - ACTIVE_WITHIN_DAYS * 24 * 60 * 60 * 1000);

        try {
            const users = await prisma.user.findMany({
                where: { lastActivityAt: { gte: activeSince } },
                select: { id: true, timezone: true, level: true, lastReviewReminderAt: true, lastErrorDigestAt: true, lastLevelSuggestAt: true }
            });

            for (const user of users) {
                const tz = user.timezone || 'UTC';
                try {
                    const { hour, weekday } = localHourAndWeekday(now, tz);

                    if (hour === REVIEW_REMINDER_HOUR && !sameLocalDay(user.lastReviewReminderAt, now, tz)) {
                        await sendReviewReminder(bot, user.id, now);
                    }

                    const levelCooldownOver = !user.lastLevelSuggestAt ||
                        now.getTime() - user.lastLevelSuggestAt.getTime() > LEVEL_SUGGEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
                    if (weekday === DIGEST_WEEKDAY && hour === LEVEL_CHECK_HOUR && levelCooldownOver) {
                        await maybeSuggestLevelChange(bot, user.id, user.level, now);
                    }

                    if (weekday === DIGEST_WEEKDAY && hour === DIGEST_HOUR && !sameLocalDay(user.lastErrorDigestAt, now, tz)) {
                        await sendErrorDigest(bot, user.id, now);
                    }
                } catch (e) {
                    console.error(`❌ Learning reminder error for ${user.id}:`, e);
                }
            }
        } catch (e) {
            console.error('❌ Learning reminders cron error:', e);
        }
    });

    // Раз в сутки чистим старые данные кнопок
    cron.schedule('30 3 * * *', async () => {
        try {
            const removed = await sessionStore.cleanup();
            console.log(`🧹 BotSession cleanup: removed ${removed}`);
        } catch (e) {
            console.error('❌ BotSession cleanup error:', e);
        }
    });

    console.log('✅ Learning reminders initialized');
}
