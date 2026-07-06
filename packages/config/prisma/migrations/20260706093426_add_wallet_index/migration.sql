/*
  Warnings:

  - A unique constraint covering the columns `[userId,chain,walletIndex]` on the table `Wallet` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Wallet_address_idx";

-- DropIndex
DROP INDEX "Wallet_chain_idx";

-- DropIndex
DROP INDEX "Wallet_userId_chain_key";

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "walletIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_walletIndex_idx" ON "Wallet"("userId", "walletIndex");

-- CreateIndex
CREATE INDEX "Wallet_address_chain_idx" ON "Wallet"("address", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_chain_walletIndex_key" ON "Wallet"("userId", "chain", "walletIndex");
