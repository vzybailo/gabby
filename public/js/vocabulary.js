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