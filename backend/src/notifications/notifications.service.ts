import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PageQuery } from '../common/pagination';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(
    tx: Prisma.TransactionClient,
    companyId: string,
    recipients: string[],
    input: NotificationInput,
  ): Promise<void> {
    const unique = [...new Set(recipients)];
    if (unique.length === 0) return;
    await tx.notification.createMany({
      data: unique.map((membershipId) => ({ companyId, membershipId, ...input })),
    });
  }

  /** Owners/Admins, plus members holding the explicit signature-review permission when asked. */
  async managers(
    tx: Prisma.TransactionClient,
    companyId: string,
    withReviewers = false,
  ): Promise<string[]> {
    const rows = await tx.membership.findMany({
      where: {
        companyId,
        active: true,
        OR: [
          { role: { in: [Role.OWNER, Role.ADMIN] } },
          ...(withReviewers ? [{ canReviewSignatures: true }] : []),
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  list(t: TenantContext, unreadOnly: boolean, page: PageQuery) {
    return this.prisma.notification.findMany({
      where: {
        companyId: t.companyId,
        membershipId: t.membershipId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: page.limit,
      skip: page.offset,
    });
  }

  async markRead(t: TenantContext, id: string) {
    const res = await this.prisma.notification.updateMany({
      where: { id, companyId: t.companyId, membershipId: t.membershipId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.notification.count({
        where: { id, companyId: t.companyId, membershipId: t.membershipId },
      });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { read: true };
  }

  async markAllRead(t: TenantContext) {
    const res = await this.prisma.notification.updateMany({
      where: { companyId: t.companyId, membershipId: t.membershipId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }
}
