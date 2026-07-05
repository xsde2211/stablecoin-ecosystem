/*
  Warnings:

  - A unique constraint covering the columns `[walletId,txHash]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Transaction_txHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_walletId_txHash_key" ON "Transaction"("walletId", "txHash");
