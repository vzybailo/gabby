import Stripe from 'stripe';
import { PLANS, PlanType } from '../config/plans.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-06-24.dahlia'
});

export async function createCheckoutSession(
    userId: string,
    plan: PlanType
): Promise<string> {

    const selectedPlan = PLANS[plan];

    if (!selectedPlan) {
        throw new Error('Invalid plan');
    }

    const session = await stripe.checkout.sessions.create({

        mode: 'payment',

        payment_method_types: ['card'],

        line_items: [
            {
                price: selectedPlan.stripePriceId,
                quantity: 1
            }
        ],

        client_reference_id: userId,

        metadata: {
            userId,
            plan
        },

        success_url:
        `${process.env.SERVER_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,

        cancel_url:
        `${process.env.SERVER_URL}/payment-cancel`,

        allow_promotion_codes: true
    });

    if (!session.url) {
        throw new Error('Checkout URL not generated');
    }

    return session.url;
}