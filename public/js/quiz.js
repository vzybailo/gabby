// Тренировка активного словаря: пользователь сам вспоминает и вводит слово.
// Оценка для SRS (SM-2, шкала 0–5) выставляется автоматически по ответу.

const MAX_RETRIES = 2; // сколько раз переспрашивать забытое слово в рамках сессии

let quizQueue = [];
let currentCard = null;
let cardShownAt = 0;
let answered = false;
let sessionStats = { total: 0, correct: 0, typo: 0, wrong: 0 };

// ---------- helpers ----------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAnswer(str = '') {
  return String(str)
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^to /, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Регулярка, которая ловит слово и его формы: achieve → achieved/achieving, study → studied.
function buildWordRegex(word) {
  const parts = normalizeAnswer(word).split(' ').filter(Boolean);
  if (parts.length === 0) return null;

  const last = parts[parts.length - 1];
  let lastPattern = escapeRegex(last);
  if (last.length > 3 && /e$/.test(last)) lastPattern = escapeRegex(last.slice(0, -1)) + 'e?';
  else if (last.length > 3 && /y$/.test(last)) lastPattern = escapeRegex(last.slice(0, -1)) + '(?:y|i)';
  lastPattern += "[a-z]*";

  const head = parts.slice(0, -1).map(escapeRegex);
  return new RegExp(`\\b${[...head, lastPattern].join('\\s+')}\\b`, 'gi');
}

function maskForm(form) {
  return form
    .split(/(\s+)/)
    .map(chunk => (/\s/.test(chunk) ? ' ' : chunk[0] + '_'.repeat(Math.max(0, chunk.length - 1))))
    .join('');
}

// Возвращает { html, forms }: текст с замаскированным словом и найденные формы слова.
function maskText(text, word) {
  const regex = buildWordRegex(word);
  if (!text || !regex) return { html: escapeHtml(text || ''), forms: [] };

  let html = '';
  let lastIndex = 0;
  const forms = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    forms.push(match[0]);
    html += escapeHtml(text.slice(lastIndex, match.index));
    html += `<span class="q-blank">${escapeHtml(maskForm(match[0]))}</span>`;
    lastIndex = match.index + match[0].length;
  }
  html += escapeHtml(text.slice(lastIndex));
  return { html, forms };
}

// ---------- session flow ----------

async function startQuiz() {
  document.getElementById('vocab-list').innerHTML = '<div style="text-align:center;color:var(--text-dim);">Загрузка тренировки...</div>';
  try {
    const res = await apiFetch(`/api/vocabulary/review/${userId}`);
    const data = await res.json();
    quizQueue = (data.words || []).map(w => ({ ...w, retries: 0, reviewed: false }));

    if (quizQueue.length === 0) {
      showAlert('🎉 На сегодня все слова повторены! Возвращайтесь позже.');
      loadVocabulary();
      return;
    }

    sessionStats = { total: quizQueue.length, correct: 0, typo: 0, wrong: 0 };
    toggleQuizUI(true);
    showNextCard();
  } catch (e) {
    console.error(e);
    showAlert('Не удалось начать тренировку');
    loadVocabulary();
  }
}

function stopQuiz() {
  toggleQuizUI(false);
  loadVocabulary();
}

function toggleQuizUI(show) {
  document.getElementById('quiz-container').style.display = show ? 'flex' : 'none';
  // Во время тренировки прячем список, фильтр, подсказку и кнопку старта
  ['vocab-list', 'vocab-actions', 'vocab-filter', 'vocab-hint'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('quiz-hidden', show);
  });
}

function showNextCard() {
  if (quizQueue.length === 0) {
    showSummary();
    return;
  }

  currentCard = quizQueue[0];
  answered = false;
  renderPrompt();
  cardShownAt = Date.now();
}

function renderPrompt() {
  const card = currentCard;
  const ctx = maskText(card.context, card.word);
  const def = maskText(card.definition, card.word);

  // Если в примере слово не нашлось (неправильная форма вроде ran/run) — не показываем пример,
  // чтобы не выдать ответ.
  const contextHtml = card.context && ctx.forms.length > 0
    ? `<div class="q-context">${ctx.html}</div>`
    : `<div class="q-context q-blank-only"><span class="q-blank">${escapeHtml(maskForm(card.word))}</span></div>`;

  card.acceptedForms = [card.word, ...ctx.forms];

  document.getElementById('quiz-card').innerHTML = `
    <div class="flip-hint">${card.retries > 0 ? 'Ещё раз' : 'Вспомните слово'}</div>
    <div class="q-trans-prompt">🇷🇺 ${escapeHtml(card.translation)}</div>
    ${contextHtml}
    ${card.definition ? `<div class="q-def">💡 ${def.html}</div>` : ''}
  `;

  document.getElementById('quiz-progress').innerText =
    `Осталось: ${quizQueue.length} · Верно: ${sessionStats.correct + sessionStats.typo}`;

  const input = document.getElementById('q-input');
  input.value = '';
  input.disabled = false;
  input.className = 'q-input';
  document.getElementById('quiz-answer').style.display = 'flex';
  document.getElementById('q-next').style.display = 'none';
  input.focus();
}

