const btnGetPremium = document.getElementById('btn-get-premium');
const paymentMethodsBlock = document.getElementById('payment-methods-block');
const btnPayStars = document.getElementById('btn-pay-stars');
const btnPayCard = document.getElementById('btn-pay-card');

if (btnGetPremium && paymentMethodsBlock) {
    btnGetPremium.addEventListener('click', () => {
        btnGetPremium.classList.add('hidden'); 
        paymentMethodsBlock.classList.remove('hidden'); 
        paymentMethodsBlock.classList.add('flex');
    });
}

if (btnPayCard) {

    btnPayCard.addEventListener('click', async () => {

        const plan = isYearly ? 'year' : 'month';

        const originalText = btnPayCard.innerHTML;

        btnPayCard.disabled = true;
        btnPayCard.innerHTML = '⏳ Redirecting...';

        try {

            const response = await fetch(
                `/api/create-checkout-session?userId=${userId}&plan=${plan}`
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Checkout session failed');
            }

            if (!data.url) {
                throw new Error('Checkout URL missing');
            }

            tg.openLink(data.url);

            setTimeout(() => {
                tg.close();
            }, 1000);

        } catch (err) {

            console.error(err);

            tg.showAlert(
                'Unable to open payment page. Please try again.'
            );

            btnPayCard.disabled = false;
            btnPayCard.innerHTML = originalText;

        }

    });

}

if (btnPayStars) {
    btnPayStars.addEventListener('click', async () => {
        const plan = isYearly ? 'year' : 'month'; 

        const originalText = btnPayStars.innerHTML;
        btnPayStars.innerHTML = '⏳ Loading...';
        btnPayStars.disabled = true;

        try {
            const response = await fetch(`/api/create-stars-invoice?userId=${userId}&plan=${plan}`);
            const data = await response.json();

            tg.openInvoice(data.invoiceUrl, (status) => {
                if (status === 'paid') {
                    tg.showAlert("🎉 Payment successful! Premium unlocked.");
                    loadData(); 
                } else if (status === 'failed') {
                    tg.showAlert("⚠️ Payment failed. Please try again.");
                }
                
                btnPayStars.innerHTML = originalText;
                btnPayStars.disabled = false;
            });
        } catch (error) {
            console.error("Error creating invoice:", error);
            tg.showAlert("Network error. Please try again later.");
            btnPayStars.innerHTML = originalText;
            btnPayStars.disabled = false;
        }
    });
}
