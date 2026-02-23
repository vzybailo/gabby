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
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

fetch('/api/settings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    userId: window.Telegram.WebApp.initDataUnsafe.user.id.toString(),
    timezone: userTimezone 
  })
});

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
      list.innerHTML = `<div class="empty-state">📪 ...No words...</div>`;
      
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
  } else if (user) {
    document.getElementById('userName').innerText = user.first_name;
  }

  try {
    const [profileRes, statsRes] = await Promise.all([
      fetch(`/api/user/${userId}`),
      fetch(`/api/user/${userId}/stats`)
    ]);

    if (!profileRes.ok) throw new Error('Profile fetch failed');
    const profileData = await profileRes.json();

    const levelText = profileData.level || 'A1';
    document.getElementById('userLevelBadge').innerText = levelText;

    if (profileData.voice) {
      setActiveOption('acc-voice-timbre', profileData.voice);
    }
    if (profileData.speakingStyle) {
      setActiveOption('acc-style', profileData.speakingStyle);
    }
    if (profileData.mode) {
      setActiveOption('acc-mode', profileData.mode);
    }
    if (profileData.level) {
      setActiveOption('acc-level', profileData.level);
    }

    if (profileData.dates) {
      userDates = new Set(profileData.dates);
      renderCalendar();
    }

    let statsData = {};
    if (statsRes.ok) {
      statsData = await statsRes.json();
    }

    document.getElementById('streakVal').innerText = statsData.streak || 0;
    document.getElementById('totalMinutesVal').innerText = statsData.totalMinutes || 0;
    
    const wordsVal = statsData.wordsLearned || 0;
    const wordsEl = document.getElementById('wordsLearnedVal');
    if (wordsEl) {
      wordsEl.innerText = wordsVal;
      wordsEl.style.color = '';
      if (wordsVal >= 50) wordsEl.style.color = '#818cf8';
      if (wordsVal >= 200) wordsEl.style.color = '#fbbf24';
    }

    const scoreVal = Math.round(statsData.avgScore || 0);
    const scoreEl = document.getElementById('avgScoreVal');
    
    if (scoreEl) {
      scoreEl.innerText = scoreVal + '%';
      scoreEl.style.color = '';
      
      if (scoreVal >= 80) scoreEl.style.color = '#34d399';
      else if (scoreVal >= 50) scoreEl.style.color = '#fbbf24';
      else scoreEl.style.color = '#ef4444';
    }

  } catch (e) {
    console.error("Data load error:", e);
    
    document.getElementById('userLevelBadge').innerText = 'A1';
    const scoreEl = document.getElementById('avgScoreVal');
    if (scoreEl) {
      scoreEl.innerText = '0%';
      scoreEl.style.color = '#ef4444';
    }
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
  grid.innerHTML = '';

  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  document.getElementById('monthName').innerText = `${monthNames[month]} ${year}`;

  ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach(day => {
  const el = document.createElement('div');
  el.innerText = day;
  el.style.color = 'var(--text-dim)';
  el.style.fontSize = '12px';
  el.style.textAlign = 'center';
  grid.appendChild(el);
  });

  const lastDay = new Date(year, month + 1, 0).getDate();
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  let firstDayIndex = new Date(year, month, 1).getDay();
  firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

  for (let i = firstDayIndex; i > 0; i--) {
  const dayNum = prevMonthLastDay - i + 1;
  const el = document.createElement('div');
  el.className = 'day other-month';
  el.innerText = dayNum;
  grid.appendChild(el);
  }

  const today = new Date();
  const isCurrentMonth = (today.getFullYear() === year && today.getMonth() === month);

  for (let d = 1; d <= lastDay; d++) {
  const el = document.createElement('div');
  el.className = 'day';
  el.innerText = d;

  const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  
  if (userDates.has(key)) el.classList.add('active');
  if (isCurrentMonth && d === today.getDate()) el.classList.add('today');

  grid.appendChild(el);
  }

  const totalCellsFilled = firstDayIndex + lastDay;
  const nextMonthDaysNeeded = 7 - (totalCellsFilled % 7);

  if (nextMonthDaysNeeded < 7) {
  for (let d = 1; d <= nextMonthDaysNeeded; d++) {
    const el = document.createElement('div');
    el.className = 'day other-month';
    el.innerText = d;
    grid.appendChild(el);
  }
  }
}

function togglePrice() {
  isYearly = !isYearly;

  const priceEl = document.getElementById('proPrice');
  const badge = document.getElementById('saveBadge');
  const monthBtn = document.getElementById('btnMonthly');
  const yearBtn = document.getElementById('btnYearly');
  const toggle = document.getElementById('priceToggle');

  if (isYearly) {
  toggle.classList.add('yearly');
  priceEl.innerHTML = '$40<span style="font-size:14px;color:var(--text-dim)">/yr</span>';
  badge.style.display = 'block';
  monthBtn.classList.remove('active');
  yearBtn.classList.add('active');
  } else {
  toggle.classList.remove('yearly');
  priceEl.innerHTML = '$5<span style="font-size:14px;color:var(--text-dim)">/mo</span>';
  badge.style.display = 'none';
  monthBtn.classList.add('active');
  yearBtn.classList.remove('active');
  }
}

function buyPremium() {
  tg.showPopup({
  title: 'Pro Plan',
  message: 'Coming soon!',
  buttons: [{ type: 'ok' }]
  });
}

function inviteFriends() {
  const link = 'https://t.me/SpeakWithMeNowBot?start=invite';
  const shareText = '🔥 Нашел крутого ИИ-репетитора по английскому в Телеграме! Можно общаться голосом как с настоящим нейтивом, прокачивать произношение и ломать языковой барьер. Залетай по ссылке 👇';
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
  
  tg.openTelegramLink(telegramUrl);
}

loadData();
