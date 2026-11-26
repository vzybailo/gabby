// Единый расчёт серии дней. Используется в профиле, статистике и при обновлении DailyStats.
// DailyStats.date хранит локальную дату пользователя как UTC-полночь,
// поэтому её строка YYYY-MM-DD уже является датой в часовом поясе пользователя.

export function localDateString(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

export function statDateString(date: Date | string): string {
    return new Date(date).toISOString().split('T')[0]!;
}

type StatLike = { date: Date | string; messagesCount: number; audioMinutes: number; wordsLearned: number };

export function activeDates(stats: StatLike[]): Set<string> {
    return new Set(
        stats
            .filter(s => s.date && (s.messagesCount > 0 || s.audioMinutes > 0 || s.wordsLearned > 0))
            .map(s => statDateString(s.date))
    );
}

/** Серия считается от сегодняшнего дня, а если сегодня ещё не занимался — от вчерашнего. */
export function calcStreak(dates: Set<string>, timezone: string, now = new Date()): number {
    const today = new Date(`${localDateString(now, timezone)}T00:00:00.000Z`);
    const check = new Date(today);

    if (!dates.has(statDateString(check))) {
        check.setUTCDate(check.getUTCDate() - 1);
        if (!dates.has(statDateString(check))) return 0;
    }

    let streak = 0;
    while (dates.has(statDateString(check))) {
        streak++;
        check.setUTCDate(check.getUTCDate() - 1);
    }
    return streak;
}

/** Самая длинная серия подряд идущих дней за всё время. */
export function calcBestStreak(dates: Set<string>): number {
    const sorted = [...dates].sort();
    let best = 0;
    let current = 0;
    let prev: Date | null = null;
    for (const s of sorted) {
        const d = new Date(`${s}T00:00:00.000Z`);
        current = prev && d.getTime() - prev.getTime() === 24 * 60 * 60 * 1000 ? current + 1 : 1;
        best = Math.max(best, current);
        prev = d;
    }
    return best;
}
