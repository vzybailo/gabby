import { prisma } from '../lib/prisma.js';

export async function isUserPremium(chatId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: chatId } });
    if (!user) return false;
    return Boolean(user.isPremium && user.premiumUntil && user.premiumUntil > new Date());
}

export async function checkAudioLimit(chatId: string): Promise<{ allowed: boolean; reason?: string }> {
    const user = await prisma.user.findUnique({ where: { id: chatId } });
    if (!user) return { allowed: false, reason: 'User not found' };

    const now = new Date();

    if (user.isPremium && user.premiumUntil && user.premiumUntil > now) {
        return { allowed: true };
    }

    const lastReset = user.lastTokenReset;
    const isSameDay = lastReset.getUTCFullYear() === now.getUTCFullYear() &&
                      lastReset.getUTCMonth() === now.getUTCMonth() &&
                      lastReset.getUTCDate() === now.getUTCDate();

    let currentTokens = user.audioTokens;

    if (!isSameDay) {
        currentTokens = 15;
        await prisma.user.update({
            where: { id: chatId },
            data: { audioTokens: currentTokens, lastTokenReset: now }
        });
    }

    if (currentTokens > 0) {
        await prisma.user.update({
            where: { id: chatId },
            data: { audioTokens: { decrement: 1 } }
        });
        return { allowed: true };
    }

    return { 
        allowed: false, 
        reason: 'Твои 15 бесплатных аудио на сегодня закончились 🛑\nЛимит обновится завтра.' 
    };
}