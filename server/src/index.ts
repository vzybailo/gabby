import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { File } from 'node:buffer';
import OpenAI from 'openai';
import { prisma } from './lib/prisma.js';
import chatRouter from './routes/chat.js';
import transcribeRouter from './routes/transcribe.js';
import userRouter from './routes/user.js'; 
import { bot, triggerAction } from './telegramBot.js'; 
import { calculateReview } from './services/srs.js'; 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
globalThis.File = File as any;

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001; 

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
        const { userId, voice, mode, level, speakingStyle, timezone } = req.body;
        const oldUser = await prisma.user.findUnique({ where: { id: userId } });
        
        await prisma.user.update({
            where: { id: userId },
            data: { 
                voice: voice || undefined, 
                mode: mode || undefined,
                level: level || undefined,
                speakingStyle: speakingStyle || undefined,
                timezone: timezone || undefined
            }
        });

        if (mode && oldUser?.mode !== mode) {
            if (mode === 'interview') {
                await prisma.user.update({ where: { id: userId }, data: { interviewContext: null } });
                await bot.sendMessage(userId, 
                `💼 <b>Interview Mode Activated!</b> 🚀\n\nTo start the simulation, please type the <b>Job Position</b> you are applying for.\n\n<i>Example: Frontend Developer, Project Manager, Barista...</i>`, 
                { parse_mode: 'HTML' }
            );            } 
            
            else if (mode === 'roleplay') {
                await prisma.user.update({ where: { id: userId }, data: { roleplayContext: null } });
                
                const opts = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '☕️ Cafe', callback_data: 'rp_cafe' }, { text: '✈️ Airport', callback_data: 'rp_airport' }],
                            [{ text: '🏨 Hotel', callback_data: 'rp_hotel' }, { text: '🚕 Taxi', callback_data: 'rp_taxi' }],
                            [{ text: '🏥 Doctor', callback_data: 'rp_doctor' }, { text: '🛒 Grocery', callback_data: 'rp_shop' }]
                        ]
                    }
                };
                
                await bot.sendMessage(userId, 
                    `🎭 <b>Roleplay Mode Activated!</b>\n\nChoose a scenario to start practicing, or simply <b>type your own scenario</b> (e.g., <i>"Buying a ticket at the cinema"</i>).`, 
                    { parse_mode: 'HTML', ...opts }
                );
            }
        }

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});