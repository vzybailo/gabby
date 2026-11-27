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

// Вкладка при открытии: из ссылки t.me/<bot>?startapp=<tab> или из кнопки web_app (…/?tab=<tab>)
const startParam = tg.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('tab') || '';
const isPremiumReturn = startParam === 'premium';

// Все запросы к API идут с подписанным initData — сервер сам определяет пользователя по нему.
function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (tg.initData) headers.set('Authorization', `tma ${tg.initData}`);
  return fetch(url, { ...options, headers });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PREMIUM_POPUP_KEY = 'premium_popup_shown';