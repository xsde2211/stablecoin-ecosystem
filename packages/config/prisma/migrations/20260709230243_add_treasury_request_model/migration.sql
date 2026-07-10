-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'SIGNER';
ALTER TYPE "UserRole" ADD VALUE 'GUARDIAN';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "signerIndex" INTEGER;

-- CreateTable
CREATE TABLE "TreasuryRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "opType" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "targetAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "treasuryOpId" TEXT,
    "reviewedBy" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "TreasuryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TreasuryRequest_status_idx" ON "TreasuryRequest"("status");

-- CreateIndex
CREATE INDEX "TreasuryRequest_userId_idx" ON "TreasuryRequest"("userId");

-- AddForeignKey
ALTER TABLE "TreasuryRequest" ADD CONSTRAINT "TreasuryRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
