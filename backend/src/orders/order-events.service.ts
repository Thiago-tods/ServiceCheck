import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/request-context';
import { NotificationsService } from '../notifications/notifications.service';
import { Tx } from './order-state';

/**
 * Single funnel for everything that happens to an order: writes the audit entry,
 * bumps `updatedAt` (so sync pulls see child changes) and creates in-app notifications.
 * All of it runs in the caller's transaction.
 */
@Injectable()
export class OrderEventsService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async record(
    t: TenantContext,
    actor: string,
    orderId: string,
    action: string,
    metadata: object | undefined,
    tx: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        companyId: t.companyId,
        actorUserId: actor,
        action,
        entityType: 'WorkOrder',
        entityId: orderId,
        metadata: metadata,
      },
      tx,
    );
    const order = await tx.workOrder.update({
      where: { id: orderId },
      data: { updatedAt: new Date() },
      select: { number: true },
    });
    await this.notify(
      t,
      orderId,
      order.number,
      action,
      (metadata ?? {}) as Record<string, unknown>,
      tx,
    );
  }

  private async notify(
    t: TenantContext,
    orderId: string,
    number: number,
    action: string,
    meta: Record<string, unknown>,
    tx: Tx,
  ): Promise<void> {
    const base = { entityType: 'WorkOrder', entityId: orderId };
    const label = `Order #${number}`;
    const send = (to: string[], type: string, title: string) =>
      this.notifications.notify(tx, t.companyId, to, { type, title, ...base });

    switch (action) {
      case 'order.assigned':
        return send(
          [meta.membershipId as string],
          'order.assigned',
          `${label} was assigned to you`,
        );
      case 'order.unassigned':
        return send(
          [meta.membershipId as string],
          'order.unassigned',
          `${label} was unassigned from you`,
        );
      case 'order.cancelled': {
        const released = await tx.workOrderAssignment.findMany({
          where: { workOrderId: orderId, releaseReason: 'order cancelled' },
          select: { membershipId: true },
        });
        return send(
          released.map((r) => r.membershipId),
          'order.cancelled',
          `${label} was cancelled`,
        );
      }
      case 'order.reopened': {
        const active = await tx.workOrderAssignment.findMany({
          where: { workOrderId: orderId, releasedAt: null },
          select: { membershipId: true },
        });
        return send(
          active.map((a) => a.membershipId),
          'order.reopened',
          `${label} was reopened`,
        );
      }
      case 'execution.finished':
        if (meta.signature === 'SIGNED') {
          return send(
            await this.notifications.managers(tx, t.companyId),
            'approval.required',
            `${label} awaits approval`,
          );
        }
        return send(
          await this.notifications.managers(tx, t.companyId, true),
          'signature.review_required',
          `${label} needs a signature review`,
        );
      case 'order.signature_reviewed':
        if (meta.decision === 'ACCEPT') {
          return send(
            await this.notifications.managers(tx, t.companyId),
            'approval.required',
            `${label} awaits approval`,
          );
        } else {
          const primary = await tx.executionParticipant.findMany({
            where: { isPrimary: true, leftAt: null, execution: { workOrderId: orderId } },
            select: { membershipId: true },
          });
          return send(
            primary.map((p) => p.membershipId),
            'signature.returned',
            `${label} needs a new signature`,
          );
        }
      default:
        return;
    }
  }
}
