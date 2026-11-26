export interface ReviewItem {
    interval: number;
    repetition: number;
    easeFactor: number;
}

/**
 * SM-2. `quality` — оценка ответа по шкале 0–5:
 *   5 — правильно и быстро
 *   4 — правильно, но с раздумьем
 *   3 — правильно с опечаткой / с трудом
 *   0–2 — не вспомнил (слово уходит на переучивание)
 */
export function normalizeQuality(raw: unknown): number | null {
    const q = Number(raw);
    if (!Number.isFinite(q)) return null;
    return Math.min(5, Math.max(0, Math.round(q)));
}

export function calculateReview(item: ReviewItem, quality: number): ReviewItem {
    let { interval, repetition, easeFactor } = item;

    if (quality >= 3) {
        if (repetition === 0) {
            interval = 1;
        } else if (repetition === 1) {
            interval = 6;
        } else {
            interval = Math.round(interval * easeFactor);
        }
        repetition += 1;
    } else {
        repetition = 0;
        interval = 1;
    }

    easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    return { interval, repetition, easeFactor };
}
