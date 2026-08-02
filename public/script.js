const tg = window.Telegram.WebApp;
tg.expand();
const user = tg.initDataUnsafe?.user;
const userId = user?.id || 'test_id';

let quizQueue = [];
let currentCard = null;
let isYearly = false;
let userDates = new Set();
let calDate = new Date();
let currentAudio = null;
let isUserPremiumStatus = false; 
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

fetch('/api/settings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    userId: window.Telegram.WebApp.initDataUnsafe.user.id.toString(),
    timezone: userTimezone 
  })
});

function initializePremiumUI(userData) {
    if (!userData) return;

    const upgradeBanner = document.getElementById('upgrade-btn');
    const goldNavItem = document.querySelector('.nav-item.gold');
    const premiumBadge = document.getElementById('premiumBadge');

    // Элементы самой вкладки Premium
    const activeView = document.getElementById('premium-active-view');
    const subscribeView = document.getElementById('premium-subscribe-view');
    const activeUntilDate = document.getElementById('activeUntilDate');

    const isPremium = Boolean(userData.isPremium || userData.is_premium);

    let formattedDate = null;
    const rawDate = userData.premiumUntil || userData.premium_until;
    if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
            formattedDate = d.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        }
    }

    // Сохраняем глобальный статус
    if (typeof isUserPremiumStatus !== 'undefined') {
        isUserPremiumStatus = isPremium;
    }

    if (isPremium) {
        // 1. Скрываем баннер апгрейда в настройках
        if (upgradeBanner) upgradeBanner.style.setProperty('display', 'none', 'important');
        
        // 2. Оставляем вкладку Premium видимой в меню
        if (goldNavItem) goldNavItem.style.setProperty('display', '', 'important');
        
        // 3. Снимаем замки
        if (typeof removeVisualLocks === 'function') {
            removeVisualLocks();
        }

        // 4. Плашка Premium в профиле
        if (premiumBadge) {
            if (formattedDate) {
                premiumBadge.innerHTML = `⭐ Premium до <span>${formattedDate}</span>`;
            } else {
                premiumBadge.innerHTML = `⭐ Premium`;
            }
            premiumBadge.classList.remove('hidden');
            premiumBadge.style.setProperty('display', 'inline-block', 'important');
        }

        // 5. Переключаем экран внутри самой вкладки Premium (БЕЗ РЕКУРСИИ!)
        if (activeView) activeView.classList.remove('hidden');
        if (subscribeView) subscribeView.classList.add('hidden');
        if (activeUntilDate) {
            activeUntilDate.innerText = formattedDate || 'Бессрочно';
        }

    } else {
        // 1. Показываем баннер в настройках
        if (upgradeBanner) upgradeBanner.style.setProperty('display', 'flex', 'important');
        if (goldNavItem) goldNavItem.style.setProperty('display', '', 'important');
        
        // 2. Вешаем замки
        if (typeof addVisualLocks === 'function') {
            addVisualLocks();
        }

        // 3. Скрываем плашку в профиле
        if (premiumBadge) {
            premiumBadge.classList.add('hidden');
            premiumBadge.style.setProperty('display', 'none', 'important');
        }

        // 4. Показываем варианты покупки на вкладке Premium
        if (activeView) activeView.classList.add('hidden');
        if (subscribeView) subscribeView.classList.remove('hidden');
    }
}

function removeVisualLocks() {
    // Выбираем вообще все элементы с option-title
    const titles = document.querySelectorAll('.option-title');
    titles.forEach(title => {
        if (title.innerHTML.includes('🔒 ')) {
            title.innerHTML = title.innerHTML.replace('🔒 ', '');
        }
    });
}

function addVisualLocks() {
    const premiumVoices = ['echo', 'shimmer', 'onyx', 'nova', 'fable'];
    
    premiumVoices.forEach(voiceId => {
        const card = document.querySelector(`[onclick*="selectVoice('${voiceId}'"]`);
        if (card) {
            const title = card.querySelector('.option-title');
            if (title && !title.innerHTML.includes('🔒')) {
                title.innerHTML = '🔒 ' + title.innerHTML;
            }
        }
    });

    const premiumStyles = ['friend', 'street'];
    premiumStyles.forEach(styleId => {
        const card = document.querySelector(`[onclick*="selectStyle('${styleId}'"]`);
        if (card) {
            const title = card.querySelector('.option-title');
            if (title && !title.innerHTML.includes('🔒')) {
                title.innerHTML = '🔒 ' + title.innerHTML;
            }
        }
    });
}

