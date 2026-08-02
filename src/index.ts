import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { File } from 'node:buffer';
import OpenAI from 'openai';
import Stripe from 'stripe'; // <-- Добавлен импорт Stripe
import { prisma } from './lib/prisma.js';
import chatRouter from './routes/chat.js';
import transcribeRouter from './routes/transcribe.js';
import userRouter from './routes/user.js'; 
import { bot, triggerAction } from './telegramBot.js'; 
import { calculateReview } from './services/srs.js'; 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!); 

globalThis.File = File as any;

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001; 

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig as string, 
            process.env.STRIPE_WEBHOOK_SECRET as string
        );
    } catch (err: any) {
        console.error('⚠️ Ошибка подписи Webhook:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as any;
        const chatId = session.client_reference_id; 

        if (chatId) {
            try {
                let addedDays = 0;
                let description = '';

                if (session.amount_total <= 1000) { 
                    addedDays = 30;
                    description = 'Premium 1 Month (Stripe)';
                } else { 
                    addedDays = 365;
                    description = 'Premium 1 Year (Stripe)';
                }

                const user = await prisma.user.findUnique({ where: { id: chatId } });
                let newPremiumUntil = new Date();

                if (user?.isPremium && user?.premiumUntil && user.premiumUntil > new Date()) {
                    newPremiumUntil = new Date(user.premiumUntil);
                }
                newPremiumUntil.setDate(newPremiumUntil.getDate() + addedDays);

                await prisma.user.update({
                    where: { id: chatId },
                    data: {
                        isPremium: true,
                        premiumUntil: newPremiumUntil
                    }
                });

                await prisma.transaction.create({
                    data: {
                        userId: chatId,
                        provider: 'STRIPE',
                        amount: session.amount_total,
                        currency: session.currency.toUpperCase(),
                        status: 'SUCCESS',
                        providerTxId: session.payment_intent,
                        description: description
                    }
                });

                await bot.sendMessage(
                    chatId, 
                    `🎉 <b>Оплата картой прошла успешно!</b>\n\nТвой Premium активирован до <b>${newPremiumUntil.toLocaleDateString('ru-RU', {day: '2-digit', month: '2-digit', year: 'numeric'})}</b>.\n\nСпасибо за поддержку проекта! Теперь тебе доступны все голоса и безлимитные аудио. 🚀`, 
                    { parse_mode: 'HTML' }
                );

            } catch (dbError) {
                console.error('Ошибка БД в Stripe вебхуке:', dbError);
                await bot.sendMessage(chatId, '⚠️ Оплата прошла, но произошла задержка с активацией. Напиши в поддержку.');
            }
        }
    }

    res.json({ received: true });
});

app.get('/api/user/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'No user ID provided' });

    try {
        const user = await prisma.user.findUnique({
            where: { id: id.toString() },
            include: { dailyStats: true }
        });

        if (!user) return res.status(404).json({ error: 'User not found' });

        // 🟢 Собираем массив чистых YYYY-MM-DD строк
        const activeDatesSet = new Set(
            user.dailyStats
                ? user.dailyStats
                    .filter(s => (s.messagesCount > 0 || s.audioMinutes > 0 || s.wordsLearned > 0) && Boolean(s.date))
                    .map(s => new Date(s.date).toISOString().split('T')[0])
                : []
        );

        const activeDates = Array.from(activeDatesSet);

        // 🟢 Формируем даты по часовому поясу пользователя
        const userTimezone = user.timezone || 'UTC';
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: userTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const todayStr = formatter.format(now);
        
        // 🛡️ Безопасное извлечение чисел для TypeScript (гарантируем тип number)
        const parts = todayStr.split('-').map(Number);
        const y = parts[0] ?? now.getFullYear();
        const m = parts[1] ?? (now.getMonth() + 1);
        const d = parts[2] ?? now.getDate();

        const todayUTC = new Date(Date.UTC(y, m - 1, d));
        const yesterdayUTC = new Date(Date.UTC(y, m - 1, d - 1));
        const yesterdayStr = yesterdayUTC.toISOString().split('T')[0];

        let calculatedStreak = 0;
        let checkDate = new Date(todayUTC);

        const hasToday = activeDatesSet.has(todayStr);
        const hasYesterday = activeDatesSet.has(yesterdayStr);

        if (hasToday || hasYesterday) {
            if (!hasToday && hasYesterday) {
                checkDate = yesterdayUTC;
            }

            while (true) {
                const cStr = checkDate.toISOString().split('T')[0];
                if (activeDatesSet.has(cStr)) {
                    calculatedStreak++;
                    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
                } else {
                    break;
                }
            }
        }

        const isPremiumActive = Boolean(
            user.isPremium && user.premiumUntil && new Date(user.premiumUntil) > now
        );

        return res.json({
            id: user.id,
            first_name: user.username || 'Student',
            level: user.level || 'A1',
            voice: user.voice,
            speakingStyle: user.speakingStyle,
            streak: calculatedStreak,
            dates: activeDates,
            isPremium: isPremiumActive,
            premiumUntil: user.premiumUntil ? user.premiumUntil.toISOString() : null
        });

    } catch (error) {
        console.error('Error fetching user profile:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
app.use('/audio', express.static(path.resolve('audio')));

app.use('/chat', chatRouter);
app.use('/api', transcribeRouter);
app.use('/api/user', userRouter);

async function checkPremiumForProps(req: any, res: any, next: any) {
    const { userId, voice, speakingStyle } = req.body;
    if (!userId) return next();

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
        const { userId, voice, level, speakingStyle, timezone } = req.body;
        
        await prisma.user.update({
            where: { id: userId },
            data: { 
                voice: voice || undefined, 
                level: level || undefined,
                speakingStyle: speakingStyle || undefined,
                timezone: timezone || undefined
            }
        });

        res.json({ success: true });
    } catch (e) {
        console.error("Settings update error:", e);
        res.status(500).json({ error: 'Update failed' });
    }
});

app.post('/api/feedback', async (req, res) => {
    try {
        const { userId, text } = req.body;
        
        const ADMIN_ID = process.env.ADMIN_ID;
        if (ADMIN_ID) {
            await bot.sendMessage(ADMIN_ID, `📩 <b>Feedback</b> from <code>${userId}</code>:\n\n${text}`, { parse_mode: 'HTML' });
        }
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Feedback failed' });
    }
});

app.post('/api/topic', async (req, res) => {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "Give me a short, engaging conversation topic for an English learner. Just the topic/question." }]
        });
        const topic = completion.choices[0]?.message.content;
        res.json({ topic: topic || 'No topic generated' });
    } catch (e) {
        res.status(500).json({ error: 'Topic failed' });
    }
});

