import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireSelf } from '../middleware/telegramAuth.js';
import { activeDates, calcStreak, calcBestStreak } from '../services/streakCalc.js';

// Монтируется после requireTelegramAuth: req.userId уже проверен.
const router = Router();

router.get('/:id', requireSelf('id'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const id = req.params.id as string;

    try {
        const user = await prisma.user.findUnique({
            where: { id },
            include: { dailyStats: true }
        });

        if (!user) return res.status(404).json({ error: 'User not found' });

        const dates = activeDates(user.dailyStats);
        const now = new Date();
        const isPremiumActive = Boolean(user.isPremium && user.premiumUntil && user.premiumUntil > now);

        return res.json({
            id: user.id,
            first_name: user.username || 'Student',
            level: user.level || 'A1',
            voice: user.voice,
            speakingStyle: user.speakingStyle,
            streak: calcStreak(dates, user.timezone || 'UTC', now),
            dates: Array.from(dates),
            isPremium: isPremiumActive,
            premiumUntil: user.premiumUntil ? user.premiumUntil.toISOString() : null
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:id/stats', requireSelf('id'), async (req, res) => {
    try {
        const id = req.params.id as string;

        const user = await prisma.user.findUnique({
            where: { id },
            include: { dailyStats: true }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const dates = activeDates(user.dailyStats);
        const currentStreak = calcStreak(dates, user.timezone || 'UTC');
        const bestStreak = calcBestStreak(dates);

        const [totalWords, learnedWords, activeWords, dueWords] = await Promise.all([
            prisma.vocabularyItem.count({ where: { userId: id } }),
            prisma.vocabularyItem.count({ where: { userId: id, repetition: { gte: 5 } } }),
            // Слова, которые пользователь сам употребил в разговоре
            prisma.vocabularyItem.count({ where: { userId: id, usedInChatCount: { gt: 0 } } }),
            prisma.vocabularyItem.count({ where: { userId: id, nextReview: { lte: new Date() } } })
        ]);

        const totalAudioMinutes = user.dailyStats.reduce((sum, stat) => sum + (stat.audioMinutes || 0), 0);

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentStats = user.dailyStats.filter(stat => new Date(stat.date) >= sevenDaysAgo && stat.messagesCount > 0);
        let avg7DaysScore = 0;
        if (recentStats.length > 0) {
            const totalScoreSum = recentStats.reduce((sum, stat) => sum + (stat.averageScore * stat.messagesCount), 0);
            const totalMessagesSum = recentStats.reduce((sum, stat) => sum + stat.messagesCount, 0);
            avg7DaysScore = totalMessagesSum > 0 ? Math.round(totalScoreSum / totalMessagesSum) : 0;
        }

        return res.json({
            streak: currentStreak,
            bestStreak,
            dueWords,
            totalMinutes: Math.round(totalAudioMinutes),
            learnedWords,
            totalWords,
            activeWords,
            avgScore: avg7DaysScore
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

export default router;
