import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, WorkOrder, WorkOrderStatus } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface ChecklistItemSnapshot {
  position: number;
  label: string;
  kind: 'CHECK' | 'TEXT' | 'NUMBER' | 'PHOTO';
  required: boolean;
}

export interface ServiceSnapshot {
  serviceId: string;
  name: string;
  checklistVersion: number | null;
  items: ChecklistItemSnapshot[];
}

/**
 * Locks the order row for the rest of the transaction, so concurrent commands
 * on the same order are serialized and each one sees the previous result.
 */
export async function lockOrder(tx: Tx, companyId: string, orderId: string): Promise<WorkOrder> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "WorkOrder" WHERE id = ${orderId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException('Work order not found');
  return tx.workOrder.findUniqueOrThrow({ where: { id: orderId } });
}

/** Compare-and-set on status; the order must already be locked by the caller. */
export async function transition(
  tx: Tx,
  order: WorkOrder,
  from: WorkOrderStatus[],
  to: WorkOrderStatus,
  extra: Prisma.WorkOrderUpdateManyMutationInput = {},
): Promise<void> {
  const res = await tx.workOrder.updateMany({
    where: { id: order.id, companyId: order.companyId, status: { in: from } },
    data: { ...extra, status: to, version: { increment: 1 } },
  });
  if (res.count !== 1) {
    throw new ConflictException(
      `Action not allowed while the order is ${order.status} (requires ${from.join(' or ')})`,
    );
  }
}

export function isExclusionViolation(e: unknown): boolean {
  return e instanceof Error && /assignment_no_overlap|exclusion constraint/i.test(e.message);
}