app.get('/api/vocabulary/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const words = await prisma.vocabularyItem.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ words });
    } catch (e) {
        res.status(500).json({ error: 'Fetch failed' });
    }
});

app.delete('/api/vocabulary/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.vocabularyItem.delete({
            where: { id }
        });
        res.json({ success: true });
    } catch (e) {
        console.error("Delete error:", e);
        res.status(500).json({ error: 'Delete failed' });
    }
});

app.get('/api/vocabulary/review/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const now = new Date();
        
        const words = await prisma.vocabularyItem.findMany({
            where: { 
                userId,
                nextReview: { lte: now }
            },
            take: 15, 
            orderBy: { nextReview: 'asc' }
        });
        
        res.json({ words });
    } catch (e) {
        res.status(500).json({ error: 'Fetch review failed' });
    }
});

app.post('/api/vocabulary/review/:id', async (req, res) => {
    try {
        const { wordId, quality } = req.body;
        
        const item = await prisma.vocabularyItem.findUnique({ where: { id: wordId } });
        if (!item) return res.status(404).json({ error: 'Not found' });

        const result = calculateReview({
            interval: item.interval,
            repetition: item.repetition,
            easeFactor: item.easeFactor
        }, quality);

        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + result.interval);

        await prisma.vocabularyItem.update({
            where: { id: wordId },
            data: {
                interval: result.interval,
                repetition: result.repetition,
                easeFactor: result.easeFactor,
                nextReview: nextDate
            }
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Review failed' });
    }
});

app.post('/api/bot-action', async (req, res) => {
    try {
        const { userId, action } = req.body;
        await triggerAction(userId, action);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/translate', async (req, res) => {
    try {
        const { text, targetLang } = req.body; 
        
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: `You are a translator. Translate the following text to ${targetLang || 'Russian'}. Keep the tone conversational.` },
                { role: "user", content: text }
            ]
        });

        const translation = completion.choices[0]?.message?.content || "Translation error";
        res.json({ translation });
    } catch (e) {
        console.error("Translation API Error:", e);
        res.status(500).json({ error: 'Translation failed' });
    }
});

app.post('/api/assess-level', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'No text provided' });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { 
                    role: "system", 
                    content: "You are an English language expert. Analyze the user's English level (A1, A2, B1, B2, C1, C2) based on the provided text. Return ONLY a JSON object with two fields: 'level' (the grade) and 'reply' (a very short encouraging comment in Russian about their level)." 
                },
                { role: "user", content: `Assess my level based on this: "${text}"` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
        
        console.log(`✅ Level Assessed: ${result.level} for text: ${text.substring(0, 30)}...`);
        res.json(result);
    } catch (e) {
        console.error("Level Assessment API Error:", e);
        res.status(500).json({ error: 'Assessment failed' });
    }
});

app.get('/api/create-stars-invoice', async (req, res) => {
    const userId = req.query.userId;
    const plan = req.query.plan;

    if (!userId) {
        return res.status(400).json({ error: 'No userId provided' });
    }

    try {
        let title = 'Premium (1 Месяц)';
        let description = 'Безлимитные сообщения, все голоса и продвинутая аналитика.';
        let payload = 'payload_premium_month_500';
        let amount = 1; 

        if (plan === 'year') {
            title = 'Premium (1 Год)';
            description = 'Все преимущества Premium на целый год со скидкой!';
            payload = 'payload_premium_year_2500';
            amount = 2500; 
        }

        const botToken = process.env.TELEGRAM_BOT_TOKEN; 
        const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                description: description,
                payload: payload,
                provider_token: '', 
                currency: 'XTR',  
                prices: [{ label: title, amount: amount }]
            })
        });

        const data = await telegramRes.json() as { ok: boolean; result?: string; description?: string };

        if (!data.ok || !data.result) {
            console.error('❌ Telegram API error:', data.description);
            return res.status(500).json({ error: data.description || 'Failed to create invoice link' });
        }

        console.log('✅ Сгенерирована ссылка Telegram Stars:', data.result);
        return res.json({ invoiceUrl: data.result });

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('❌ Ошибка генерации Stars инвойса:', errMsg);
        return res.status(500).json({ error: 'Failed to create invoice' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
