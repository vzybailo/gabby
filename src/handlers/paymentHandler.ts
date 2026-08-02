import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';

export function setupPaymentHandlers(bot: TelegramBot) {
    
    bot.on('pre_checkout_query', async (query) => {
        try {
            await bot.answerPreCheckoutQuery(query.id, true);
        } catch (e) {
            console.error('PreCheckout Error:', e);
            try {
                await bot.answerPreCheckoutQuery(
                    query.id,
                    false,
                    { error_message: 'Что-то пошло не так, попробуйте еще раз.' }
                );
            } catch (fallbackErr) {
                console.error('Failed to send negative pre_checkout_query response:', fallbackErr);
            }
        }
    });

    bot.on('successful_payment', async (msg) => {
        const chatId = msg.chat.id.toString();
        const paymentInfo = msg.successful_payment;

        if (!paymentInfo) return;
        console.log(`⭐️ Оплата ${paymentInfo.total_amount} XTR от ${chatId}`);

        try {
            const payload = paymentInfo.invoice_payload;
            let addedDays = 0;
            let description = '';

            if (payload === 'payload_premium_month') {
                addedDays = 30;
                description = 'Premium 1 Month (Stars)';
            } else if (payload === 'payload_premium_year') {
                addedDays = 365;
                description = 'Premium 1 Year (Stars)';
            }

            if (addedDays > 0) {
                const user = await prisma.user.findUnique({ where: { id: chatId } });
                
                let newPremiumUntil = new Date();

                if (user?.isPremium && user?.premiumUntil && user.premiumUntil > new Date()) {
                    newPremiumUntil = new Date(user.premiumUntil);
                }
                newPremiumUntil.setDate(newPremiumUntil.getDate() + addedDays);

                await prisma.user.update({
                    where: { id: chatId },
                    data: {
                        isPremium: true,
                        premiumUntil: newPremiumUntil
                    }
                });

                await prisma.transaction.create({
                    data: {
                        userId: chatId,
                        provider: 'TELEGRAM_STARS',
                        amount: paymentInfo.total_amount,
                        currency: 'XTR',
                        status: 'SUCCESS',
                        providerTxId: paymentInfo.telegram_payment_charge_id,
                        description: description
                    }
                });

                await bot.sendMessage(
                    chatId, 
                    `🎉 <b>Оплата прошла успешно!</b>\n\nТвой Premium активирован до <b>${newPremiumUntil.toLocaleDateString('ru-RU', {day: '2-digit', month: '2-digit', year: 'numeric'})}</b>.\n\nСпасибо за поддержку проекта! Теперь тебе доступны все голоса и безлимитные аудио. 🚀`, 
                    { parse_mode: 'HTML' }
                );
            }
        } catch (error) {
            console.error('Payment DB Error:', error);
            await bot.sendMessage(chatId, '⚠️ Оплата прошла, но произошла задержка с активацией подписки. Пожалуйста, напиши в поддержку.');
        }
    });
}