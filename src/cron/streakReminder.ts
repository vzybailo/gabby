import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';

export function initStreakReminder(bot: TelegramBot) {
    cron.schedule('0 * * * *', async () => {
        console.log('⏰ Running Cron Job: Smart Streak Check');
        
        try {
            if (!prisma.user) return; 

            const usersWithStreak = await prisma.user.findMany({
                where: {
                    streakCount: { gt: 0 }
                }
            });

            for (const user of usersWithStreak) {
                try {
                    const userTimezone = user.timezone || 'UTC';
                    
                    const nowInUserTz = new Date().toLocaleString('en-US', { timeZone: userTimezone });
                    const userDateObj = new Date(nowInUserTz);
                    const currentHour = userDateObj.getHours();

                    if (currentHour !== 20) continue;

                    const getSafeDateString = (date: Date | string, tz: string) => {
                        return new Intl.DateTimeFormat('en-CA', { 
                            timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' 
                        }).format(new Date(date));
                    };

                    const todayStr = getSafeDateString(new Date(), userTimezone);
                    const lastActivityStr = getSafeDateString(user.lastActivityAt, userTimezone);

                    if (todayStr === lastActivityStr) continue;

                    await bot.sendMessage(
                        user.id, 
                        `🚨 <b>Your ${user.streakCount}-day streak is in danger!</b> 😱\n\nThe day is almost over in your timezone.\nSend a message now to save your progress!`, 
                        { parse_mode: 'HTML' }
                    );
                    
                    console.log(`✅ Sent reminder to ${user.id} (Time there: ${currentHour}:00)`);

                } catch (userError) {
                    console.error(`Error processing user ${user.id}:`, userError);
                }
            }
        } catch (e) {
            console.error('❌ Cron Job Fatal Error:', e);
        }
    });
    
    console.log('✅ Smart Streak Reminder initialized');
}
