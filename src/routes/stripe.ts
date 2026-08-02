import { Router } from 'express';
import { createCheckoutSession } from '../services/stripeService.js';
import { PlanType } from '../config/plans.js';

const router = Router();

router.get('/create-checkout-session', async (req, res) => {

    try {

        const userId = req.query.userId as string;
        const plan = req.query.plan as PlanType;

        if (!userId) {
            return res.status(400).json({
                error: 'UserId is required'
            });
        }

        if (plan !== 'month' && plan !== 'year') {
            return res.status(400).json({
                error: 'Invalid plan'
            });
        }

        const checkoutUrl = await createCheckoutSession(
            userId,
            plan
        );

        return res.json({
            url: checkoutUrl
        });

    } catch (err) {

        console.error('Stripe Checkout Error:', err);

        return res.status(500).json({
            error: 'Failed to create checkout session'
        });

    }

});

export default router;