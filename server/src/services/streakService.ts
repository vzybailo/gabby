import { prisma } from '../lib/prisma.js';

export async function updateStreak(chatId: string) {
    if (!prisma.user) return { count: 0, shouldNotify: false };

    const user = await prisma.user.findUnique({ where: { id: chatId } });
    if (!user) return { count: 0, shouldNotify: false };

    const userTimezone = user.timezone || 'UTC';
    const now = new Date();
    
    const getSafeDateString = (date: Date, timeZone: string) => {
        return new Intl.DateTimeFormat('en-CA', { 
            timeZone: timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(date);
    };

    const todayStr = getSafeDateString(now, userTimezone);
    const lastActivityStr = getSafeDateString(new Date(user.lastActivityAt), userTimezone);

    if (todayStr === lastActivityStr) {
        return { count: user.streakCount, shouldNotify: false };
    }

    let newStreak = user.streakCount;
    let shouldNotify = true; 
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = getSafeDateString(yesterdayDate, userTimezone);

    if (lastActivityStr === yesterdayStr) {
        newStreak++;
    } else {
        newStreak = 1;
    }

    await prisma.user.update({
        where: { id: chatId },
        data: { 
            streakCount: newStreak, 
            lastActivityAt: now 
        }
    });

    return { count: newStreak, shouldNotify };
}