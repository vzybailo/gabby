const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

apiFetch('/api/settings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ timezone: userTimezone })
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

async function loadData() {
  if (typeof loadUserProfile === 'function') {
    loadUserProfile();
  } else if (typeof user !== 'undefined' && user) {
    const userNameEl = document.getElementById('userName');
    if (userNameEl) userNameEl.innerText = user.first_name;
  }

  try {
    const [profileRes, statsRes] = await Promise.all([
      apiFetch(`/api/user/${userId}?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      }),
      apiFetch(`/api/user/${userId}/stats?t=${Date.now()}`, {
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

      setUserDates(cleanDates);

      if (typeof renderCalendar === 'function') {
        renderCalendar();
      }
    }

    let statsData = {};

    if (statsRes.ok) {
      statsData = await statsRes.json();
    }

    renderProfileStats(statsData, profileData);

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
      scoreEl.innerText = '—';
      scoreEl.classList.remove('good', 'mid', 'low');
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
  const shareText = [
    '🇬🇧 Смотри, что нашёл — Say It, ИИ-репетитор по английскому прямо в Telegram!',
    '',
    '🎙 Болтаешь голосом, как с носителем языка',
    '✍️ Он бережно исправляет ошибки и объясняет почему',
    '🗣 Прокачиваешь произношение и словарный запас',
    '🔥 10 минут в день — и языковой барьер тает',
    '',
    '👆 Жми на ссылку и попробуй бесплатно!'
  ].join('\n');
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
  if (typeof syncAccValue === 'function') syncAccValue(container);
}

function pluralRu(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function renderProfileStats(stats, profile) {
  const streak = stats.streak ?? profile.streak ?? 0;
  const best = stats.bestStreak ?? 0;
  const minutes = stats.totalMinutes ?? 0;
  const total = stats.totalWords ?? 0;
  const learned = stats.learnedWords ?? 0;
  const active = stats.activeWords ?? 0;
  const due = stats.dueWords ?? 0;
  const score = Math.round(stats.avgScore ?? 0);

  // Серия: число + подпись, рекорд — второй строкой, только если он больше текущей серии
  setText('streakVal', streak);
  setText('streakTitle', pluralRu(streak, 'день подряд', 'дня подряд', 'дней подряд'));
  setText('streakBest', best > streak
    ? `Рекорд — ${best} ${pluralRu(best, 'день', 'дня', 'дней')}`
    : streak > 0 ? 'Это твой рекорд 🎉' : 'Позанимайся сегодня, чтобы начать серию');
  document.getElementById('cardStreak')?.classList.toggle('is-active', streak > 0);

  setText('totalMinutesVal', minutes);
  setText('minutesTitle', pluralRu(minutes, 'минута', 'минуты', 'минут'));

  // Цвет точности несёт смысл: зелёный — хорошо, жёлтый — средне, красный — много ошибок
  setText('avgScoreVal', score > 0 ? score + '%' : '—');
  const scoreEl = document.getElementById('avgScoreVal');
  if (scoreEl) {
    scoreEl.classList.remove('good', 'mid', 'low');
    if (score > 0) scoreEl.classList.add(score >= 85 ? 'good' : score >= 60 ? 'mid' : 'low');
  }

  setText('wordsLearnedVal', total);
  setText('wordsTitle', pluralRu(total, 'слово', 'слова', 'слов'));
  setText('wordsSub', learned > 0 ? `выучено ${learned}` : 'в словаре');

  metricStats = { score, minutes, total, learned, active };

  renderTodayCard({ streak, due, total });
}

// Одно главное действие на сегодня
function renderTodayCard({ streak, due, total }) {
  const card = document.getElementById('todayCard');
  if (!card) return;

  let icon, title, sub, action;
  if (due > 0) {
    icon = '🧠';
    title = `${due} ${pluralRu(due, 'слово ждёт', 'слова ждут', 'слов ждут')} повторения`;
    sub = 'Пара минут — и они останутся в памяти';
    action = () => {
      switchTab('vocab', document.querySelector('.nav-item[onclick*="vocab"]'));
      setTimeout(startQuiz, 300);
    };
  } else if (streak === 0) {
    icon = '🔥';
    title = 'Начни новую серию';
    sub = 'Вернись в чат и напиши боту пару фраз';
    action = () => tg.close();
  } else {
    icon = '💬';
    title = 'Продолжить практику';
    sub = total > 0 ? 'Вернись в чат и используй слова из словаря' : 'Вернись в чат и поговори на любую тему';
    action = () => tg.close();
  }

  setText('todayIcon', icon);
  setText('todayTitle', title);
  setText('todaySub', sub);
  card.onclick = action;
  card.classList.remove('hidden');
}

function openSubscriptionManagement() {
  // Подписки Tribute управляются в его мини-приложении
  const url = 'https://t.me/tribute/app';
  if (tg.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}


let metricStats = {};

// Короткое объяснение метрики по нажатию — чтобы было понятно, что это за числа
function explainMetric(kind) {
  const m = metricStats;
  const texts = {
    grammar: {
      title: 'Точность речи',
      message: m.score > 0
        ? `${m.score}% — средняя оценка грамматики твоих сообщений за последние 7 дней. 85% и выше — отлично, 60–84% — есть над чем поработать.`
        : 'Средняя оценка грамматики твоих сообщений за последние 7 дней. Появится после первых сообщений боту.'
    },
    minutes: {
      title: 'Минуты речи',
      message: 'Общая длительность твоих голосовых сообщений боту. Именно голосом лучше всего тренируется разговорный английский.'
    },
    words: {
      title: 'Словарь',
      message: `Слов в твоём словаре: ${m.total || 0}. Выучено (5 успешных повторений подряд): ${m.learned || 0}.` +
        (m.active ? ` Использовано тобой в разговоре: ${m.active}.` : '')
    }
  };
  const t = texts[kind];
  if (!t) return;
  try {
    tg.showPopup({ title: t.title, message: t.message, buttons: [{ type: 'ok' }] });
  } catch (e) {
    alert(`${t.title}\n\n${t.message}`);
  }
}
