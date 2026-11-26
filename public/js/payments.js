const btnGetPremium = document.getElementById('btn-get-premium');

if (btnGetPremium) {
    btnGetPremium.addEventListener('click', async () => {
        const plan = isYearly ? 'year' : 'month';
        const originalText = btnGetPremium.innerHTML;

        btnGetPremium.disabled = true;
        btnGetPremium.innerHTML = '⏳ Загрузка...';

        try {
            const response = await apiFetch(`/api/payment-link?plan=${plan}`);
            const data = await response.json();

            if (!response.ok || !data.url) {
                throw new Error(data.error || 'Payment link missing');
            }

            // Tribute opens as a Telegram mini app; the webhook activates Premium after payment
            tg.openTelegramLink(data.url);
        } catch (err) {
            console.error(err);
            tg.showAlert('Не удалось открыть страницу оплаты. Попробуйте ещё раз.');
        } finally {
            btnGetPremium.disabled = false;
            btnGetPremium.innerHTML = originalText;
        }
    });
}

// Refresh premium status when the user comes back after paying
tg.onEvent('activated', () => loadData());
