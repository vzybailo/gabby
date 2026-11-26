// src/lib/store.ts
import { prisma } from './prisma.js';

const SESSION_TTL_DAYS = 30;

/**
 * Данные под inline-кнопками бота. Хранятся в БД, чтобы кнопки
 * продолжали работать после перезапуска/деплоя.
 */
export const sessionStore = {
    async get<T = any>(key: string): Promise<T | null> {
        const row = await prisma.botSession.findUnique({ where: { key } });
        return (row?.data as T) ?? null;
    },

    async set(key: string, data: unknown): Promise<void> {
        const json = JSON.parse(JSON.stringify(data ?? null));
        await prisma.botSession.upsert({
            where: { key },
            update: { data: json },
            create: { key, data: json }
        });
    },

    /** Удаляет записи старше SESSION_TTL_DAYS. */
    async cleanup(): Promise<number> {
        const cutoff = new Date(Date.now() - SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
        const { count } = await prisma.botSession.deleteMany({ where: { createdAt: { lt: cutoff } } });
        return count;
    }
};

// Короткоживущее состояние визарда (проверка уровня) — его потеря при рестарте не критична.
export const userState = new Map<string, 'IDLE' | 'TESTING'>();
