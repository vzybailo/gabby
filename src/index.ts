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
// <-- Инициализация Stripe с твоим секретным ключом
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!); 

globalThis.File = File as any;

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001; 

// ==========================================
// ВАЖНО: Вебхук Stripe ДОЛЖЕН быть до express.json()
// ==========================================
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // Проверяем криптографическую подпись Stripe
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig as string, 
            process.env.STRIPE_WEBHOOK_SECRET as string
        );
    } catch (err: any) {
        console.error('⚠️ Ошибка подписи Webhook:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Обрабатываем только успешную оплату
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as any;
        const chatId = session.client_reference_id; // Достаем ID пользователя

        if (chatId) {
            try {
                let addedDays = 0;
                let description = '';

                // Определяем тариф по сумме (в центах)
                if (session.amount_total <= 1000) { 
                    addedDays = 30;
                    description = 'Premium 1 Month (Stripe)';
                } else { 
                    addedDays = 365;
                    description = 'Premium 1 Year (Stripe)';
                }

                // 1. Обновляем статус в базе
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

                // 2. Создаем транзакцию
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

                // 3. Отправляем уведомление юзеру
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
// ==========================================


// Глобальные парсеры для остальных роутов
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
app.use('/audio', express.static(path.resolve('audio')));

app.use('/chat', chatRouter);
app.use('/api', transcribeRouter);
app.use('/api/user', userRouter);

app.post('/api/settings', async (req, res) => {
    try {
        const { userId, voice, level, speakingStyle, timezone } = req.body;
        const oldUser = await prisma.user.findUnique({ where: { id: userId } });
        
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Обработчик для создания инвойса Stars из Mini App
app.get('/api/create-stars-invoice', async (req, res) => {
    const userId = req.query.userId;
    const plan = req.query.plan; // Придет 'month' или 'year'

    if (!userId) {
        return res.status(400).json({ error: 'No userId provided' });
    }

    try {
        // 1. Настраиваем цены и описание в зависимости от тарифа
        let title = 'Premium (1 Месяц)';
        let description = 'Безлимитные сообщения, все голоса и продвинутая аналитика.';
        let payload = 'payload_premium_month_500';
        let amount = 500; 

        if (plan === 'year') {
            title = 'Premium (1 Год)';
            description = 'Все преимущества Premium на целый год со скидкой!';
            payload = 'payload_premium_year_2500';
            amount = 2500; 
        }

        // 2. Генерируем ссылку на оплату через Telegram API
        const invoiceUrl = await bot.createInvoiceLink(
            title,
            description,
            payload, // Уникальный идентификатор платежа
            '', // ВАЖНО: Для Telegram Stars токен провайдера должен быть пустой строкой!
            'XTR', // ВАЖНО: XTR - это официальный код валюты Telegram Stars
            [{ label: title, amount: amount }]
        );

        // 3. Отправляем готовую ссылку обратно в Mini App
        res.json({ invoiceUrl });

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('❌ Ошибка генерации Stars инвойса на бэкенде:', errMsg);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});