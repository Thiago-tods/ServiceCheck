import { Injectable } from '@nestjs/common';
import { Role, WorkOrderStatus } from '@prisma/client';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(t: TenantContext) {
    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const scope =
      t.role === Role.PROFESSIONAL
        ? { assignments: { some: { membershipId: t.membershipId } } }
        : {};
    const where = { companyId: t.companyId, ...scope };

    const [byStatus, today, overdue, unassigned] = await Promise.all([
      this.prisma.workOrder.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.workOrderAssignment.count({
        where: {
          companyId: t.companyId,
          releasedAt: null,
          startsAt: { lt: endOfDay },
          endsAt: { gt: startOfDay },
          ...(t.role === Role.PROFESSIONAL ? { membershipId: t.membershipId } : {}),
        },
      }),
      // Scheduled work whose window already ended without anyone starting it.
      this.prisma.workOrder.count({
        where: {
          ...where,
          status: 'SCHEDULED',
          assignments: { some: { releasedAt: null, endsAt: { lt: now } } },
        },
      }),
      t.role === Role.PROFESSIONAL
        ? Promise.resolve(0)
        : this.prisma.workOrder.count({ where: { companyId: t.companyId, status: 'OPEN' } }),
    ]);

    const counts = Object.fromEntries(
      (Object.values(WorkOrderStatus) as WorkOrderStatus[]).map((s) => [s, 0]),
    ) as Record<WorkOrderStatus, number>;
    for (const row of byStatus) counts[row.status] = row._count._all;

    return {
      byStatus: counts,
      scheduledToday: today,
      overdue,
      unassigned,
      needsAttention: {
        signatureReview: counts.SIGNATURE_REVIEW,
        pendingApproval: counts.PENDING_APPROVAL,
      },
      generatedAt: now,
    };
  }
}
