import crypto from 'crypto';
import { miniAppButton } from '../lib/onboarding.js';
import { prisma } from '../lib/prisma.js';
import { bot } from '../telegramBot.js';

// Docs: https://wiki.tribute.tg/for-content-creators/api-documentation/webhooks

export interface TributeWebhookEvent {
    name: string;
    created_at: string;
    sent_at: string;
    payload: Record<string, any>;
}

interface SubscriptionPayload {
    subscription_name: string;
    subscription_id: number;
    period_id: number;
    period: 'monthly' | 'quarterly' | 'yearly' | string;
    price: number;      // smallest currency units
    amount: number;     // after Tribute commission
    currency: string;
    telegram_user_id: number;
    expires_at: string;
    type?: 'regular' | 'gift' | 'trial';
    cancel_reason?: string;
}

/**
 * Tribute signs the raw request body with HMAC-SHA256 using the API key
 * and sends it in the `trbt-signature` header.
 * The docs don't specify the encoding, so both hex and base64 are accepted.
 */
export function verifyTributeSignature(rawBody: Buffer, signature: string | undefined): boolean {
    const apiKey = process.env.TRIBUTE_API_KEY;
    if (!apiKey || !signature) return false;

    const hmac = crypto.createHmac('sha256', apiKey).update(rawBody).digest();
    const received = signature.trim();

    const candidates = [hmac.toString('hex'), hmac.toString('base64')];
    return candidates.some(expected => {
        const a = Buffer.from(expected);
        const b = Buffer.from(received);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
}



const formatDate = (d: Date) =>
    d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

async function activateSubscription(eventName: string, p: SubscriptionPayload) {
    const userId = String(p.telegram_user_id);
    const expiresAt = new Date(p.expires_at);

    if (!p.telegram_user_id || isNaN(expiresAt.getTime())) {
        console.error('❌ Tribute: invalid payload', p);
        return;
    }

    // Idempotency: Tribute retries webhooks, so the same event must not be applied twice
    const providerTxId = `tribute:${eventName}:${p.subscription_id}:${userId}:${p.expires_at}`;
    const existing = await prisma.transaction.findUnique({ where: { providerTxId } });
    if (existing) {
        console.log('⚠️ Tribute: duplicate webhook ignored', providerTxId);
        return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        console.error(`❌ Tribute: user ${userId} not found in DB (paid without starting the bot?)`);
        return;
    }

    // Never shorten an existing premium period (e.g. a trial that lasts longer)
    const premiumUntil =
        user.premiumUntil && user.premiumUntil > expiresAt ? user.premiumUntil : expiresAt;

    await prisma.$transaction([
        prisma.user.update({
            where: { id: userId },
            data: { isPremium: true, premiumUntil }
        }),
        prisma.transaction.create({
            data: {
                userId,
                provider: 'TRIBUTE',
                amount: p.price,
                currency: (p.currency || '').toUpperCase(),
                status: 'SUCCESS',
                providerTxId,
                description: `${p.subscription_name} (${p.period}${p.type && p.type !== 'regular' ? `, ${p.type}` : ''})`
            }
        })
    ]);

    console.log(`✅ Tribute: ${eventName} for ${userId}, premium until ${premiumUntil.toISOString()}`);

    const text = eventName === 'renewed_subscription'
        ? `🔄 <b>Подписка продлена!</b>\n\nPremium активен до <b>${formatDate(premiumUntil)}</b>.\n\nСпасибо, что остаёшься с <b>Say It</b> ❤️`
        : `🎉 <b>Премиум успешно активирован!</b>\n\nСпасибо за поддержку <b>Say It</b> ❤️\n\n📅 Действует до: <b>${formatDate(premiumUntil)}</b>\n\n🚀 Теперь тебе доступны:\n\n• Безлимитное общение с AI\n• Все голоса\n• Все Premium-функции\n• Расширенная аналитика\n\nПриятного обучения! 🇺🇸`;

    // Tribute's mini app can't be closed from our side, so this message (it arrives as a
    // notification while Tribute is still open) brings the user back to the bot / mini app.
    // startapp=premium makes the mini app show the "Premium activated" popup (see public/js/config.js).
    await bot.sendMessage(userId, text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[miniAppButton('🚀 Открыть приложение', 'premium')]]
        }
    }).catch(err =>
        console.error('❌ Tribute: failed to notify user', userId, err.message)
    );
}

async function cancelSubscription(p: SubscriptionPayload) {
    const userId = String(p.telegram_user_id);
    const expiresAt = new Date(p.expires_at);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    // Already-paid time stays available until expires_at; it just won't renew
    const stillActive = expiresAt > new Date();
    await prisma.user.update({
        where: { id: userId },
        data: { isPremium: stillActive, premiumUntil: expiresAt }
    });

    console.log(`ℹ️ Tribute: subscription cancelled for ${userId} (${p.cancel_reason || 'no reason'}), active until ${expiresAt.toISOString()}`);

    if (stillActive) {
        await bot.sendMessage(
            userId,
            `ℹ️ Автопродление Premium отключено.\n\nДоступ сохранится до <b>${formatDate(expiresAt)}</b>.`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }
}

export async function handleTributeEvent(event: TributeWebhookEvent) {
    switch (event.name) {
        case 'new_subscription':
        case 'renewed_subscription':
            return activateSubscription(event.name, event.payload as SubscriptionPayload);
        case 'cancelled_subscription':
            return cancelSubscription(event.payload as SubscriptionPayload);
        default:
            console.log(`ℹ️ Tribute: event "${event.name}" ignored`);
    }
}
