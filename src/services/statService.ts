import { prisma } from '../lib/prisma.js';

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

    // 2. Считываем все активные даты пользователя
    const allUserStats = await prisma.dailyStats.findMany({
        where: { 
            userId,
            OR: [
                { messagesCount: { gt: 0 } },
                { audioMinutes: { gt: 0 } },
                { wordsLearned: { gt: 0 } }
            ]
        },
        select: { date: true }
    });

    const activeDatesSet = new Set(
        allUserStats.map(s => s.date.toISOString().split('T')[0])
    );

    // Вчерашний день
    const yesterdayDate = new Date(today);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

    let newStreak = 0;
    let checkDate = new Date(today);

    const hasToday = activeDatesSet.has(todayStr);
    const hasYesterday = activeDatesSet.has(yesterdayStr);

    if (hasToday || hasYesterday) {
        if (!hasToday && hasYesterday) {
            checkDate = yesterdayDate;
        }

        while (true) {
            const cStr = checkDate.toISOString().split('T')[0];
            if (activeDatesSet.has(cStr)) {
                newStreak++;
                checkDate.setUTCDate(checkDate.getUTCDate() - 1);
            } else {
                break;
            }
        }
    }

    // 3. Сохраняем обновленные данные
    return await prisma.user.update({
        where: { id: userId },
        data: {
            streakCount: newStreak,
            lastActivityAt: now,
            totalMinutes: { increment: Math.round(minutesToAdd) },
            wordsLearned: { increment: wordsLearned }
        }
    });
}