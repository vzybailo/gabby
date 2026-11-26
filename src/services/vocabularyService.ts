import { prisma } from '../lib/prisma.js';
import { calculateReview } from './srs.js';

export type ChatVocabWord = {
    id: string;
    word: string;
    translation: string;
    repetition: number;
};

export type VocabEntry = {
    word: string;
    translation: string;
    definition: string;
    example?: string;
};

export const MASTERED_REPETITION = 5;

/** До 6 слов для разговора: сначала те, что пора повторять, остальные — случайные из изучаемых. */
export async function pickVocabularyForChat(userId: string, limit = 6): Promise<ChatVocabWord[]> {
    const select = { id: true, word: true, translation: true, repetition: true };

    const due = await prisma.vocabularyItem.findMany({
        where: { userId, repetition: { lt: MASTERED_REPETITION }, nextReview: { lte: new Date() } },
        orderBy: { nextReview: 'asc' },
        take: 4,
        select
    });

    const rest = await prisma.vocabularyItem.findMany({
        where: { userId, repetition: { lt: MASTERED_REPETITION }, id: { notIn: due.map(w => w.id) } },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select
    });

    const shuffled = rest.sort(() => Math.random() - 0.5).slice(0, Math.max(0, limit - due.length));
    return [...due, ...shuffled];
}

function escapeRegex(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Регулярка, которая ловит слово и его формы: achieve → achieved/achieving, study → studied. */
export function buildWordRegex(word: string): RegExp | null {
    const parts = word.toLowerCase().replace(/^to\s+/, '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;

    const last = parts[parts.length - 1]!;
    let lastPattern = escapeRegex(last);
    if (last.length > 3 && last.endsWith('e')) lastPattern = escapeRegex(last.slice(0, -1)) + 'e?';
    else if (last.length > 3 && last.endsWith('y')) lastPattern = escapeRegex(last.slice(0, -1)) + '(?:y|i)';
    lastPattern += '[a-z]*';

    const head = parts.slice(0, -1).map(escapeRegex);
    return new RegExp(`\\b${[...head, lastPattern].join('\\s+')}\\b`, 'i');
}

/**
 * Находит слова из словаря, которые пользователь сам употребил в сообщении, и засчитывает их.
 * Употребление в живой речи — главный признак активного словаря:
 *  - если слово пора повторять, это засчитывается как успешное повторение в SRS (оценка 5);
 *  - в любом случае растёт счётчик usedInChatCount.
 * Слова, попавшие в исправления (user_errors), не засчитываются.
 */
export async function creditWordsUsedInMessage(
    userId: string,
    text: string,
    userErrors: { error_part?: string }[] = []
): Promise<string[]> {
    if (!text || text.length < 2) return [];

    const words = await prisma.vocabularyItem.findMany({
        where: { userId },
        select: { id: true, word: true, interval: true, repetition: true, easeFactor: true, nextReview: true }
    });
    if (words.length === 0) return [];

    const errorText = userErrors.map(e => e.error_part || '').join(' ');
    const now = new Date();
    const used: string[] = [];

    for (const w of words) {
        const regex = buildWordRegex(w.word);
        if (!regex || !regex.test(text)) continue;
        if (errorText && regex.test(errorText)) continue;

        const data: Record<string, unknown> = {
            usedInChatCount: { increment: 1 },
            lastUsedInChatAt: now
        };

        if (w.nextReview <= now) {
            const result = calculateReview(w, 5);
            const nextReview = new Date();
            nextReview.setDate(nextReview.getDate() + result.interval);
            Object.assign(data, result, { nextReview });
        }

        await prisma.vocabularyItem.update({ where: { id: w.id }, data });
        used.push(w.word);
    }

    return used;
}

/** Сохраняет слово в словарь пользователя (без дублей). Возвращает false, если слово уже было. */
export async function saveVocabularyItem(userId: string, entry: VocabEntry): Promise<boolean> {
    const word = entry.word.trim();
    const existing = await prisma.vocabularyItem.findFirst({
        where: { userId, word: { equals: word, mode: 'insensitive' } }
    });
    if (existing) return false;

    await prisma.vocabularyItem.create({
        data: {
            userId,
            word,
            translation: entry.translation || '',
            definition: entry.definition || '',
            context: entry.example || null
        }
    });
    return true;
}
