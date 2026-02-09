import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../lib/prisma.js';

export function initStreakReminder(bot: TelegramBot) {
    cron.schedule('0 * * * *', async () => {
        console.log('⏰ Running Cron Job: Streak Check');
        const now = new Date();
        
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);

        try {
            if (!prisma.user) return; 

            const inactiveUsers = await prisma.user.findMany({
                where: {
                    streakCount: { gt: 0 },
                    lastActivityAt: {
                        lt: twentyFourHoursAgo,
                        gt: twentyFiveHoursAgo
                    }
                }
            });

            if (inactiveUsers.length > 0) {
                console.log(`🔎 Found ${inactiveUsers.length} users in danger zone`);
            }

            for (const user of inactiveUsers) {
                try {
                    await bot.sendMessage(
                        user.id, 
                        `🚨 <b>Your streak (${user.streakCount} days) is in danger!</b>\n\nDon't break the chain! Send me a message to keep it going.`, 
                        { parse_mode: 'HTML' }
                    );
                } catch (msgError) {
                    console.error(`Failed to send reminder to ${user.id}:`, msgError);
                }
            }
        } catch (e) {
            console.error('❌ Cron Job Error:', e);
        }
    });
    
    console.log('✅ Cron Job initialized');
}