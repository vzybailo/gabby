import { PLANS } from '../config/plans.js';

export const getPaymentKeyboard = (_chatId: string) => {
    const monthLink = PLANS.month.tributeLink;
    const yearLink = PLANS.year.tributeLink;

    // Same link for both periods → one button (the period is chosen inside Tribute)
    if (monthLink === yearLink) {
        return {
            inline_keyboard: [[{ text: '💎 Оформить Premium', url: monthLink }]]
        };
    }

    return {
        inline_keyboard: [
            [
                { text: '💎 Premium 1 Мес', url: monthLink },
                { text: '💎 Premium 1 Год', url: yearLink }
            ]
        ]
    };
};
