const btnGetPremium = document.getElementById('btn-get-premium');

if (btnGetPremium) {
    btnGetPremium.addEventListener('click', async () => {
        const plan = isYearly ? 'year' : 'month';
        const originalText = btnGetPremium.innerHTML;

        btnGetPremium.disabled = true;
        btnGetPremium.innerHTML = '⏳ Загрузка...';

        try {
            let response;
            try {
                response = await apiFetch(`/api/payment-link?plan=${plan}`);
            } catch (e) {
                throw new Error('Нет связи с сервером (NETWORK)');
            }

            // Если сервер упал или прокси вернул HTML-страницу ошибки, JSON не разберётся
            const data = await response.json().catch(() => null);
            if (!data) throw new Error(`Сервер вернул не JSON (HTTP ${response.status})`);

            if (data.error === 'Payment link not configured') {
                throw new Error('На сервере не задана ссылка Tribute (TRIBUTE_MONTH_LINK)');
            }
            if (!response.ok || !data.url) {
                throw new Error(`${data.error || 'Нет ссылки на оплату'} (HTTP ${response.status})`);
            }

            // Tribute opens as a Telegram mini app; the webhook activates Premium after payment
            tg.openTelegramLink(data.url);
        } catch (err) {
            console.error('Payment link error:', err);
            // Причина в скобках помогает понять, что сломалось, не открывая логи
            tg.showAlert(`Не удалось открыть страницу оплаты. Попробуйте ещё раз.\n\n(${err.message})`);
        } finally {
            btnGetPremium.disabled = false;
            btnGetPremium.innerHTML = originalText;
        }
    });
}

// Refresh premium status when the user comes back after paying
tg.onEvent('activated', () => loadData());
