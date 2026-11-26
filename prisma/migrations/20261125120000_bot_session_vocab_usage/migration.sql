-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastReviewReminderAt" TIMESTAMP(3),
ADD COLUMN "lastErrorDigestAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VocabularyItem" ADD COLUMN "usedInChatCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastUsedInChatAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "VocabularyItem_userId_nextReview_idx" ON "VocabularyItem"("userId", "nextReview");

-- CreateTable
CREATE TABLE "BotSession" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "BotSession_createdAt_idx" ON "BotSession"("createdAt");
