const tg = window.Telegram.WebApp;
tg.expand();
const user = tg.initDataUnsafe?.user;
const userId = user?.id || 'test_id';

const isPremiumReturn = tg.initDataUnsafe?.start_param === 'premium';

const PREMIUM_POPUP_KEY = 'premium_popup_shown';