import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';

function getDateString(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function getDateDifference(date1: string, date2: string): number {
    const first = new Date(`${date1}T00:00:00.000Z`);
    const second = new Date(`${date2}T00:00:00.000Z`);

    return Math.round(
        (first.getTime() - second.getTime()) / (1000 * 60 * 60 * 24)
    );
}

function getStreakMessage(streakCount: number): string {
    const dayWord =
        streakCount === 1
            ? 'дня'
            : streakCount >= 2 && streakCount <= 4
                ? 'дня'
                : 'дней';

    return `👋 <b>Эй, не потеряй свою серию!</b>

    Ты уже занимаешься ${streakCount} ${dayWord} подряд 🔥

    Сегодня ещё не было практики. Напиши мне пару слов на английском — и серия продолжится 😊`;
}

function getReengagementMessage(diffDays: number): string | null {
    if (diffDays === 3) {
        return `👋 <b>Привет!</b>

    Куда пропал? 😊
    Мы не практиковали английский уже 3 дня.

    Давай уделим ему хотя бы 5 минут сегодня?`;
    }

    if (diffDays === 7) {
        return `🇺🇸 <b>Привет! Я всё ещё здесь 😊</b>

    Уже целая неделя без практики.
    Давай сегодня немного поговорим на английском?

    Всего 5 минут — и ты снова в игре 🚀`;
    }

    if (diffDays === 14) {
        return `👋 <b>Мы тебя не забыли!</b>

    Прошло уже две недели без практики.
    Ничего страшного — такое бывает.

    Давай просто начнем с одного сообщения на английском 💪`;
    }

    return null;
}

export function initStreakReminder(bot: TelegramBot) {
    cron.schedule('0 * * * *', async () => {
        console.log('⏰ Running Cron Job: Smart Streak Check');

        try {
            if (!prisma.user) return;

            const users = await prisma.user.findMany({
                select: {
                    id: true,
                    timezone: true,
                    streakCount: true,
                    lastActivityAt: true,
                    lastStreakReminderAt: true
                }
            });

            for (const user of users) {
                try {
                    const userTimezone = user.timezone || 'UTC';

                    const now = new Date();

                    const userTimeString = new Intl.DateTimeFormat('en-US', {
                        timeZone: userTimezone,
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    }).format(now);

                    const [hour] = userTimeString.split(':').map(Number);

                    if (hour !== 20) continue;

                    const todayStr = getDateString(now, userTimezone);

                    const lastActivityStr = getDateString(
                        user.lastActivityAt,
                        userTimezone
                    );

                    const diffDays = getDateDifference(
                        todayStr,
                        lastActivityStr
                    );

                    if (diffDays <= 0) {
                        continue;
                    }

                    const lastReminderStr = user.lastStreakReminderAt
                        ? getDateString(
                            user.lastStreakReminderAt,
                            userTimezone
                        )
                        : null;

                    if (lastReminderStr === todayStr) {
                        continue;
                    }

                    let message: string | null = null;

                    if (
                        diffDays === 1 &&
                        user.streakCount > 0
                    ) {
                        message = getStreakMessage(user.streakCount);
                    }

                    if (!message) {
                        message = getReengagementMessage(diffDays);
                    }

                    if (!message) {
                        continue;
                    }

                    await bot.sendMessage(
                        user.id,
                        message,
                        {
                            parse_mode: 'HTML'
                        }
                    );

                    await prisma.user.update({
                        where: {
                            id: user.id
                        },
                        data: {
                            lastStreakReminderAt: new Date()
                        }
                    });

                    console.log(
                        `✅ Reminder sent to ${user.id} | ${diffDays} days inactive | Timezone: ${userTimezone}`
                    );

                } catch (userError) {
                    console.error(
                        `❌ Error processing user ${user.id}:`,
                        userError
                    );
                }
            }

        } catch (error) {
            console.error(
                '❌ Cron Job Fatal Error:',
                error
            );
        }
    });

    console.log('✅ Smart Streak Reminder initialized');
}