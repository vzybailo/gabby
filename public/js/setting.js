let currentAudio = null;

function switchTab(id, el) {
  stopVoicePreview();
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`tab-${id}`).classList.add('active');

  if (!el && id === 'premium') {
  el = document.querySelector('.nav-item.gold');
  }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');

  if (id === 'vocab') loadVocabulary();
  tg.HapticFeedback?.selectionChanged();
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
  // Play first: iOS blocks audio that starts after an await (user gesture is lost)
  const btn = el.querySelector('.voice-play');
  if (btn) playVoicePreview(val, btn, { forcePlay: true });
  await saveSetting({ voice: val });
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

let currentPreviewBtn = null;

function setPreviewPlaying(btn, isPlaying) {
  if (!btn) return;
  btn.classList.toggle('playing', isPlaying);
  btn.setAttribute('aria-pressed', String(isPlaying));
}

function stopVoicePreview() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  setPreviewPlaying(currentPreviewBtn, false);
  currentPreviewBtn = null;
}

// Plays a voice sample. Tapping the same ▶ again stops it (unless forcePlay).
function playVoicePreview(voice, btn, { forcePlay = false } = {}) {
  const isSameAndPlaying = currentPreviewBtn === btn && currentAudio && !currentAudio.paused;
  stopVoicePreview();
  if (isSameAndPlaying && !forcePlay) return;

  tg.HapticFeedback?.impactOccurred('light');

  const audio = new Audio(`/audio/${voice}.mp3`);
  currentAudio = audio;
  currentPreviewBtn = btn;
  setPreviewPlaying(btn, true);

  const reset = () => {
    if (currentAudio !== audio) return;
    setPreviewPlaying(btn, false);
    currentAudio = null;
    currentPreviewBtn = null;
  };
  audio.addEventListener('ended', reset);
  audio.addEventListener('error', reset);
  audio.play().catch(reset);
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
