import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
    namespace Express {
        interface Request {
            /** Telegram id пользователя, подтверждённый подписью initData */
            userId?: string;
        }
    }
}

// Сколько живёт initData после открытия мини-приложения
const MAX_AUTH_AGE_SECONDS = Number(process.env.TG_AUTH_MAX_AGE_SECONDS || 7 * 24 * 60 * 60);

/**
 * Проверка подписи Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData: string, botToken: string): string | null {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');

    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

    try {
        const user = JSON.parse(params.get('user') || '{}');
        return user?.id ? String(user.id) : null;
    } catch {
        return null;
    }
}

/**
 * Требует заголовок `Authorization: tma <initData>` и кладёт проверенный id в req.userId.
 * Для локальной разработки вне Telegram: ALLOW_DEV_AUTH=true и заголовок `x-dev-user-id`.
 */
export function requireTelegramAuth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization || '';

    if (header.startsWith('tma ')) {
        const userId = verifyInitData(header.slice(4), process.env.TELEGRAM_BOT_TOKEN || '');
        if (userId) {
            req.userId = userId;
            return next();
        }
    }

    const devUser = req.headers['x-dev-user-id'];
    if (process.env.ALLOW_DEV_AUTH === 'true' && process.env.NODE_ENV !== 'production' && typeof devUser === 'string' && devUser) {
        req.userId = devUser;
        return next();
    }

    return res.status(401).json({ error: 'Unauthorized' });
}

/** Запрещает доступ к чужим данным: `:id` в адресе должен совпадать с проверенным пользователем. */
export function requireSelf(paramName = 'id') {
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.params[paramName] !== req.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
}
