export type PlanType = 'month' | 'year';

export interface Plan {
    id: PlanType;
    name: string;
    /** Tribute subscription link, e.g. https://t.me/tribute/app?startapp=sXXXX */
    tributeLink: string;
    /** Цена для показа в мини-приложении. Списывает Tribute по цене из своего кабинета — держите их одинаковыми. */
    price: number;
}

function envPrice(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Валюта цен (ISO-код), например USD или EUR */
export const PRICE_CURRENCY = (process.env.PRICE_CURRENCY || 'USD').toUpperCase();

export const PLANS: Record<PlanType, Plan> = {
    month: {
        id: 'month',
        name: 'Premium 1 Month',
        tributeLink: process.env.TRIBUTE_MONTH_LINK || '',
        price: envPrice('PRICE_MONTH', 8)
    },

    year: {
        id: 'year',
        name: 'Premium 1 Year',
        // If both periods live in one Tribute subscription, the same link can be used for both
        tributeLink: process.env.TRIBUTE_YEAR_LINK || process.env.TRIBUTE_MONTH_LINK || '',
        price: envPrice('PRICE_YEAR', 59)
    }
};

export function isPlanType(value: unknown): value is PlanType {
    return value === 'month' || value === 'year';
}

/** Скидка годового плана относительно 12 месяцев, в процентах (округление вниз, чтобы не завышать). */
export function yearlyDiscountPercent(): number {
    const fullYear = PLANS.month.price * 12;
    if (fullYear <= 0) return 0;
    return Math.max(0, Math.floor((1 - PLANS.year.price / fullYear) * 100));
}
