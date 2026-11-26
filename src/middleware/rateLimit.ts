import type { Request, Response, NextFunction } from 'express';

/**
 * Простой лимит запросов в памяти процесса (бот работает одним процессом pm2).
 * Ключ — проверенный userId, иначе IP.
 */
export function rateLimit({ windowMs, max, name }: { windowMs: number; max: number; name: string }) {
    const hits = new Map<string, { count: number; resetAt: number }>();

    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }, windowMs).unref();

    return (req: Request, res: Response, next: NextFunction) => {
        const key = `${name}:${req.userId || req.ip}`;
        const now = Date.now();
        const entry = hits.get(key);

        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        entry.count += 1;
        if (entry.count > max) {
            res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
            return res.status(429).json({ error: 'Too many requests' });
        }
        next();
    };
}

// Общие лимиты для эндпоинтов, которые вызывают OpenAI
export const aiLimiter = rateLimit({ name: 'ai', windowMs: 60_000, max: 20 });
export const aiDailyLimiter = rateLimit({ name: 'ai-day', windowMs: 24 * 60 * 60_000, max: 300 });
