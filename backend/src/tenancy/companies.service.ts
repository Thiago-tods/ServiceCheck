import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Creating a company makes the creator its Owner, atomically. */
  create(userId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name, memberships: { create: { userId, role: Role.OWNER } } },
      });
      await this.audit.record(
        {
          companyId: company.id,
          actorUserId: userId,
          action: 'company.created',
          entityType: 'Company',
          entityId: company.id,
        },
        tx,
      );
      return { id: company.id, name: company.name, role: Role.OWNER };
    });
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, active: true },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ id: m.companyId, name: m.company.name, role: m.role }));
  }
}
