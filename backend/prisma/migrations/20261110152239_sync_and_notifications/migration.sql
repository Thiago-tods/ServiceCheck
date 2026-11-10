-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('APPLIED', 'CONFLICT', 'REJECTED');

-- CreateTable
CREATE TABLE "ProcessedOperation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" "OperationStatus" NOT NULL,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessedOperation_companyId_status_idx" ON "ProcessedOperation"("companyId", "status");

-- CreateIndex
CREATE INDEX "Notification_companyId_membershipId_readAt_idx" ON "Notification"("companyId", "membershipId", "readAt");
