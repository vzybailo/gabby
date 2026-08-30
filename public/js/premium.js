let isUserPremiumStatus = false; 

function initializePremiumUI(userData) {
    if (!userData) return;

    const upgradeBanner = document.getElementById('upgrade-btn');
    const goldNavItem = document.querySelector('.nav-item.gold');
    const premiumBadge = document.getElementById('premiumBadge');

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

    if (typeof isUserPremiumStatus !== 'undefined') {
        isUserPremiumStatus = isPremium;
    }

    if (isPremium) {
        if (upgradeBanner) upgradeBanner.style.setProperty('display', 'none', 'important');
        
        if (goldNavItem) goldNavItem.style.setProperty('display', '', 'important');
        
        if (typeof removeVisualLocks === 'function') {
            removeVisualLocks();
        }

        if (premiumBadge) {
            if (formattedDate) {
                premiumBadge.innerHTML = `⭐ Premium до <span>${formattedDate}</span>`;
            } else {
                premiumBadge.innerHTML = `⭐ Premium`;
            }
            premiumBadge.classList.remove('hidden');
            premiumBadge.style.setProperty('display', 'inline-block', 'important');
        }

        if (activeView) activeView.classList.remove('hidden');
        if (subscribeView) subscribeView.classList.add('hidden');
        if (activeUntilDate) {
            activeUntilDate.innerText = formattedDate || 'Бессрочно';
        }

    } else {
        if (upgradeBanner) upgradeBanner.style.setProperty('display', 'flex', 'important');
        if (goldNavItem) goldNavItem.style.setProperty('display', '', 'important');
        
        if (typeof addVisualLocks === 'function') {
            addVisualLocks();
        }

        if (premiumBadge) {
            premiumBadge.classList.add('hidden');
            premiumBadge.style.setProperty('display', 'none', 'important');
        }

        if (activeView) activeView.classList.add('hidden');
        if (subscribeView) subscribeView.classList.remove('hidden');
    }
}

function removeVisualLocks() {
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

const originalSelectVoice = window.selectVoice;
window.selectVoice = function(voiceId, element) {
    const freeVoices = ['alloy']; 
    
    if (!isUserPremiumStatus && !freeVoices.includes(voiceId)) {
        window.Telegram.WebApp.showAlert('💎 Этот голос доступен только в Premium-версии!');
        switchTab('premium', document.querySelector('.nav-item.gold'));
        return;
    }
    
    if (typeof originalSelectVoice === 'function') {
        originalSelectVoice(voiceId, element);
    }
};

const originalSelectStyle = window.selectStyle;
window.selectStyle = function(styleId, element) {
    const freeStyles = ['standard', 'teacher']; 
    
    if (!isUserPremiumStatus && !freeStyles.includes(styleId)) {
        window.Telegram.WebApp.showAlert('💎 Этот стиль речи доступен только в Premium-версии!');
        switchTab('premium', document.querySelector('.nav-item.gold'));
        return;
    }

    if (typeof originalSelectStyle === 'function') {
        originalSelectStyle(styleId, element);
    }
};

function togglePrice() {
  let isYearly = false;

  isYearly = !isYearly; 

  const priceEl = document.getElementById('proPrice');
  const badge = document.getElementById('saveBadge');
  const monthBtn = document.getElementById('btnMonthly');
  const yearBtn = document.getElementById('btnYearly');
  const toggle = document.getElementById('priceToggle');

  if (isYearly) {
    toggle.classList.add('yearly');
    priceEl.innerHTML = '$59.99<span style="font-size:14px;color:var(--text-dim)">/yr</span>';
    badge.style.display = 'block';
    monthBtn.classList.remove('active');
    yearBtn.classList.add('active');
  } else {
    toggle.classList.remove('yearly');
    priceEl.innerHTML = '$8.99<span style="font-size:14px;color:var(--text-dim)">/mo</span>';
    badge.style.display = 'none';
    monthBtn.classList.add('active');
    yearBtn.classList.remove('active');
  }
}