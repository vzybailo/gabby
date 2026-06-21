import * as Diff from 'diff';

export function escapeHtml(unsafe: string | undefined | null): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDiffToHtml(text: string): string {
  let safeText = text;
  safeText = safeText.replace(/~([^~]+)~/g, '<s>$1</s>');
  safeText = safeText.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  safeText = safeText.replace(/<\/s>\s*<b>/g, '</s> <b>');
  return safeText;
}

function buildDiff(original: string, corrected: string): string {
  const changes = Diff.diffWordsWithSpace(original, corrected);
  return changes.map(part => {
    const text = escapeHtml(part.value);
    if (part.removed) return `~${text}~`; 
    if (part.added) return `*${text}*`;
    return text;
  }).join('');
}

export function generateMessageText(
  userText: string,
  analysis: any,
  mode: 'simple' | 'expanded_errors' | 'expanded_alternatives',
  streakCount: number = 0
): string {
  const safeUserText = escapeHtml(userText);
  let baseText = '';

  if (analysis.is_perfect) {
    baseText = `✅ <i>${safeUserText}</i>`;
  } else {
    const corrected = analysis.corrected || analysis.corrected_text || userText;
    const diffText = buildDiff(userText, corrected);
    const htmlDiff = formatDiffToHtml(diffText);
    baseText = `💡 <i>${htmlDiff}</i>`;
  }

  // === ДОБАВЛЕННЫЙ БЛОК: СТРОКА ПОХВАЛЫ ===
  let praiseText = '';
  if (analysis.praise && analysis.praise.trim().length > 0) {
    praiseText = `\n\n🎉 <b>${escapeHtml(analysis.praise)}</b>`;
  }

  const streakSuffix = streakCount > 0 ? `\n\n🔥 <b>Streak: ${streakCount} days</b>` : '';

  // Модифицируем каждый return, добавляя praiseText перед streakSuffix
  if (mode === 'simple') return baseText + praiseText + streakSuffix;

  if (mode === 'expanded_errors' && analysis.user_errors) {
    let errText = '';
    analysis.user_errors.forEach((err: any) => {
      const explanation = err.explanation_ru || err.explanation;
      errText += `\n\n🔻 <s>${escapeHtml(err.error_part)}</s> → <b>${escapeHtml(err.correction)}</b>`;
      errText += `\nℹ️ <i>${escapeHtml(explanation)}</i>`;
    });
    return baseText + errText + praiseText + streakSuffix;
  }

  if (mode === 'expanded_alternatives' && analysis.better_alternatives) {
    let altText = '\n';
    analysis.better_alternatives.forEach((alt: string) => {
      altText += `\n🔹 ${escapeHtml(alt)}`;
    });
    return baseText + altText + praiseText + streakSuffix;
  }
  
  return baseText + praiseText + streakSuffix;
}

export function generateDiffView(original: string, corrected: string): string {
  if (!original || !corrected || original.trim() === corrected.trim()) {
    return corrected;
  }

  const diff = Diff.diffWords(original, corrected);
  let result = '';

  diff.forEach((part) => {
    const val = part.value.trim();
    if (!val) return; 

    if (part.removed) {
      result += `~${val}~ `; 
    } else if (part.added) {
      result += `*${val}* `; 
    } else {
      result += `${val} `;
    }
  });

  return result
    .replace(/\s+/g, ' ') 
    .replace(/ \./g, '.')
    .replace(/ ,/g, ',')
    .replace(/ \?/g, '?')
    .replace(/ !/g, '!')
    .replace(/ '/g, "'")
    .trim();
}