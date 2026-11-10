CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'SCHEDULED', 'IN_PROGRESS', 'SIGNATURE_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('SIGNED', 'REFUSED', 'ABSENT');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('ACCEPT', 'RETURN');

-- CreateTable
CREATE TABLE "WorkOrderCounter" (
    "companyId" UUID NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkOrderCounter_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "checklistVersionId" UUID,
    "clientSnapshot" JSONB NOT NULL,
    "serviceSnapshot" JSONB NOT NULL,
    "cancelReason" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderAssignment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" UUID,
    "releaseReason" TEXT,

    CONSTRAINT "WorkOrderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "reopenReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionParticipant" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "ExecutionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionChecklistItem" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "ChecklistItemKind" NOT NULL,
    "required" BOOLEAN NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "value" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" UUID,

    CONSTRAINT "ExecutionChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionNote" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "status" "SignatureStatus" NOT NULL,
    "signerName" TEXT,
    "reason" TEXT,
    "image" BYTEA,
    "capturedBy" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureReview" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrder_companyId_status_idx" ON "WorkOrder"("companyId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_companyId_clientId_idx" ON "WorkOrder"("companyId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_companyId_number_key" ON "WorkOrder"("companyId", "number");

-- CreateIndex
CREATE INDEX "WorkOrderAssignment_companyId_membershipId_idx" ON "WorkOrderAssignment"("companyId", "membershipId");

-- CreateIndex
CREATE INDEX "WorkOrderAssignment_workOrderId_idx" ON "WorkOrderAssignment"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_workOrderId_sequence_key" ON "Execution"("workOrderId", "sequence");

-- CreateIndex
CREATE INDEX "ExecutionParticipant_executionId_idx" ON "ExecutionParticipant"("executionId");

-- CreateIndex
CREATE INDEX "ExecutionParticipant_membershipId_idx" ON "ExecutionParticipant"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionChecklistItem_executionId_position_key" ON "ExecutionChecklistItem"("executionId", "position");

-- CreateIndex
CREATE INDEX "ExecutionNote_executionId_idx" ON "ExecutionNote"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_executionId_key" ON "Signature"("executionId");

-- CreateIndex
CREATE INDEX "SignatureReview_executionId_idx" ON "SignatureReview"("executionId");

-- AddForeignKey
ALTER TABLE "WorkOrderCounter" ADD CONSTRAINT "WorkOrderCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAssignment" ADD CONSTRAINT "WorkOrderAssignment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAssignment" ADD CONSTRAINT "WorkOrderAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionParticipant" ADD CONSTRAINT "ExecutionParticipant_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionParticipant" ADD CONSTRAINT "ExecutionParticipant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionChecklistItem" ADD CONSTRAINT "ExecutionChecklistItem_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionNote" ADD CONSTRAINT "ExecutionNote_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureReview" ADD CONSTRAINT "SignatureReview_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Availability: a professional cannot hold two active assignments with overlapping time ranges.
-- Enforced in the database so concurrent requests cannot both succeed.
ALTER TABLE "WorkOrderAssignment"
  ADD CONSTRAINT assignment_no_overlap
  EXCLUDE USING gist (
    "membershipId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("releasedAt" IS NULL);

ALTER TABLE "WorkOrderAssignment"
  ADD CONSTRAINT assignment_valid_range CHECK ("endsAt" > "startsAt");

-- At most one active primary assignment per order.
CREATE UNIQUE INDEX assignment_one_primary
  ON "WorkOrderAssignment" ("workOrderId")
  WHERE "isPrimary" AND "releasedAt" IS NULL;

-- At most one active primary participant per execution.
CREATE UNIQUE INDEX participant_one_primary
  ON "ExecutionParticipant" ("executionId")
  WHERE "isPrimary" AND "leftAt" IS NULL;

-- An order has at most one execution that is not finished.
CREATE UNIQUE INDEX execution_one_open
  ON "Execution" ("workOrderId")
  WHERE "status" <> 'FINISHED';

-- Executions are never deleted (history is preserved).
CREATE OR REPLACE FUNCTION prevent_history_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_no_delete BEFORE DELETE ON "Execution"
FOR EACH ROW EXECUTE FUNCTION prevent_history_delete();
CREATE TRIGGER assignment_no_delete BEFORE DELETE ON "WorkOrderAssignment"
FOR EACH ROW EXECUTE FUNCTION prevent_history_delete();
CREATE TRIGGER workorder_no_delete BEFORE DELETE ON "WorkOrder"
FOR EACH ROW EXECUTE FUNCTION prevent_history_delete();
CREATE TRIGGER signature_review_no_delete BEFORE DELETE ON "SignatureReview"
FOR EACH ROW EXECUTE FUNCTION prevent_history_delete();