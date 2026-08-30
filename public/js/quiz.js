let quizQueue = [];
let currentCard = null;

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
    const response = await fetch(`/api/vocabulary/review/${userId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            wordId: currentCard.id,
            quality
        })
    });

    const data = await response.json();

    if (data.mastered) {
        showMasteredPopup(data.word);
        loadData();
    }
  } catch (e) {
  console.error(e);
  }
}

function showMasteredPopup(word) {
    Telegram.WebApp.showAlert(
`🎉 Поздравляем!

Слово

"${word}"

официально перешло в категорию выученных! ⭐

Теперь оно будет повторяться значительно реже, а твой прогресс увеличился.

Продолжай в том же духе! 🚀`
    );
}