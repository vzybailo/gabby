/*
  Warnings:

  - A unique constraint covering the columns `[userId,word]` on the table `VocabularyItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "VocabularyItem" ADD COLUMN     "usageCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyItem_userId_word_key" ON "VocabularyItem"("userId", "word");
