import { prisma } from '../lib/prisma.js';
import { activeDates, calcStreak } from './streakCalc.js';

export async function updateDailyStats(
    userId: string, 
    audioSeconds: number = 0, 
    grammarScore: number = 0, 
    wordsLearned: number = 0 
) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true }
    });
    
    const userTimezone = user?.timezone || 'UTC';
    const now = new Date();

    // 🟢 Формируем чистую строку "YYYY-MM-DD" за СЕГОДНЯ по часовому поясу
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: userTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const todayStr = formatter.format(now); // Строго "2026-07-31"

    // 🎯 Создаем дату ровно в UTC midnight ИСКЛЮЧИТЕЛЬНО из строки
    const today = new Date(`${todayStr}T00:00:00.000Z`);

    const minutesToAdd = audioSeconds > 0 ? audioSeconds / 60 : 0;

    const currentStat = await prisma.dailyStats.findUnique({
        where: { userId_date: { userId, date: today } }
    });

    let newAvgScore = grammarScore;
    let newMsgCount = currentStat ? currentStat.messagesCount + 1 : 1;

    if (currentStat && grammarScore > 0) {
        newAvgScore = currentStat.averageScore > 0 
            ? ((currentStat.averageScore * currentStat.messagesCount) + grammarScore) / newMsgCount
            : grammarScore;
    } else if (currentStat && grammarScore === 0) {
        newAvgScore = currentStat.averageScore;
    }

    // 1. Сохраняем статистику
    await prisma.dailyStats.upsert({
        where: { userId_date: { userId, date: today } },
        update: {
            messagesCount: { increment: 1 },
            audioMinutes: { increment: minutesToAdd },
            averageScore: newAvgScore,
            wordsLearned: { increment: wordsLearned }
        },
        create: {
            userId,
            date: today,
            messagesCount: 1,
            audioMinutes: minutesToAdd,
            averageScore: grammarScore,
            wordsLearned: wordsLearned
        }
    });

    // 2. Пересчитываем серию по активным датам (общая функция для всего приложения)
    const allUserStats = await prisma.dailyStats.findMany({
        where: { userId },
        select: { date: true, messagesCount: true, audioMinutes: true, wordsLearned: true }
    });

    const newStreak = calcStreak(activeDates(allUserStats), userTimezone, now);

    // 3. Сохраняем обновленные данные
    return await prisma.user.update({
        where: { id: userId },
        data: {
            streakCount: newStreak,
            lastActivityAt: now,
        }
    });
}
