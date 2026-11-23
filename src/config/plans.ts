export type PlanType = 'month' | 'year';

export interface Plan {
    id: PlanType;
    name: string;
    /** Tribute subscription link, e.g. https://t.me/tribute/app?startapp=sXXXX */
    tributeLink: string;
}

export const PLANS: Record<PlanType, Plan> = {
    month: {
        id: 'month',
        name: 'Premium 1 Month',
        tributeLink: process.env.TRIBUTE_MONTH_LINK || ''
    },

    year: {
        id: 'year',
        name: 'Premium 1 Year',
        // If both periods live in one Tribute subscription, the same link can be used for both
        tributeLink: process.env.TRIBUTE_YEAR_LINK || process.env.TRIBUTE_MONTH_LINK || ''
    }
};

export function isPlanType(value: unknown): value is PlanType {
    return value === 'month' || value === 'year';
}
