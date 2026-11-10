import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { AddMemberDto, UpdateMemberDto } from './dto';

const PRIVILEGED: Role[] = [Role.OWNER, Role.ADMIN];

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext) {
    const rows = await this.prisma.membership.findMany({
      where: { companyId: tenant.companyId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      canReviewSignatures: m.canReviewSignatures,
      active: m.active,
    }));
  }

  /** Admins manage only Receptionist/Professional members; Owners manage everyone. */
  private assertCanManage(actor: TenantContext, targetRole: Role): void {
    if (actor.role === Role.OWNER) return;
    if (PRIVILEGED.includes(targetRole)) {
      throw new ForbiddenException('Only an Owner can manage Owners and Admins');
    }
  }

  async add(actor: TenantContext, actorUserId: string, dto: AddMemberDto) {
    this.assertCanManage(actor, dto.role);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new NotFoundException('No registered user with this e-mail');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { userId_companyId: { userId: user.id, companyId: actor.companyId } },
      });
      if (existing?.active) throw new ConflictException('User is already a member');
      this.assertExistingManageable(actor, existing?.role);

      const membership = existing
        ? await tx.membership.update({
            where: { id: existing.id },
            data: {
              role: dto.role,
              active: true,
              canReviewSignatures: dto.canReviewSignatures ?? false,
            },
          })
        : await tx.membership.create({
            data: {
              userId: user.id,
              companyId: actor.companyId,
              role: dto.role,
              canReviewSignatures: dto.canReviewSignatures ?? false,
            },
          });
      await this.audit.record(
        {
          companyId: actor.companyId,
          actorUserId,
          action: existing ? 'member.reactivated' : 'member.added',
          entityType: 'Membership',
          entityId: membership.id,
          metadata: { role: dto.role },
        },
        tx,
      );
      return membership;
    });
  }

  private assertExistingManageable(actor: TenantContext, role?: Role): void {
    if (role) this.assertCanManage(actor, role);
  }

  async update(actor: TenantContext, actorUserId: string, id: string, dto: UpdateMemberDto) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the company's owners so concurrent changes cannot remove the last one.
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "companyId" = ${actor.companyId}::uuid AND role = 'OWNER' AND active FOR UPDATE`;

      const target = await tx.membership.findFirst({
        where: { id, companyId: actor.companyId },
      });
      if (!target) throw new NotFoundException('Member not found');

      this.assertCanManage(actor, target.role);
      if (dto.role) this.assertCanManage(actor, dto.role);

      const losesOwner =
        target.role === Role.OWNER &&
        target.active &&
        ((dto.role !== undefined && dto.role !== Role.OWNER) || dto.active === false);
      if (losesOwner) {
        const owners = await tx.membership.count({
          where: { companyId: actor.companyId, role: Role.OWNER, active: true },
        });
        if (owners <= 1) throw new ConflictException('A company must keep at least one Owner');
      }

      const data: Prisma.MembershipUpdateInput = {};
      if (dto.role !== undefined) data.role = dto.role;
      if (dto.canReviewSignatures !== undefined) data.canReviewSignatures = dto.canReviewSignatures;
      if (dto.active !== undefined) data.active = dto.active;

      const updated = await tx.membership.update({ where: { id }, data });
      await this.audit.record(
        {
          companyId: actor.companyId,
          actorUserId,
          action: 'member.updated',
          entityType: 'Membership',
          entityId: id,
          metadata: { ...dto, previousRole: target.role, previousActive: target.active },
        },
        tx,
      );
      return updated;
    });
  }
}
