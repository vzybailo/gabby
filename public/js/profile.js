const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

fetch('/api/settings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    userId: window.Telegram.WebApp.initDataUnsafe.user.id.toString(),
    timezone: userTimezone 
  })
});

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

function updateStatsUI(data) {
    document.getElementById('streakVal').innerText = data.streak || 0;
    document.getElementById('avgScoreVal').innerText = (data.avgScore || 0) + '%';
    document.getElementById('totalMinutesVal').innerText = data.totalMinutes || 0;
    document.getElementById('wordsLearnedVal').innerText = data.wordsLearned || 0;

    toggleDimmed('cardStreak', data.streak > 0);
    toggleDimmed('cardGrammar', data.avgScore > 0);
    toggleDimmed('cardMinutes', data.totalMinutes > 0);
    toggleDimmed('cardWords', data.wordsLearned > 0);
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

    if (levelBadge) {
      levelBadge.innerText = levelText;
    }

    if (typeof setActiveOption === 'function') {
      if (profileData.voice) setActiveOption('acc-voice-timbre', profileData.voice);
      if (profileData.speakingStyle) setActiveOption('acc-style', profileData.speakingStyle);
      if (profileData.mode) setActiveOption('acc-mode', profileData.mode);
      if (profileData.level) setActiveOption('acc-level', profileData.level);
    }

    if (profileData.dates && Array.isArray(profileData.dates)) {

      const cleanDates = profileData.dates
        .map(dateStr => dateStr ? dateStr.split('T')[0] : '')
        .filter(Boolean);

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
    const learnedWords = statsData.learnedWords ?? 0;
    const totalWords = statsData.totalWords ?? 0;
    const scoreVal = Math.round(statsData.avgScore ?? profileData.avgScore ?? 0);
    const streakEl = document.getElementById('streakVal');

    if (streakEl) {
      streakEl.innerText = streakVal;
    }

    if (typeof toggleCardDimmed === 'function') {
      toggleCardDimmed('cardStreak', streakVal > 0);
    }

    const minutesEl = document.getElementById('totalMinutesVal');

    if (minutesEl) {
      minutesEl.innerText = minutesVal;
    }

    if (typeof toggleCardDimmed === 'function') {
      toggleCardDimmed('cardMinutes', minutesVal > 0);
    }

    const wordsEl = document.getElementById('wordsLearnedVal');

    if (wordsEl) {
      wordsEl.innerText = `${learnedWords}/${totalWords}`;
    }

    if (typeof toggleCardDimmed === 'function') {
      toggleCardDimmed('cardWords', learnedWords > 0);
    }

    const scoreEl = document.getElementById('avgScoreVal');

    if (scoreEl) {
      scoreEl.innerText = scoreVal + '%';
    }

    if (typeof toggleCardDimmed === 'function') {
      toggleCardDimmed('cardGrammar', scoreVal > 0);
    }

  if (
      isPremiumReturn &&
      profileData.isPremium &&
      !sessionStorage.getItem(PREMIUM_POPUP_KEY)
  ) {

      sessionStorage.setItem(PREMIUM_POPUP_KEY, 'true');

      setTimeout(() => {

          tg.showPopup({

              title: '🎉 Премиум активирован!',

              message:
                  'Спасибо за поддержку Say It ❤️\n\n' +
                  'Все Premium-функции уже доступны.\n\n' +
                  'Приятного обучения! 🚀',

              buttons: [
                  {
                      id: 'ok',
                      type: 'default',
                      text: 'Начать'
                  }
              ]

          });

      }, 800);

  }

  } catch (e) {

    console.error('Data load error:', e);

    const levelBadge = document.getElementById('userLevelBadge');

    if (levelBadge) {
      levelBadge.innerText = 'A1';
    }

    const scoreEl = document.getElementById('avgScoreVal');

    if (scoreEl) {
      scoreEl.innerText = '0%';
    }

  }
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

function toggleCardDimmed(cardId, isActive) {
  const card = document.getElementById(cardId);
  if (!card) return;
  if (isActive) {
    card.classList.remove('dimmed');
  } else {
    card.classList.add('dimmed');
  }
}

function inviteFriends() {
  const link = 'https://t.me/SpeakWithMeNowBot?start=invite';
  const shareText = '👆 Нашел крутого ИИ-репетитора по английскому в Телеграме! Можно общаться голосом как с настоящим нейтивом, прокачивать произношение и ломать языковой барьер. Переходи по ссылке выше!';
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
  
  tg.openTelegramLink(telegramUrl);
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