import { Router } from 'express';
import { prisma } from '../lib/prisma.js'; 

const router = Router();

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Missing user id' });
  }

  try {
    let user = await prisma.user.findUnique({
      where: { id },
      include: { vocabulary: true } 
    });

    const now = new Date();

    if (!user) {
      return res.json({
        id: id,
        first_name: "Student",
        level: "A1",
        streak: 0,
        voice: "alloy",
        speakingStyle: "standard",
        mode: "chill",
        dates: [],
        isPremium: false 
      });
    }

    const stats = await prisma.dailyStats.findMany({
      where: { userId: id },
      select: { date: true }
    });
    
    const dates = stats.map(s => s.date.toISOString().split('T')[0]);
    const hasPremium = !!(user.isPremium && user.premiumUntil && user.premiumUntil > now);

    res.json({
      id: user.id,
      first_name: user.username || "Student",
      level: user.level || "A1", 
      streak: user.streakCount,
      voice: user.voice,
      speakingStyle: user.speakingStyle,
      dates: dates,
      isPremium: hasPremium 
    });

  } catch (error) {
    console.error("User fetch error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

router.get('/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            include: { dailyStats: true }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // 🟢 Хелпер получения локальной даты YYYY-MM-DD
        const toLocalDateStr = (d: Date | string): string => {
            const dateObj = new Date(d);
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        // Собираем Set с локальными датами
        const activeDatesSet = new Set<string>(
            user.dailyStats
                .filter((s: { messagesCount: number; audioMinutes: number; wordsLearned?: number; date: Date | string }) => 
                    (s.messagesCount > 0 || (s.audioMinutes && s.audioMinutes > 0) || (s.wordsLearned && s.wordsLearned > 0)) && Boolean(s.date)
                )
                .map((s: { date: Date | string }): string => toLocalDateStr(s.date))
        );

        const today = new Date();
        const todayStr = toLocalDateStr(today);
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = toLocalDateStr(yesterday);

        let currentStreak = 0;
        let checkDate = new Date(today);

        const hasToday = activeDatesSet.has(todayStr);
        const hasYesterday = activeDatesSet.has(yesterdayStr);

        if (hasToday || hasYesterday) {
            // Если сегодня еще не занимался, но занимался вчера — считаем со вчера
            if (!hasToday && hasYesterday) {
                checkDate = yesterday;
            }

            while (activeDatesSet.has(toLocalDateStr(checkDate))) {
                currentStreak++;
                checkDate.setDate(checkDate.getDate() - 1); 
            }
        } else {
            currentStreak = 0;
        }

        const totalWords = await prisma.vocabularyItem.count({
            where: { userId: id }
        });

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
            totalMinutes: Math.round(totalAudioMinutes),
            wordsLearned: totalWords,
            avgScore: avg7DaysScore
        });

    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

export default router;