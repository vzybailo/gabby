import { prisma } from '../lib/prisma.js';

export async function updateDailyStats(
    userId: string, 
    audioSeconds: number, 
    grammarScore: number, 
    wordsLearned: number = 0 
) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentStat = await prisma.dailyStats.findUnique({
        where: { userId_date: { userId, date: today } }
    });

    let newAvgScore = grammarScore;
    let newMsgCount = 1;

    if (currentStat) {
        newMsgCount = currentStat.messagesCount + 1;
        newAvgScore = ((currentStat.averageScore * currentStat.messagesCount) + grammarScore) / newMsgCount;
    }

    await prisma.dailyStats.upsert({
        where: { userId_date: { userId, date: today } },
        update: {
            messagesCount: { increment: 1 },
            audioMinutes: { increment: audioSeconds / 60 },
            averageScore: newAvgScore,
            wordsLearned: { increment: wordsLearned }
        },
        create: {
            userId,
            date: today,
            messagesCount: 1,
            audioMinutes: audioSeconds / 60,
            averageScore: grammarScore,
            wordsLearned: wordsLearned
        }
    });
}