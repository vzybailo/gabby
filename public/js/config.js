const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Match Telegram's header/background to the app so it feels native
try {
  tg.setHeaderColor('#151338');
  tg.setBackgroundColor('#0b1020');
  tg.setBottomBarColor?.('#0b1020');
} catch (e) {}
const user = tg.initDataUnsafe?.user;
// Prisma stores User.id as a string — always send it as one
const userId = user?.id ? String(user.id) : 'test_id';

const isPremiumReturn = tg.initDataUnsafe?.start_param === 'premium';

const PREMIUM_POPUP_KEY = 'premium_popup_shown';