// 4. Защита функций выбора голоса и стиля при клике
const originalSelectVoice = window.selectVoice;
window.selectVoice = function(voiceId, element) {
    const freeVoices = ['alloy']; // Доступно бесплатно
    
    if (!isUserPremiumStatus && !freeVoices.includes(voiceId)) {
        // Показываем стандартный Telegram Alert и переводим на вкладку премиума
        window.Telegram.WebApp.showAlert('💎 Этот голос доступен только в Premium-версии!');
        switchTab('premium', document.querySelector('.nav-item.gold'));
        return;
    }
    
    // Если премиум есть или голос бесплатный, вызываем старую логику
    if (typeof originalSelectVoice === 'function') {
        originalSelectVoice(voiceId, element);
    }
};

const originalSelectStyle = window.selectStyle;
window.selectStyle = function(styleId, element) {
    const freeStyles = ['standard', 'teacher']; // Доступно бесплатно
    
    if (!isUserPremiumStatus && !freeStyles.includes(styleId)) {
        window.Telegram.WebApp.showAlert('💎 Этот стиль речи доступен только в Premium-версии!');
        switchTab('premium', document.querySelector('.nav-item.gold'));
        return;
    }

    if (typeof originalSelectStyle === 'function') {
        originalSelectStyle(styleId, element);
    }
};

async function startQuiz() {
  document.getElementById('vocab-list').innerHTML = '<div style="text-align:center;color:var(--text-dim);">Loading quiz...</div>';
  try {
  const res = await fetch(`/api/vocabulary/review/${userId}`);
  const data = await res.json();
  quizQueue = data.words || [];

  if (quizQueue.length === 0) {
    alert("🎉 All words reviewed for now! Come back later.");
    loadVocabulary();
    return;
  }

  toggleQuizUI(true);
  showNextCard();
  } catch (e) {
  alert("Error starting quiz");
  loadVocabulary();
  }
}

function stopQuiz() {
  toggleQuizUI(false);
  loadVocabulary();
}

function toggleQuizUI(show) {
  const ids = ['quiz-container', 'vocab-list', 'vocab-actions', 'vocab-close-btn'];
  const [quiz, list, actions, closeBtn] = ids.map(id => document.getElementById(id));
  
  quiz.style.display = show ? 'flex' : 'none';
  list.style.display = show ? 'none' : 'block';
  actions.style.display = show ? 'none' : 'flex';
  closeBtn.style.display = show ? 'none' : 'block';
}

function showNextCard() {
  if (quizQueue.length === 0) {
  alert("🎉 Session complete!");
  stopQuiz();
  return;
  }

  currentCard = quizQueue[0];
  resetCardUI();
  populateCardData();
}

function resetCardUI() {
  document.getElementById('quiz-controls').style.display = 'none';
  document.getElementById('q-word').style.display = 'none';
  document.getElementById('q-trans').style.display = 'none';
}

function populateCardData() {
  if (!currentCard) return;

  const word = currentCard.word;
  const mask = `<span style="color:#818cf8; font-weight:700; letter-spacing:2px;">${word[0]}${'_'.repeat(word.length - 1)}</span>`;
  
  const wordRegex = new RegExp(`\\b${word}\\b`, 'gi');

  let displayHtml = '';

  if (currentCard.context) {
  const maskedContext = currentCard.context.replace(wordRegex, mask);
  displayHtml += `<div style="font-size:18px; line-height:1.5; margin-bottom:15px; color:#fff;">${maskedContext}</div>`;
  }

  if (currentCard.definition) {
  displayHtml += `<div style="font-size:13px; color:#94a3b8; border-top:1px solid rgba(255,255,255,0.1); padding-top:10px; margin-top:10px;">
    <i>💡 ${currentCard.definition}</i>
  </div>`;
  }
  
  if (!displayHtml) {
    displayHtml = `<div style="font-size:20px;">🇷🇺 ${currentCard.translation}</div>`;
  }

  document.getElementById('q-context').innerHTML = displayHtml;

  document.getElementById('q-word').innerText = word;
  document.getElementById('q-trans').innerText = currentCard.translation;
}

