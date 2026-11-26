import express, { Router } from 'express';
import { PLANS, PRICE_CURRENCY, isPlanType, yearlyDiscountPercent } from '../config/plans.js';
import { verifyTributeSignature, handleTributeEvent, TributeWebhookEvent } from '../services/tributeService.js';

const router = Router();

router.post('/tribute-webhook', express.raw({ type: '*/*' }), async (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature = req.headers['trbt-signature'] as string | undefined;

    if (!verifyTributeSignature(rawBody, signature)) {
        console.error('❌ Tribute: invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    let event: TributeWebhookEvent;
    try {
        event = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
    }

    try {
        await handleTributeEvent(event);
    } catch (err) {
        console.error('❌ Tribute webhook processing error:', err);
        // Non-2xx makes Tribute retry later
        return res.status(500).json({ error: 'Processing failed' });
    }

    return res.json({ status: 'ok' });
});

// Цены для мини-приложения: меняются в .env (PRICE_MONTH, PRICE_YEAR, PRICE_CURRENCY) без правки кода
router.get('/plans', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
        currency: PRICE_CURRENCY,
        month: { price: PLANS.month.price },
        year: { price: PLANS.year.price },
        yearlyDiscountPercent: yearlyDiscountPercent()
    });
});

router.get('/payment-link', (req, res) => {
    const plan = req.query.plan;
    if (!isPlanType(plan)) {
        return res.status(400).json({ error: 'Invalid plan' });
    }

    const url = PLANS[plan].tributeLink;
    if (!url) {
        console.error(`❌ Tribute link for plan "${plan}" is not configured`);
        return res.status(500).json({ error: 'Payment link not configured' });
    }

    return res.json({ url });
});

export default router;
