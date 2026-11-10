import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { OrderEventsService } from './order-events.service';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { isExclusionViolation, lockOrder, transition, Tx } from './order-state';
import { AgendaQuery, AssignDto } from './orders.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderEventsService,
  ) {}

  private log(
    t: TenantContext,
    actor: string,
    orderId: string,
    action: string,
    metadata: object | undefined,
    tx: Tx,
  ) {
    return this.events.record(t, actor, orderId, action, metadata, tx);
  }

  async assign(t: TenantContext, actor: string, orderId: string, dto: AssignDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!(endsAt > startsAt)) throw new BadRequestException('endsAt must be after startsAt');
    if (endsAt.getTime() - startsAt.getTime() > 14 * DAY_MS) {
      throw new BadRequestException('An assignment cannot exceed 14 days');
    }

    try {
      return await this.prisma.transactional(async (tx) => {
        const order = await lockOrder(tx, t.companyId, orderId);
        if (!['OPEN', 'SCHEDULED', 'IN_PROGRESS'].includes(order.status)) {
          throw new ConflictException(`Cannot assign while the order is ${order.status}`);
        }
        const member = await tx.membership.findFirst({
          where: { id: dto.membershipId, companyId: t.companyId, active: true },
        });
        if (!member) throw new NotFoundException('Member not found or inactive');

        // Friendly pre-check; the database exclusion constraint is the real guarantee.
        const clash = await tx.workOrderAssignment.findFirst({
          where: {
            membershipId: member.id,
            releasedAt: null,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          include: { workOrder: { select: { id: true, number: true } } },
        });
        if (clash) {
          throw new ConflictException({
            message: 'Availability conflict',
            conflict: {
              workOrderId: clash.workOrder.id,
              number: clash.workOrder.number,
              startsAt: clash.startsAt,
              endsAt: clash.endsAt,
            },
          });
        }

        const active = await tx.workOrderAssignment.findMany({
          where: { workOrderId: orderId, releasedAt: null },
        });
        const makePrimary = dto.isPrimary === true || active.length === 0;
        if (makePrimary) {
          await tx.workOrderAssignment.updateMany({
            where: { workOrderId: orderId, releasedAt: null, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        const assignment = await tx.workOrderAssignment.create({
          data: {
            companyId: t.companyId,
            workOrderId: orderId,
            membershipId: member.id,
            isPrimary: makePrimary,
            startsAt,
            endsAt,
            createdBy: actor,
          },
        });

        if (order.status === 'OPEN') await transition(tx, order, ['OPEN'], 'SCHEDULED');
        if (order.status === 'IN_PROGRESS')
          await this.joinRunningExecution(tx, orderId, member.id, makePrimary);

        await this.log(
          t,
          actor,
          orderId,
          'order.assigned',
          {
            assignmentId: assignment.id,
            membershipId: member.id,
            isPrimary: makePrimary,
            startsAt,
            endsAt,
          },
          tx,
        );
        return assignment;
      });
    } catch (e) {
      if (isExclusionViolation(e)) throw new ConflictException('Availability conflict');
      throw e;
    }
  }

  private async joinRunningExecution(
    tx: Prisma.TransactionClient,
    orderId: string,
    membershipId: string,
    makePrimary: boolean,
  ) {
    const execution = await tx.execution.findFirst({
      where: { workOrderId: orderId, status: 'IN_PROGRESS' },
    });
    if (!execution) return;
    if (makePrimary) {
      await tx.executionParticipant.updateMany({
        where: { executionId: execution.id, isPrimary: true, leftAt: null },
        data: { isPrimary: false },
      });
    }
    await tx.executionParticipant.create({
      data: { executionId: execution.id, membershipId, isPrimary: makePrimary },
    });
  }

  async release(
    t: TenantContext,
    actor: string,
    orderId: string,
    assignmentId: string,
    reason: string,
  ) {
    return this.prisma.transactional(async (tx) => {
      const order = await lockOrder(tx, t.companyId, orderId);
      const assignment = await tx.workOrderAssignment.findFirst({
        where: { id: assignmentId, workOrderId: orderId, companyId: t.companyId, releasedAt: null },
      });
      if (!assignment) throw new NotFoundException('Active assignment not found');
      const others = await tx.workOrderAssignment.findMany({
        where: { workOrderId: orderId, releasedAt: null, id: { not: assignmentId } },
        orderBy: { createdAt: 'asc' },
      });

      if (order.status === 'IN_PROGRESS') {
        if (others.length === 0)
          throw new ConflictException('Cannot release the only technician of a running execution');
        if (assignment.isPrimary)
          throw new ConflictException('Designate another primary technician first');
      } else if (!['OPEN', 'SCHEDULED'].includes(order.status)) {
        throw new ConflictException(`Cannot release while the order is ${order.status}`);
      }

      await tx.workOrderAssignment.update({
        where: { id: assignmentId },
        data: {
          releasedAt: new Date(),
          releasedBy: actor,
          releaseReason: reason,
          isPrimary: false,
        },
      });
      await tx.executionParticipant.updateMany({
        where: {
          membershipId: assignment.membershipId,
          leftAt: null,
          execution: { workOrderId: orderId, status: 'IN_PROGRESS' },
        },
        data: { leftAt: new Date() },
      });

      if (assignment.isPrimary && others.length > 0) {
        await tx.workOrderAssignment.update({
          where: { id: others[0].id },
          data: { isPrimary: true },
        });
      }
      if (others.length === 0 && order.status === 'SCHEDULED') {
        await transition(tx, order, ['SCHEDULED'], 'OPEN');
      }
      await this.log(
        t,
        actor,
        orderId,
        'order.unassigned',
        { assignmentId, reason, membershipId: assignment.membershipId },
        tx,
      );
      return { released: true };
    });
  }

  /** Professionals only ever see their own calendar. */
  async agenda(t: TenantContext, q: AgendaQuery) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (!(to > from)) throw new BadRequestException('to must be after from');
    if (to.getTime() - from.getTime() > 62 * DAY_MS)
      throw new BadRequestException('Range cannot exceed 62 days');
    const membershipId = t.role === Role.PROFESSIONAL ? t.membershipId : q.membershipId;

    const rows = await this.prisma.workOrderAssignment.findMany({
      where: {
        companyId: t.companyId,
        releasedAt: null,
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(membershipId ? { membershipId } : {}),
      },
      include: {
        workOrder: {
          select: { id: true, number: true, title: true, status: true, clientSnapshot: true },
        },
        membership: { select: { id: true, user: { select: { name: true } } } },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    return rows.map((a) => ({
      assignmentId: a.id,
      membershipId: a.membershipId,
      technician: a.membership.user.name,
      isPrimary: a.isPrimary,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      order: a.workOrder,
    }));
  }
}