function flipCard() {
  document.getElementById('q-word').style.display = 'block';
  document.getElementById('q-trans').style.display = 'block';
  document.getElementById('quiz-controls').style.display = 'flex';
}

async function rateWord(quality) {
  if (!currentCard) return;

  quizQueue.shift();
  showNextCard();

  try {
  await fetch(`/api/vocabulary/review/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wordId: currentCard.id, quality })
  });
  } catch (e) {
  console.error(e);
  }
}

function switchTab(id, el) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`tab-${id}`).classList.add('active');

  if (!el && id === 'premium') {
  el = document.querySelector('.nav-item.gold');
  }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');

  if (id === 'vocab') loadVocabulary();
  window.scrollTo({ top: 0 });
}

function toggleAccordion(id) {
  const target = document.getElementById(id);
  const isOpen = target.classList.contains('open');

  document.querySelectorAll('.accordion-item').forEach(item => {
  item.classList.remove('open');
  item.querySelector('.accordion-content').classList.remove('open');
  });

  if (!isOpen) {
  target.classList.add('open');
  target.querySelector('.accordion-content').classList.add('open');
  setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }
}

async function selectVoice(val, el) {
  updateActiveCard(el, 'acc-voice-timbre');
  await saveSetting({ voice: val });
  playAudio(`/audio/${val}.mp3`);
}

async function selectStyle(val, el) {
  updateActiveCard(el, 'acc-style');
  await saveSetting({ speakingStyle: val });
}

async function updateSetting(key, val, el) {
  updateActiveCard(el);
  await saveSetting({ [key]: val });
}

async function updateLevel(val, el) {
  document.getElementById('userLevelBadge').innerText = val;
  updateActiveCard(el);
  await saveSetting({ level: val });
}

function updateActiveCard(el, containerId) {
  const container = containerId ? document.getElementById(containerId) : el.parentElement;
  container.querySelectorAll('.option-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function playAudio(src) {
  if (currentAudio) currentAudio.pause();
  currentAudio = new Audio(src);
  currentAudio.play().catch(() => { });
}

async function saveSetting(payload) {
  try {
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userId.toString(), ...payload })
  });
  } catch (e) { }
}

async function sendFeedback() {
  const txt = document.getElementById('feedbackText').value;
  if (!txt) return;

  await fetch('/api/feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: userId.toString(), text: txt })
  });

  alert('Sent!');
  document.getElementById('feedbackText').value = '';
}

async function deleteWord(id, el) {
  if (!confirm("Delete this word?")) return;

  const card = el.closest('.vocab-item');
  card.classList.add('deleting');

  try {
  await fetch(`/api/vocabulary/${id}`, { method: 'DELETE' });
  setTimeout(() => card.remove(), 200);
  } catch (e) {
  alert('Error');
  card.classList.remove('deleting');
  }
}

async function loadVocabulary() {
  document.getElementById('quiz-container').style.display = 'none';
  document.getElementById('vocab-list').style.display = 'block';
  document.getElementById('vocab-close-btn').style.display = 'block';

  const list = document.getElementById('vocab-list');
  try {
    const res = await fetch(`/api/vocabulary/${userId}`);
    const data = await res.json();
    list.innerHTML = '';

    if(!data.words || data.words.length === 0) {
      list.innerHTML = `<div class="empty-state">📪 Пока слов нету...</div>`;
      
      document.getElementById('vocab-actions').style.display = 'none';
      return;
    }

    document.getElementById('vocab-actions').style.display = 'flex';

    data.words.forEach(w => {
      let dotClass = 'new';
      const interval = w.interval || 0; 
      
      if (interval > 14) {
        dotClass = 'master';
      } else if (interval >= 3) {
        dotClass = 'learning';
      } 
      
      const el = document.createElement('div');
      el.className = 'vocab-item';
      el.innerHTML = `
        <div class="vocab-top">
          <div style="display:flex; align-items:center;">
            <div class="level-dot ${dotClass}"></div>
            <div class="v-word">${w.word}</div>
          </div>
          <div class="v-meta">
            <div class="v-trans">${w.translation}</div>
            <div class="delete-btn" onclick="deleteWord('${w.id}', this)">🗑</div>
          </div>
        </div>
        <div class="v-def">${w.definition}</div>
        ${w.context ? `<div class="v-ctx">Ex: "${w.context}"</div>` : ''}
      `;
      list.appendChild(el);
    });
  } catch(e) { 
    console.error(e);
    list.innerHTML = '<div style="text-align:center;color:var(--text-dim);">Error loading words.</div>'; 

    document.getElementById('vocab-actions').style.display = 'none';
  }
}

function createVocabItem(word) {
  const dotClass = getDotClass(word.interval);
  const el = document.createElement('div');
  el.className = 'vocab-item';
  el.innerHTML = `
  <div class="vocab-top">
    <div style="display:flex; align-items:center;">
    <div class="level-dot ${dotClass}"></div>
    <div class="v-word">${word.word}</div>
    </div>
    <div class="v-meta">
    <div class="v-trans">${word.translation}</div>
    <div class="delete-btn" onclick="deleteWord('${word.id}', this)">🗑</div>
    </div>
  </div>
  <div class="v-def">${word.definition}</div>
  ${word.context ? `<div class="v-ctx">Ex: "${word.context}"</div>` : ''}
  `;
  return el;
}

function getDotClass(interval = 0) {
  if (interval > 14) return 'master';
  if (interval > 3) return 'learning';
  return 'new';
}

async function loadData() {
  if (typeof loadUserProfile === 'function') {
    loadUserProfile(); 
  } else if (typeof user !== 'undefined' && user) {
    const userNameEl = document.getElementById('userName');
    if (userNameEl) userNameEl.innerText = user.first_name;
  }

  try {
    const [profileRes, statsRes] = await Promise.all([
      fetch(`/api/user/${userId}?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      }),
      fetch(`/api/user/${userId}/stats?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      })
    ]);

    if (!profileRes.ok) throw new Error('Profile fetch failed');
    const profileData = await profileRes.json();

    if (typeof initializePremiumUI === 'function') {
      initializePremiumUI(profileData);
    }

    const levelText = profileData.level || 'A1';
    const levelBadge = document.getElementById('userLevelBadge');
    if (levelBadge) levelBadge.innerText = levelText;

    if (typeof setActiveOption === 'function') {
      if (profileData.voice) setActiveOption('acc-voice-timbre', profileData.voice);
      if (profileData.speakingStyle) setActiveOption('acc-style', profileData.speakingStyle);
      if (profileData.mode) setActiveOption('acc-mode', profileData.mode);
      if (profileData.level) setActiveOption('acc-level', profileData.level);
    }

    if (profileData.dates && Array.isArray(profileData.dates)) {
        const cleanDates = profileData.dates.map(dateStr => {
            if (!dateStr) return '';

            // ✅ НЕ используем new Date() — избегаем timezone бага
            return dateStr.split('T')[0];
        }).filter(Boolean);

        userDates = new Set(cleanDates);

        if (typeof renderCalendar === 'function') {
            renderCalendar();
        }
    }

    let statsData = {};
    if (statsRes.ok) {
      statsData = await statsRes.json();
    }

    const streakVal = statsData.streak ?? profileData.streak ?? 0;
    const minutesVal = statsData.totalMinutes ?? profileData.totalMinutes ?? 0;
    const wordsVal = statsData.wordsLearned ?? profileData.wordsLearned ?? 0;
    const scoreVal = Math.round(statsData.avgScore ?? profileData.avgScore ?? 0);

    // 1. Стрик
    const streakEl = document.getElementById('streakVal');
    if (streakEl) streakEl.innerText = streakVal;
    if (typeof toggleCardDimmed === 'function') {
      toggleCardDimmed('cardStreak', streakVal > 0);
    }

    // 2. Минуты
    const minutesEl = document.getElementById('totalMinutesVal');
    if (minutesEl) minutesEl.innerText = minutesVal;
    if (typeof toggleCardDimmed === 'function') {
      toggleCardDimmed('cardMinutes', minutesVal > 0);
    }

    // 3. Выучено слов
    const wordsEl = document.getElementById('wordsLearnedVal');
    if (wordsEl) {
      wordsEl.innerText = wordsVal;
    }
    if (typeof toggleCardDimmed === 'function') {
      toggleCardDimmed('cardWords', wordsVal > 0);
    }

    // 4. Грамматика
    const scoreEl = document.getElementById('avgScoreVal');
    if (scoreEl) {
      scoreEl.innerText = scoreVal + '%';
    }
    if (typeof toggleCardDimmed === 'function') {
      toggleCardDimmed('cardGrammar', scoreVal > 0);
    }

  } catch (e) {
    console.error("Data load error:", e);
    
    const levelBadge = document.getElementById('userLevelBadge');
    if (levelBadge) levelBadge.innerText = 'A1';

    const scoreEl = document.getElementById('avgScoreVal');
    if (scoreEl) scoreEl.innerText = '0%';
  }
}

function toggleCardDimmed(cardId, isActive) {
  const card = document.getElementById(cardId);
  if (!card) return;
  if (isActive) {
    card.classList.remove('dimmed');
  } else {
    card.classList.add('dimmed');
  }
}

function loadUserProfile() {
  if (!user) return;

  document.getElementById('userName').innerText = user.first_name;
  const img = document.getElementById('userAvatar');
  const ini = document.getElementById('avatarInitials');

  if (user.photo_url) {
  img.src = user.photo_url;
  img.style.display = 'block';
  } else {
  ini.style.display = 'flex';
  ini.innerText = user.first_name[0].toUpperCase();
  }
}

function setActiveOption(containerId, value) {
  if (!value || !containerId) return;
  
  const container = document.getElementById(containerId);
  if (!container) return;

  container.querySelectorAll('.option-card').forEach(c => {
    c.classList.remove('active'); 
    
    const onclickAttr = c.getAttribute('onclick');

    if (onclickAttr && onclickAttr.includes(`'${value}'`)) {
      c.classList.add('active'); 
    }
  });
}

function changeMonth(delta) {
  calDate.setMonth(calDate.getMonth() + delta);
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  
  // 🟢 Названия месяцев на русском
  const monthNames = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", 
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
  ];

  const monthNameEl = document.getElementById('monthName');
  if (monthNameEl) {
    monthNameEl.innerText = `${monthNames[month]} ${year}`;
  }

  // 🟢 Дни недели на русском
  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => {
    const el = document.createElement('div');
    el.innerText = day;
    el.style.color = 'var(--text-dim)';
    el.style.fontSize = '12px';
    el.style.textAlign = 'center';
    grid.appendChild(el);
  });

  const lastDay = new Date(year, month + 1, 0).getDate();
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  // 🟢 ИСПРАВЛЕНИЕ 1: Расчет дня недели 1-го числа через UTC (чтобы часовой пояс не сдвигал сетку)
  let firstDayIndex = new Date(Date.UTC(year, month, 1)).getUTCDay();
  firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

  // Дни предыдущего месяца (пустые ячейки)
  for (let i = firstDayIndex; i > 0; i--) {
    const dayNum = prevMonthLastDay - i + 1;
    const el = document.createElement('div');
    el.className = 'day other-month';
    el.innerText = dayNum;
    grid.appendChild(el);
  }

  const today = new Date();
  const isCurrentMonth = (today.getFullYear() === year && today.getMonth() === month);

  // 🟢 Нормализация дат пользователя строго к формату YYYY-MM-DD
  const normalizedUserDates = new Set();
  if (typeof userDates !== 'undefined' && userDates) {
    const datesArray = userDates instanceof Set ? Array.from(userDates) : userDates;
    datesArray.forEach(dateStr => {
      if (typeof dateStr === 'string' && dateStr.length >= 10) {
        normalizedUserDates.add(dateStr.split('T')[0]);
      }
    });
  }

  // 🟢 Отрисовка дней текущего месяца
  for (let d = 1; d <= lastDay; d++) {
    const el = document.createElement('div');
    el.className = 'day';
    el.innerText = d;

    // ИСПРАВЛЕНИЕ 2: Формирование ключа даты YYYY-MM-DD
    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(d).padStart(2, '0');
    const key = `${year}-${monthStr}-${dayStr}`;

    // Закрашиваем активный день
    if (normalizedUserDates.has(key)) {
      el.classList.add('active');
    }

    // Подсвечиваем сегодня
    if (isCurrentMonth && d === today.getDate()) {
      el.classList.add('today');
    }

    grid.appendChild(el);
  }
}

function togglePrice() {
  isYearly = !isYearly; // Меняем флаг

  const priceEl = document.getElementById('proPrice');
  const badge = document.getElementById('saveBadge');
  const monthBtn = document.getElementById('btnMonthly');
  const yearBtn = document.getElementById('btnYearly');
  const toggle = document.getElementById('priceToggle');

  if (isYearly) {
  toggle.classList.add('yearly');
  priceEl.innerHTML = '$50<span style="font-size:14px;color:var(--text-dim)">/yr</span>';
  badge.style.display = 'block';
  monthBtn.classList.remove('active');
  yearBtn.classList.add('active');
  } else {
  toggle.classList.remove('yearly');
  priceEl.innerHTML = '$10<span style="font-size:14px;color:var(--text-dim)">/mo</span>';
  badge.style.display = 'none';
  monthBtn.classList.add('active');
  yearBtn.classList.remove('active');
  }
}

function inviteFriends() {
  const link = 'https://t.me/SpeakWithMeNowBot?start=invite';
  const shareText = '👆 Нашел крутого ИИ-репетитора по английскому в Телеграме! Можно общаться голосом как с настоящим нейтивом, прокачивать произношение и ломать языковой барьер. Переходи по ссылке выше!';
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
  
  tg.openTelegramLink(telegramUrl);
}

// === БЛОК ОПЛАТЫ ===

// Элементы DOM для оплат
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
    btnPayCard.addEventListener('click', () => {
        // Забираем текущий план, основываясь на переменной isYearly
        const plan = isYearly ? 'year' : 'month'; 
        
        const stripeLinks = {
            month: 'https://buy.stripe.com/test_bJe5kF1o90E49uTeBL14400',
            year: 'https://buy.stripe.com/test_bJe5kF1o90E49uTeBL14400'
        };
        
        const checkoutUrl = `${stripeLinks[plan]}?client_reference_id=${userId}`;
        
        // 1. Открываем пользователю платежную страницу Stripe
        tg.openLink(checkoutUrl); 
        
        // 2. Сразу закрываем Mini App, чтобы пользователь вернулся в чат бота.
        // Когда вебхук Stripe отработает, бот пришлет ему сообщение об активации.
        setTimeout(() => {
            tg.close();
        }, 500);
    });
}

if (btnPayStars) {
    btnPayStars.addEventListener('click', async () => {
        // Также забираем план напрямую из глобальной переменной
        const plan = isYearly ? 'year' : 'month'; 

        const originalText = btnPayStars.innerHTML;
        btnPayStars.innerHTML = '⏳ Loading...';
        btnPayStars.disabled = true;

        try {
            // Запрашиваем инвойс, передавая plan (месяц или год)
            const response = await fetch(`/api/create-stars-invoice?userId=${userId}&plan=${plan}`);
            const data = await response.json();

            // Открываем системное окно оплаты Telegram
            tg.openInvoice(data.invoiceUrl, (status) => {
                if (status === 'paid') {
                    tg.showAlert("🎉 Payment successful! Premium unlocked.");
                    // Обновляем данные пользователя после успешной покупки
                    loadData(); 
                } else if (status === 'failed') {
                    tg.showAlert("⚠️ Payment failed. Please try again.");
                }
                
                // Возвращаем кнопку в исходное состояние
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

// Пример подстановки значений
function updateStatsUI(data) {
    document.getElementById('streakVal').innerText = data.streak || 0;
    document.getElementById('avgScoreVal').innerText = (data.avgScore || 0) + '%';
    document.getElementById('totalMinutesVal').innerText = data.totalMinutes || 0;
    document.getElementById('wordsLearnedVal').innerText = data.wordsLearned || 0;

    // Убираем прозрачность, если значение больше 0
    toggleDimmed('cardStreak', data.streak > 0);
    toggleDimmed('cardGrammar', data.avgScore > 0);
    toggleDimmed('cardMinutes', data.totalMinutes > 0);
    toggleDimmed('cardWords', data.wordsLearned > 0);
}

function toggleDimmed(elementId, isActive) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (isActive) {
        el.classList.remove('dimmed');
    } else {
        el.classList.add('dimmed');
    }
}

loadData();