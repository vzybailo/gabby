export interface ReviewItem {
    interval: number;
    repetition: number;
    easeFactor: number;
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