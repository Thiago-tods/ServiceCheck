import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, WorkOrderStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { lockOrder, ServiceSnapshot, transition } from './order-state';
import { CreateOrderDto, OrderListQuery, SignatureReviewDto } from './orders.dto';

const ADMINS: Role[] = [Role.OWNER, Role.ADMIN];

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private log(
    t: TenantContext,
    actor: string,
    orderId: string,
    action: string,
    metadata?: object,
    tx?: Prisma.TransactionClient,
  ) {
    return this.audit.record(
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
  }

  async create(t: TenantContext, actor: string, dto: CreateOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: dto.clientId, companyId: t.companyId, active: true },
      });
      if (!client) throw new NotFoundException('Client not found');
      const address = await tx.clientAddress.findFirst({
        where: { id: dto.addressId, clientId: client.id, companyId: t.companyId, active: true },
      });
      if (!address) throw new NotFoundException('Address not found for this client');
      const contact = dto.contactId
        ? await tx.clientContact.findFirst({
            where: { id: dto.contactId, clientId: client.id, companyId: t.companyId, active: true },
          })
        : null;
      if (dto.contactId && !contact)
        throw new NotFoundException('Contact not found for this client');
      const service = await tx.service.findFirst({
        where: { id: dto.serviceId, companyId: t.companyId, active: true },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            include: { items: { orderBy: { position: 'asc' } } },
          },
        },
      });
      if (!service) throw new NotFoundException('Service not found');
      const checklist = service.versions[0] ?? null;

      const serviceSnapshot: ServiceSnapshot = {
        serviceId: service.id,
        name: service.name,
        checklistVersion: checklist?.version ?? null,
        items: (checklist?.items ?? []).map((i) => ({
          position: i.position,
          label: i.label,
          kind: i.kind,
          required: i.required,
        })),
      };
      const clientSnapshot = {
        clientId: client.id,
        name: client.name,
        document: client.document,
        contact: contact && { name: contact.name, phone: contact.phone, email: contact.email },
        address: {
          label: address.label,
          street: address.street,
          number: address.number,
          complement: address.complement,
          district: address.district,
          city: address.city,
          state: address.state,
          zip: address.zip,
          latitude: address.latitude,
          longitude: address.longitude,
        },
      };

      // Atomic per-company sequence: concurrent creations never share a number.
      const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
        INSERT INTO "WorkOrderCounter" ("companyId", "last") VALUES (${t.companyId}::uuid, 1)
        ON CONFLICT ("companyId") DO UPDATE SET "last" = "WorkOrderCounter"."last" + 1
        RETURNING "last"`;

      const order = await tx.workOrder.create({
        data: {
          companyId: t.companyId,
          number: last,
          title: dto.title,
          description: dto.description,
          clientId: client.id,
          serviceId: service.id,
          checklistVersionId: checklist?.id,
          clientSnapshot: clientSnapshot,
          serviceSnapshot: serviceSnapshot as unknown as Prisma.InputJsonValue,
          createdBy: actor,
        },
      });
      await this.log(t, actor, order.id, 'order.created', { number: order.number }, tx);
      return order;
    });
  }

  /** Professionals only see orders they are or were assigned to. */
  private visibility(t: TenantContext): Prisma.WorkOrderWhereInput {
    if (t.role !== Role.PROFESSIONAL) return {};
    return {
      OR: [
        { assignments: { some: { membershipId: t.membershipId } } },
        { executions: { some: { participants: { some: { membershipId: t.membershipId } } } } },
      ],
    };
  }

  async list(t: TenantContext, q: OrderListQuery) {
    const number = q.q && /^\d+$/.test(q.q) ? Number(q.q) : undefined;
    return this.prisma.workOrder.findMany({
      where: {
        companyId: t.companyId,
        ...this.visibility(t),
        ...(q.status ? { status: q.status } : {}),
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.q
          ? {
              OR: [
                { title: { contains: q.q, mode: 'insensitive' } },
                ...(number ? [{ number }] : []),
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      skip: q.offset,
    });
  }

  async get(t: TenantContext, id: string) {
    const order = await this.prisma.workOrder.findFirst({
      where: { id, companyId: t.companyId, ...this.visibility(t) },
      include: {
        assignments: { orderBy: { createdAt: 'asc' } },
        executions: {
          orderBy: { sequence: 'asc' },
          include: {
            participants: true,
            items: { orderBy: { position: 'asc' } },
            notes: { orderBy: { createdAt: 'asc' } },
            reviews: { orderBy: { createdAt: 'asc' } },
            signature: {
              select: {
                id: true,
                status: true,
                signerName: true,
                reason: true,
                capturedAt: true,
                capturedBy: true,
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Work order not found');
    return order;
  }

  history(t: TenantContext, id: string, limit: number) {
    return this.prisma.auditLog.findMany({
      where: { companyId: t.companyId, entityType: 'WorkOrder', entityId: id },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async cancel(t: TenantContext, actor: string, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, t.companyId, id);
      await transition(tx, order, ['OPEN', 'SCHEDULED'], 'CANCELLED', { cancelReason: reason });
      // Free the professionals' calendars; the assignment rows stay as history.
      await tx.workOrderAssignment.updateMany({
        where: { workOrderId: id, releasedAt: null },
        data: { releasedAt: new Date(), releasedBy: actor, releaseReason: 'order cancelled' },
      });
      await this.log(t, actor, id, 'order.cancelled', { reason }, tx);
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Approval must be independent from execution: no participant may approve. */
  async approve(t: TenantContext, actor: string, id: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, t.companyId, id);
      const latest = await tx.execution.findFirst({
        where: { workOrderId: id },
        orderBy: { sequence: 'desc' },
        include: { participants: true },
      });
      if (latest?.participants.some((p) => p.membershipId === t.membershipId)) {
        throw new ForbiddenException('A participant of the execution cannot approve it');
      }
      await transition(tx, order, ['PENDING_APPROVAL'], 'APPROVED');
      await this.log(t, actor, id, 'order.approved', { note, executionId: latest?.id }, tx);
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Reopening starts a brand-new execution; the previous one is preserved untouched. */
  async reopen(t: TenantContext, actor: string, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, t.companyId, id);
      const last = await tx.execution.aggregate({
        where: { workOrderId: id },
        _max: { sequence: true },
      });
      const snapshot = order.serviceSnapshot as unknown as ServiceSnapshot;
      const hasAssignments =
        (await tx.workOrderAssignment.count({ where: { workOrderId: id, releasedAt: null } })) > 0;
      await transition(
        tx,
        order,
        ['PENDING_APPROVAL', 'APPROVED'],
        hasAssignments ? 'SCHEDULED' : 'OPEN',
      );
      const execution = await tx.execution.create({
        data: {
          companyId: t.companyId,
          workOrderId: id,
          sequence: (last._max.sequence ?? 0) + 1,
          status: 'PENDING',
          reopenReason: reason,
          items: {
            create: snapshot.items.map((i) => ({
              position: i.position,
              label: i.label,
              kind: i.kind,
              required: i.required,
            })),
          },
        },
      });
      await this.log(
        t,
        actor,
        id,
        'order.reopened',
        { reason, newExecutionId: execution.id, from: order.status },
        tx,
      );
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Missing or refused signatures are decided by an Owner/Admin or a member with explicit permission. */
  async reviewSignature(t: TenantContext, actor: string, id: string, dto: SignatureReviewDto) {
    if (!ADMINS.includes(t.role) && !t.canReviewSignatures) {
      throw new ForbiddenException('No permission to review signatures');
    }
    return this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, t.companyId, id);
      const execution = await tx.execution.findFirst({
        where: { workOrderId: id, status: 'FINISHED' },
        orderBy: { sequence: 'desc' },
      });
      if (!execution) throw new NotFoundException('No finished execution to review');
      await transition(
        tx,
        order,
        ['SIGNATURE_REVIEW'],
        dto.decision === 'ACCEPT' ? 'PENDING_APPROVAL' : 'IN_PROGRESS',
      );
      if (dto.decision === 'RETURN') {
        await tx.execution.update({
          where: { id: execution.id },
          data: { status: 'IN_PROGRESS', finishedAt: null },
        });
      }
      await tx.signatureReview.create({
        data: {
          executionId: execution.id,
          membershipId: t.membershipId,
          decision: dto.decision,
          note: dto.note,
        },
      });
      await this.log(
        t,
        actor,
        id,
        'order.signature_reviewed',
        { decision: dto.decision, note: dto.note },
        tx,
      );
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });
  }

  statusCounts(companyId: string): Promise<{ status: WorkOrderStatus; count: number }[]> {
    return this.prisma.workOrder
      .groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } })
      .then((rows) => rows.map((r) => ({ status: r.status, count: r._count._all })));
  }
}
