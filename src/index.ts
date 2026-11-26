import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { File } from 'node:buffer';
import { prisma } from './lib/prisma.js';
import chatRouter from './routes/chat.js';
import transcribeRouter from './routes/transcribe.js';
import userRouter from './routes/user.js';
import { bot, triggerAction } from './telegramBot.js';
import { calculateReview, normalizeQuality } from './services/srs.js';
import tributeRouter from './routes/tribute.js';
import { requireTelegramAuth, requireSelf } from './middleware/telegramAuth.js';
import { aiLimiter, aiDailyLimiter, rateLimit } from './middleware/rateLimit.js';
import { translateText, assessLevelText, generateTopic } from './services/aiTools.js';
import { escapeHtml } from './utils/textUtils.js';
import { MASTERED_REPETITION } from './services/vocabularyService.js';

globalThis.File = File as any;

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// За nginx/прокси — чтобы req.ip был реальным адресом клиента (для лимитов)
app.set('trust proxy', 1);

// Tribute webhook needs the raw body for signature verification, so it is mounted before express.json()
app.use('/api', tributeRouter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(cors());

const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
app.use('/audio', express.static(path.resolve('audio')));

// ---------- Всё ниже требует подписанный Telegram initData ----------
app.use('/chat', requireTelegramAuth, aiLimiter, aiDailyLimiter, chatRouter);
app.use('/api', transcribeRouter);
app.use('/api/user', requireTelegramAuth, userRouter);
app.use(['/api/settings', '/api/feedback', '/api/topic', '/api/vocabulary', '/api/bot-action', '/api/translate', '/api/assess-level'], requireTelegramAuth);

const feedbackLimiter = rateLimit({ name: 'feedback', windowMs: 60 * 60_000, max: 5 });

async function checkPremiumForProps(req: any, res: any, next: any) {
    const { voice, speakingStyle } = req.body;
    const userId = req.userId as string;

    const premiumVoices = ['echo', 'shimmer', 'onyx', 'nova', 'fable'];
    const premiumStyles = ['friend', 'street'];

    const needsPremium = premiumVoices.includes(voice) || premiumStyles.includes(speakingStyle);

    if (needsPremium) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const now = new Date();
        const hasPremium = user?.isPremium && user?.premiumUntil && user.premiumUntil > now;

        if (!hasPremium) {
            return res.status(403).json({ error: 'Premium required for this setting' });
        }
    }
    next();
}

app.post('/api/settings', checkPremiumForProps, async (req, res) => {
    try {
        const { voice, level, speakingStyle, timezone } = req.body;
        const userId = req.userId!;

        // updateMany doesn't throw when the user hasn't pressed /start yet
        const result = await prisma.user.updateMany({
            where: { id: userId },
            data: {
                voice: voice || undefined,
                level: level || undefined,
                speakingStyle: speakingStyle || undefined,
                timezone: timezone || undefined
            }
        });

        if (result.count === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true });
    } catch (e) {
        console.error("Settings update error:", e);
        res.status(500).json({ error: 'Update failed' });
    }
});

app.post('/api/feedback', feedbackLimiter, async (req, res) => {
    try {
        const text = String(req.body.text || '').slice(0, 3000);
        if (!text.trim()) return res.status(400).json({ error: 'Empty feedback' });

        const ADMIN_ID = process.env.ADMIN_ID;
        if (ADMIN_ID) {
            await bot.sendMessage(ADMIN_ID, `📩 <b>Feedback</b> from <code>${escapeHtml(req.userId)}</code>:\n\n${escapeHtml(text)}`, { parse_mode: 'HTML' });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Feedback failed' });
    }
});

app.post('/api/topic', aiLimiter, aiDailyLimiter, async (req, res) => {
    try {
        res.json({ topic: await generateTopic() });
    } catch (e) {
        res.status(500).json({ error: 'Topic failed' });
    }
});

app.get('/api/vocabulary/:id', requireSelf('id'), async (req, res) => {
    try {
        const words = await prisma.vocabularyItem.findMany({
            where: { userId: req.userId! },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ words });
    } catch (e) {
        res.status(500).json({ error: 'Fetch failed' });
    }
});

// :id здесь — id слова; удалить можно только своё
app.delete('/api/vocabulary/:id', async (req, res) => {
    try {
        const { count } = await prisma.vocabularyItem.deleteMany({
            where: { id: req.params.id, userId: req.userId! }
        });
        if (count === 0) return res.status(404).json({ error: 'Word not found' });
        res.json({ success: true });
    } catch (e) {
        console.error("Delete error:", e);
        res.status(500).json({ error: 'Delete failed' });
    }
});

app.get('/api/vocabulary/review/:id', requireSelf('id'), async (req, res) => {
    try {
        const words = await prisma.vocabularyItem.findMany({
            where: {
                userId: req.userId!,
                nextReview: { lte: new Date() }
            },
            take: 15,
            orderBy: { nextReview: 'asc' }
        });

        res.json({ words });
    } catch (e) {
        res.status(500).json({ error: 'Fetch review failed' });
    }
});

app.post('/api/vocabulary/review/:id', requireSelf('id'), async (req, res) => {
    try {
        const { wordId } = req.body;
        const quality = normalizeQuality(req.body.quality);

        if (!wordId || quality === null) {
            return res.status(400).json({ error: 'wordId and quality (0-5) are required' });
        }

        const item = await prisma.vocabularyItem.findUnique({
            where: { id: wordId }
        });

        if (!item || item.userId !== req.params.id) {
            return res.status(404).json({
                error: 'Word not found'
            });
        }

        const wasMastered = item.repetition >= MASTERED_REPETITION;
        const result = calculateReview(
            {
                interval: item.interval,
                repetition: item.repetition,
                easeFactor: item.easeFactor
            },
            quality
        );

        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + result.interval);

        const updatedWord = await prisma.vocabularyItem.update({
            where: {
                id: wordId
            },
            data: {
                interval: result.interval,
                repetition: result.repetition,
                easeFactor: result.easeFactor,
                nextReview
            }
        });

        const masteredNow = !wasMastered && result.repetition >= MASTERED_REPETITION;

        return res.json({
            success: true,
            mastered: masteredNow,
            word: updatedWord.word,
            repetition: updatedWord.repetition,
            interval: updatedWord.interval
        });

    } catch (e) {
        console.error('Vocabulary review error:', e);

        return res.status(500).json({
            error: 'Review failed'
        });
    }
});

app.post('/api/bot-action', async (req, res) => {
    try {
        const { action } = req.body;
        await triggerAction(req.userId!, action);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/translate', aiLimiter, aiDailyLimiter, async (req, res) => {
    try {
        const text = String(req.body.text || '').slice(0, 2000);
        if (!text) return res.status(400).json({ error: 'No text provided' });
        res.json({ translation: await translateText(text, req.body.targetLang || 'Russian') });
    } catch (e) {
        console.error("Translation API Error:", e);
        res.status(500).json({ error: 'Translation failed' });
    }
});

app.post('/api/assess-level', aiLimiter, aiDailyLimiter, async (req, res) => {
    try {
        const text = String(req.body.text || '').slice(0, 2000);
        if (!text) return res.status(400).json({ error: 'No text provided' });
        res.json(await assessLevelText(text));
    } catch (e) {
        console.error("Level Assessment API Error:", e);
        res.status(500).json({ error: 'Assessment failed' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
