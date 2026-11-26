import { prisma } from '../lib/prisma.js';
import { activeDates, calcStreak, localDateString } from './streakCalc.js';

/**
 * Вызывается при каждом сообщении в боте. Отмечает активность и возвращает серию,
 * а shouldNotify = true только для первого сообщения за день (чтобы показать 🔥 один раз).
 */
export async function updateStreak(chatId: string) {
    if (!prisma.user) return { count: 0, shouldNotify: false };

    const user = await prisma.user.findUnique({ where: { id: chatId } });
    if (!user) return { count: 0, shouldNotify: false };

    const timezone = user.timezone || 'UTC';
    const now = new Date();
    const todayStr = localDateString(now, timezone);

    if (localDateString(new Date(user.lastActivityAt), timezone) === todayStr) {
        return { count: user.streakCount, shouldNotify: false };
    }

    const stats = await prisma.dailyStats.findMany({
        where: { userId: chatId },
        select: { date: true, messagesCount: true, audioMinutes: true, wordsLearned: true }
    });
    const dates = activeDates(stats);
    dates.add(todayStr); // сегодняшнее сообщение уже считается активностью

    const count = calcStreak(dates, timezone, now);

    await prisma.user.update({
        where: { id: chatId },
        data: { streakCount: count, lastActivityAt: now }
    });

    return { count, shouldNotify: true };
}