function gradeAnswer(raw) {
  const answer = normalizeAnswer(raw);
  if (!answer) return { verdict: 'wrong', quality: 0 };

  const accepted = currentCard.acceptedForms.map(normalizeAnswer);
  const distance = Math.min(...accepted.map(f => levenshtein(answer, f)));
  const target = normalizeAnswer(currentCard.word);
  const allowedTypos = target.length <= 4 ? 0 : target.length <= 8 ? 1 : 2;

  if (distance === 0) {
    const seconds = (Date.now() - cardShownAt) / 1000;
    const fastLimit = 6 + target.length * 0.3;
    return { verdict: 'correct', quality: seconds <= fastLimit ? 5 : 4 };
  }
  if (distance <= allowedTypos) return { verdict: 'typo', quality: 3 };
  return { verdict: 'wrong', quality: 1 };
}

function checkAnswer(event) {
  if (event) event.preventDefault();
  if (answered || !currentCard) return;
  const value = document.getElementById('q-input').value;
  if (!normalizeAnswer(value)) return; // пустой ввод — для этого есть «Не помню»
  submitResult(value, gradeAnswer(value));
}

function giveUp() {
  if (answered || !currentCard) return;
  submitResult('', { verdict: 'wrong', quality: 0 });
}

function submitResult(rawAnswer, result) {
  answered = true;
  const card = currentCard;
  quizQueue.shift();

  // В SRS идёт только первая попытка за сессию.
  if (!card.reviewed) {
    card.reviewed = true;
    sessionStats[result.verdict] += 1;
    sendReview(card, result.quality);
  }

  // Забытое слово переспрашиваем через пару карточек.
  if (result.verdict === 'wrong' && card.retries < MAX_RETRIES) {
    card.retries += 1;
    quizQueue.splice(Math.min(2, quizQueue.length), 0, card);
  }

  renderResult(card, rawAnswer, result.verdict);
}

function renderResult(card, rawAnswer, verdict) {
  const titles = {
    correct: '✅ Верно!',
    typo: '🟡 Почти! Небольшая опечатка',
    wrong: rawAnswer ? '❌ Неверно' : '📖 Запомните'
  };

  const contextHtml = card.context
    ? `<div class="q-context q-context-revealed">${escapeHtml(card.context)}</div>`
    : '';

  document.getElementById('quiz-card').innerHTML = `
    <div class="flip-hint q-verdict ${verdict}">${titles[verdict]}</div>
    <div class="q-word">${escapeHtml(card.word)}</div>
    <div class="q-trans">${escapeHtml(card.translation)}</div>
    ${rawAnswer && verdict !== 'correct' ? `<div class="q-your">Ваш ответ: <s>${escapeHtml(rawAnswer)}</s></div>` : ''}
    ${contextHtml}
    ${verdict === 'wrong' && card.retries > 0 ? '<div class="q-retry-note">Спросим это слово ещё раз в этой тренировке</div>' : ''}
  `;

  const input = document.getElementById('q-input');
  input.disabled = true;
  input.className = `q-input ${verdict}`;
  document.getElementById('quiz-answer').style.display = 'none';
  const next = document.getElementById('q-next');
  next.style.display = 'flex';
  next.focus();
}

function nextCard() {
  if (!answered) return;
  showNextCard();
}

async function sendReview(card, quality) {
  try {
    const response = await apiFetch(`/api/vocabulary/review/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wordId: card.id, quality })
    });
    const data = await response.json();
    if (data.mastered) {
      showMasteredPopup(data.word);
      if (typeof loadData === 'function') loadData();
    }
  } catch (e) {
    console.error(e);
  }
}

function showSummary() {
  const { total, correct, typo, wrong } = sessionStats;
  document.getElementById('quiz-card').innerHTML = `
    <div class="flip-hint">Тренировка завершена</div>
    <div class="q-summary-emoji">🎉</div>
    <div class="q-summary">
      <div><b>${correct}</b><span>верно</span></div>
      <div><b>${typo}</b><span>с опечаткой</span></div>
      <div><b>${wrong}</b><span>забыто</span></div>
    </div>
    <div class="q-trans">Слов в тренировке: ${total}</div>
  `;
  document.getElementById('quiz-progress').innerText = '';
  document.getElementById('quiz-answer').style.display = 'none';
  const next = document.getElementById('q-next');
  next.style.display = 'none';
  answered = false;
  currentCard = null;
}

function showAlert(text) {
  try {
    Telegram.WebApp.showAlert(text);
  } catch (e) {
    alert(text); // вне Telegram (или в старом клиенте) showAlert недоступен
  }
}

function showMasteredPopup(word) {
  showAlert(
`🎉 Поздравляем!

Слово

"${word}"

официально перешло в категорию выученных! ⭐

Теперь оно будет повторяться значительно реже, а твой прогресс увеличился.

Продолжай в том же духе! 🚀`
  );
}

// Enter на экране результата — следующая карточка.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !answered) return;
  const quiz = document.getElementById('quiz-container');
  if (!quiz || quiz.style.display === 'none') return;
  e.preventDefault();
  nextCard();
});
