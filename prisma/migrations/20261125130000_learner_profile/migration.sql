-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastLevelSuggestAt" TIMESTAMP(3),
ADD COLUMN "learnerProfile" TEXT,
ADD COLUMN "profileUpdatedAt" TIMESTAMP(3);
