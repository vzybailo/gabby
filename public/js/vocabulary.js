const MASTERED_REPETITION = 5;
const VOCAB_HINT_MAX_WORDS = 3; // подсказку «как добавить слово» показываем только новичкам

let vocabWords = [];
let vocabFilter = 'all';

function isDue(word) {
  return word.nextReview && new Date(word.nextReview) <= new Date();
}

function isLearned(word) {
  return (word.repetition || 0) >= MASTERED_REPETITION;
}

// Перевод с маленькой буквы (кроме имён собственных/аббревиатур, где вторая буква заглавная)
function formatTranslation(text = '') {
  const t = String(text).trim();
  if (t.length > 1 && t[1] === t[1].toLowerCase()) return t[0].toLowerCase() + t.slice(1);
  return t;
}

async function deleteWord(id, card) {
  if (!confirm('Удалить это слово?')) return;
  card.classList.add('deleting');

  try {
    const res = await apiFetch(`/api/vocabulary/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    vocabWords = vocabWords.filter(w => w.id !== id);
    setTimeout(renderVocabulary, 200);
  } catch (e) {
    alert('Не удалось удалить слово');
    card.classList.remove('deleting');
  }
}

async function loadVocabulary() {
  document.getElementById('quiz-container').style.display = 'none';
  const list = document.getElementById('vocab-list');

  try {
    const res = await apiFetch(`/api/vocabulary/${userId}`);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();
    vocabWords = data.words || [];
    renderVocabulary();
  } catch (e) {
    console.error(e);
    vocabWords = [];
    list.innerHTML = '<div class="empty-state">Не удалось загрузить слова.</div>';
    document.getElementById('vocab-actions').style.display = 'none';
    document.getElementById('vocab-filter').classList.add('hidden');
  }
}

function setVocabFilter(filter) {
  vocabFilter = filter;
  document.querySelectorAll('.vf-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  renderVocabulary();
}

function renderVocabulary() {
  const list = document.getElementById('vocab-list');
  const actions = document.getElementById('vocab-actions');
  const filterBar = document.getElementById('vocab-filter');
  const hint = document.getElementById('vocab-hint');

  const due = vocabWords.filter(isDue);
  const learned = vocabWords.filter(isLearned);

  hint.classList.toggle('hidden', vocabWords.length >= VOCAB_HINT_MAX_WORDS);
  filterBar.classList.toggle('hidden', vocabWords.length === 0);

  document.getElementById('vf-count-all').innerText = vocabWords.length;
  document.getElementById('vf-count-due').innerText = due.length;
  document.getElementById('vf-count-learned').innerText = learned.length;

  // Кнопка тренировки показывает, сколько слов ждут повторения
  actions.style.display = vocabWords.length ? 'flex' : 'none';
  const startBtn = document.getElementById('quiz-start-btn');
  document.getElementById('quiz-start-label').innerText = due.length
    ? `Повторить · ${due.length}`
    : 'Всё повторено ✓';
  startBtn.classList.toggle('done', due.length === 0);

  const shown = vocabFilter === 'due' ? due : vocabFilter === 'learned' ? learned : vocabWords;
  list.innerHTML = '';

  if (vocabWords.length === 0) {
    list.innerHTML = '<div class="empty-state">📪 Пока слов нет</div>';
    return;
  }
  if (shown.length === 0) {
    list.innerHTML = `<div class="empty-state">${vocabFilter === 'due' ? '🎉 Сейчас повторять нечего' : 'Пока нет выученных слов'}</div>`;
    return;
  }

  shown.forEach(w => list.appendChild(createVocabItem(w)));
}

function progressSegments(repetition = 0) {
  const filled = Math.min(repetition, MASTERED_REPETITION);
  let html = '';
  for (let i = 0; i < MASTERED_REPETITION; i++) html += `<i class="${i < filled ? 'on' : ''}"></i>`;
  return `<span class="v-progress ${filled >= MASTERED_REPETITION ? 'mastered' : ''}" title="Повторений: ${filled} из ${MASTERED_REPETITION}">${html}</span>`;
}

// Компактная карточка: слово, перевод и прогресс. Определение, пример и удаление — по нажатию.
function createVocabItem(word) {
  const el = document.createElement('div');
  el.className = 'vocab-item';
  el.innerHTML = `
  <div class="vocab-top">
    <div class="v-word">${escapeHtml(word.word)}</div>
    <div class="v-trans">${escapeHtml(formatTranslation(word.translation))}</div>
  </div>
  <div class="vocab-sub">
    ${progressSegments(word.repetition)}
    ${isDue(word) ? '<span class="v-due">повторить</span>' : ''}
  </div>
  <div class="vocab-details">
    ${word.definition ? `<div class="v-def">${escapeHtml(word.definition)}</div>` : ''}
    ${word.context ? `<div class="v-ctx">"${escapeHtml(word.context)}"</div>` : ''}
    <button class="v-delete" type="button">Удалить слово</button>
  </div>
  `;
  el.addEventListener('click', () => el.classList.toggle('open'));
  el.querySelector('.v-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteWord(word.id, el);
  });
  return el;
}
