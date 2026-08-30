let userDates = new Set();
let calDate = new Date();

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
  
  const monthNames = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", 
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
  ];

  const monthNameEl = document.getElementById('monthName');
  if (monthNameEl) {
    monthNameEl.innerText = `${monthNames[month]} ${year}`;
  }

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

  let firstDayIndex = new Date(Date.UTC(year, month, 1)).getUTCDay();
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

  const normalizedUserDates = new Set();
  if (typeof userDates !== 'undefined' && userDates) {
    const datesArray = userDates instanceof Set ? Array.from(userDates) : userDates;
    datesArray.forEach(dateStr => {
      if (typeof dateStr === 'string' && dateStr.length >= 10) {
        normalizedUserDates.add(dateStr.split('T')[0]);
      }
    });
  }

  for (let d = 1; d <= lastDay; d++) {
    const el = document.createElement('div');
    el.className = 'day';
    el.innerText = d;

    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(d).padStart(2, '0');
    const key = `${year}-${monthStr}-${dayStr}`;

    if (normalizedUserDates.has(key)) {
      el.classList.add('active');
    }

    if (isCurrentMonth && d === today.getDate()) {
      el.classList.add('today');
    }

    grid.appendChild(el);
  }
}