import { Router } from 'express';
import { prisma } from '../lib/prisma.js'; 

const router = Router();

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    let user = await prisma.user.findUnique({
      where: { id },
      include: { vocabulary: true } 
    });

    if (!user) {
      return res.json({
        id: id,
        first_name: "Student",
        level: "A1",
        streak: 0,
        voice: "alloy",
        speakingStyle: "standard",
        mode: "chill",
        dates: []
      });
    }

    const stats = await prisma.dailyStats.findMany({
      where: { userId: id },
      select: { date: true }
    });
    
    const dates = stats.map(s => s.date.toISOString().split('T')[0]);

    res.json({
      id: user.id,
      first_name: user.username || "Student",
      level: user.level || "A1", 
      streak: user.streakCount,
      voice: user.voice,
      speakingStyle: user.speakingStyle,
      mode: user.mode,
      dates: dates
    });

  } catch (error) {
    console.error("User fetch error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

router.get('/:id/stats', async (req, res) => {
  const { id } = req.params;
  
  try {
    const totalStats = await prisma.dailyStats.aggregate({
      where: { userId: id },
      _sum: {
        audioMinutes: true,
        messagesCount: true,
      }
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentStats = await prisma.dailyStats.aggregate({
      where: { userId: id, date: { gte: sevenDaysAgo } },
      _avg: { averageScore: true }
    });
    
    let finalAvgScore = recentStats._avg.averageScore;
    if (!finalAvgScore) {
        const allTimeAvg = await prisma.dailyStats.aggregate({
            where: { userId: id },
            _avg: { averageScore: true }
        });
        finalAvgScore = allTimeAvg._avg.averageScore;
    }

    const realWordCount = await prisma.vocabularyItem.count({
        where: { userId: id }
    });

    const user = await prisma.user.findUnique({
      where: { id },
      select: { streakCount: true }
    });

    res.json({
      streak: user?.streakCount || 0,
      totalMinutes: Math.round(totalStats._sum.audioMinutes || 0),
      totalMessages: totalStats._sum.messagesCount || 0,
      
      wordsLearned: realWordCount, 
      
      avgScore: Math.round(finalAvgScore || 0)
    });

  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
