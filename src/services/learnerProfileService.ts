import OpenAI from 'openai';
import { prisma } from '../lib/prisma.js';

// «Память» репетитора: короткий профиль ученика (интересы, цели, факты, частые ошибки).
// Обновляется в фоне каждые N сообщений и подставляется в промпт.

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FIRST_PROFILE_AFTER = 6;   // первый профиль — после стольких сообщений ученика
const UPDATE_EVERY = 15;         // дальше — раз в столько сообщений
const HISTORY_FOR_PROFILE = 40;

const inProgress = new Set<string>();

export async function maybeUpdateLearnerProfile(userId: string): Promise<void> {
    if (inProgress.has(userId)) return;
    inProgress.add(userId);

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { learnerProfile: true, profileUpdatedAt: true, level: true }
        });
        if (!user) return;

        const newMessages = await prisma.message.count({
            where: {
                userId,
                role: 'user',
                ...(user.profileUpdatedAt ? { createdAt: { gt: user.profileUpdatedAt } } : {})
            }
        });
        const threshold = user.learnerProfile ? UPDATE_EVERY : FIRST_PROFILE_AFTER;
        if (newMessages < threshold) return;

        const history = await prisma.message.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: HISTORY_FOR_PROFILE,
            select: { role: true, text: true, grammarFixes: true }
        });
        history.reverse();

        const dialogue = history
            .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.text.slice(0, 400)}`)
            .join('\n');

        const errors = history
            .flatMap(m => (Array.isArray(m.grammarFixes) ? (m.grammarFixes as any[]) : []))
            .filter(e => e?.error_part && e?.correction)
            .map(e => `"${e.error_part}" → "${e.correction}"`)
            .slice(-40)
            .join('\n');

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content: `You maintain a short memory file about an English learner (level ${user.level || 'unknown'}) for their AI tutor.
Update the existing profile using the new conversation and the list of corrected mistakes.
Rules:
- Only facts the student actually said. Never invent. Keep still-relevant old facts, drop outdated ones.
- Max 120 words, plain text, these lines (omit a line if unknown):
Name: ...
About: job/study, city, family, etc.
Interests: ...
Goals with English: ...
Recent events to ask about: ...
Recurring mistakes: up to 3 patterns that repeat, each as "wrong → right (rule)". Ignore one-off slips.`
                },
                {
                    role: 'user',
                    content: `EXISTING PROFILE:\n${user.learnerProfile || '(none)'}\n\nCONVERSATION:\n${dialogue}\n\nCORRECTED MISTAKES:\n${errors || '(none)'}`
                }
            ]
        });

        const profile = completion.choices[0]?.message?.content?.trim();
        if (!profile) return;

        await prisma.user.update({
            where: { id: userId },
            data: { learnerProfile: profile.slice(0, 1500), profileUpdatedAt: new Date() }
        });
    } catch (e) {
        console.error(`Learner profile update failed for ${userId}:`, e);
    } finally {
        inProgress.delete(userId);
    }
}
