import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { conflictOr } from '../common/errors';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNamedDto, UpdateNamedDto } from './people.dto';

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- specialties
  async createSpecialty(t: TenantContext, dto: CreateNamedDto) {
    return this.prisma.specialty
      .create({ data: { name: dto.name, companyId: t.companyId } })
      .catch((e: unknown) => conflictOr(e, 'Specialty already exists'));
  }

  listSpecialties(t: TenantContext) {
    return this.prisma.specialty.findMany({
      where: { companyId: t.companyId },
      orderBy: { name: 'asc' },
    });
  }

  async updateSpecialty(t: TenantContext, id: string, dto: UpdateNamedDto) {
    const found = await this.prisma.specialty.findFirst({ where: { id, companyId: t.companyId } });
    if (!found) throw new NotFoundException('Specialty not found');
    return this.prisma.specialty
      .update({ where: { id }, data: dto })
      .catch((e: unknown) => conflictOr(e, 'Specialty already exists'));
  }

  async setMemberSpecialties(t: TenantContext, membershipId: string, specialtyIds: string[]) {
    const ids = [...new Set(specialtyIds)];
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id: membershipId, companyId: t.companyId },
      });
      if (!member) throw new NotFoundException('Member not found');
      const valid = await tx.specialty.count({
        where: { id: { in: ids }, companyId: t.companyId },
      });
      if (valid !== ids.length) throw new BadRequestException('Unknown specialty for this company');
      await tx.membershipSpecialty.deleteMany({ where: { membershipId } });
      await tx.membershipSpecialty.createMany({
        data: ids.map((specialtyId) => ({ membershipId, specialtyId })),
      });
      return { membershipId, specialtyIds: ids };
    });
  }

  // ---- teams
  async createTeam(t: TenantContext, actor: string, dto: CreateNamedDto) {
    const team = await this.prisma.team
      .create({ data: { name: dto.name, companyId: t.companyId } })
      .catch((e: unknown) => conflictOr(e, 'Team already exists'));
    await this.audit.record({
      companyId: t.companyId,
      actorUserId: actor,
      action: 'team.created',
      entityType: 'Team',
      entityId: team.id,
    });
    return team;
  }

  listTeams(t: TenantContext) {
    return this.prisma.team.findMany({
      where: { companyId: t.companyId },
      include: { members: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateTeam(t: TenantContext, id: string, dto: UpdateNamedDto) {
    const found = await this.prisma.team.findFirst({ where: { id, companyId: t.companyId } });
    if (!found) throw new NotFoundException('Team not found');
    return this.prisma.team
      .update({ where: { id }, data: dto })
      .catch((e: unknown) => conflictOr(e, 'Team already exists'));
  }

  async setTeamMembers(t: TenantContext, teamId: string, membershipIds: string[]) {
    const ids = [...new Set(membershipIds)];
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.findFirst({ where: { id: teamId, companyId: t.companyId } });
      if (!team) throw new NotFoundException('Team not found');
      const valid = await tx.membership.count({
        where: { id: { in: ids }, companyId: t.companyId, active: true },
      });
      if (valid !== ids.length) throw new BadRequestException('Unknown or inactive member');
      await tx.teamMember.deleteMany({ where: { teamId } });
      await tx.teamMember.createMany({
        data: ids.map((membershipId) => ({ teamId, membershipId })),
      });
      return { teamId, membershipIds: ids };
    });
  }
}
