renderCalendar();
loadData();
document.querySelectorAll('.accordion-item').forEach(item => syncAccValue(item));

// Ссылка из напоминания о повторении (?startapp=vocab) открывает сразу словарь
if (startParam === 'vocab') {
  switchTab('vocab', document.querySelector('.nav-item[onclick*="vocab"]'));
}
