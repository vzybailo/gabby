export type PlanType = 'month' | 'year';

export interface Plan {
    id: PlanType;
    name: string;
    description: string;
    premiumDays: number;
    starsPrice: number;
    stripePriceId: string;
}

export const PLANS: Record<PlanType, Plan> = {
    month: {
        id: 'month',
        name: 'Premium 1 Month',
        description: 'Unlimited AI chat, all voices and premium features.',
        premiumDays: 30,
        starsPrice: 399,
        stripePriceId: process.env.STRIPE_MONTH_PRICE_ID!
    },

    year: {
        id: 'year',
        name: 'Premium 1 Year',
        description: 'Unlimited AI chat, all voices and premium features for one year.',
        premiumDays: 365,
        starsPrice: 2999,
        stripePriceId: process.env.STRIPE_YEAR_PRICE_ID!
    }
};