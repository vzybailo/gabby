export const getPaymentKeyboard = (chatId: string) => {
    // Твои ссылки из дашборда Stripe
    const stripeMonthLink = 'https://buy.stripe.com/prod_UsH9q25HO5Xsxm';
    const stripeYearLink = 'https://buy.stripe.com/prod_UsH9UvrL8cpdle';

    return {
        inline_keyboard: [
            // ⭐️ Блок Telegram Stars (остается на callback_data)
            [
                { text: '⭐️ 1 Мес (~$10)', callback_data: 'buy_premium_month' },
                { text: '⭐️ 1 Год (~$50)', callback_data: 'buy_premium_year' }
            ],
            // 💳 Блок Stripe (используем url и добавляем chatId)
            [
                { 
                    text: '💳 Картой 1 Мес', 
                    url: `${stripeMonthLink}?client_reference_id=${chatId}` 
                },
                { 
                    text: '💳 Картой 1 Год', 
                    url: `${stripeYearLink}?client_reference_id=${chatId}` 
                }
            ]
        ]
    };
};