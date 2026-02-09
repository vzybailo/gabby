import { prisma } from '../lib/prisma.js';

export async function updateStreak(chatId: string) {
    if (!prisma.user) return { count: 0, shouldNotify: false };

    const user = await prisma.user.findUnique({ where: { id: chatId } });
    if (!user) return { count: 0, shouldNotify: false };

    const now = new Date();
    const last = new Date(user.lastActivityAt);
    
    const todayDate = new Date(now.setHours(0,0,0,0)).getTime();
    const lastDate = new Date(last.setHours(0,0,0,0)).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    let newStreak = user.streakCount;
    let shouldNotify = false;

    if (todayDate !== lastDate) {
        shouldNotify = true;
        if (todayDate === lastDate + oneDayMs) {
            newStreak++;
        } else if (todayDate > lastDate + oneDayMs) {
            newStreak = 1;
        } else if (user.streakCount === 0) {
            newStreak = 1;
        }
    } 

    await prisma.user.update({
        where: { id: chatId },
        data: { streakCount: newStreak, lastActivityAt: new Date() }
    });

    return { count: newStreak, shouldNotify };
}