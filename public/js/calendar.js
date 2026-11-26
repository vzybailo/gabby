let userDates = new Set();
let calDate = new Date();
let calMode = 'week'; // по умолчанию — компактная полоса текущей недели

function toggleCalendarMode() {
  calMode = calMode === 'week' ? 'month' : 'week';
  calDate = new Date();
  const card = document.querySelector('.calendar-card');
  if (card) card.classList.toggle('month-mode', calMode === 'month');
  const toggle = document.getElementById('calToggle');
  if (toggle) toggle.innerText = calMode === 'week' ? 'Весь месяц ▾' : 'Свернуть ▴';
  renderCalendar();
}

function setUserDates(dates) {
  userDates = new Set(dates);
}

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
    monthNameEl.innerText = calMode === 'week' ? 'Эта неделя' : `${monthNames[month]} ${year}`;
  }

  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => {
    const el = document.createElement('div');
    el.innerText = day;
    el.style.color = 'var(--text-dim)';
    el.style.fontSize = '12px';
    el.style.textAlign = 'center';
    grid.appendChild(el);
  });

  if (calMode === 'week') {
    renderWeek(grid);
    return;
  }

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

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderWeek(grid) {
  const dates = new Set(Array.from(userDates || []).map(d => String(d).split('T')[0]));
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const el = document.createElement('div');
    el.className = 'day';
    el.innerText = d.getDate();
    if (dates.has(dateKey(d))) el.classList.add('active');
    if (dateKey(d) === dateKey(today)) el.classList.add('today');
    if (d > today) el.classList.add('future');
    grid.appendChild(el);
  }
}
