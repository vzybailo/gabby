import pkg from '@prisma/client';

const { PrismaClient } = pkg;

export const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

export async function checkDbConnection() {
  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL: Connected');
  } catch (e: any) {
    console.error('❌ PostgreSQL: Connection failed', e.message);
  }
}