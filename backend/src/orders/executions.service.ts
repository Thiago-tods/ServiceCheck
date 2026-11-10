import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderEventsService } from './order-events.service';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { lockOrder, ServiceSnapshot, transition, Tx } from './order-state';
import { CaptureSignatureDto, UpdateItemDto } from './orders.dto';

const MAX_SIGNATURE_BYTES = 256 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

@Injectable()
export class ExecutionsService {
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

  /** Starts (or resumes a PENDING, e.g. reopened) execution for the assigned technicians. */
  async start(t: TenantContext, actor: string, orderId: string, clientExecutionId?: string) {
    return this.prisma.transactional(async (tx) => {
      const order = await lockOrder(tx, t.companyId, orderId);
      const assignments = await tx.workOrderAssignment.findMany({
        where: { workOrderId: orderId, releasedAt: null },
      });
      if (!assignments.some((a) => a.membershipId === t.membershipId)) {
        throw new ForbiddenException('Only an assigned technician can start the execution');
      }
      await transition(tx, order, ['SCHEDULED'], 'IN_PROGRESS');

      let execution = await tx.execution.findFirst({
        where: { workOrderId: orderId, status: 'PENDING' },
      });
      if (execution && clientExecutionId && execution.id !== clientExecutionId) {
        // The device started offline with its own id before learning about the reopening.
        throw new ConflictException(
          'A reopened execution is pending for this order; synchronise and use its id',
        );
      }
      if (!execution) {
        const last = await tx.execution.aggregate({
          where: { workOrderId: orderId },
          _max: { sequence: true },
        });
        const snapshot = order.serviceSnapshot as unknown as ServiceSnapshot;
        execution = await tx.execution.create({
          data: {
            // Offline devices choose the id so later operations can reference it before sync.
            id: clientExecutionId,
            companyId: t.companyId,
            workOrderId: orderId,
            sequence: (last._max.sequence ?? 0) + 1,
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
      }
      await tx.execution.update({
        where: { id: execution.id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      const primary = assignments.find((a) => a.isPrimary) ?? assignments[0];
      await tx.executionParticipant.createMany({
        data: assignments.map((a) => ({
          executionId: execution.id,
          membershipId: a.membershipId,
          isPrimary: a.id === primary.id,
        })),
      });
      await this.log(
        t,
        actor,
        orderId,
        'execution.started',
        { executionId: execution.id, sequence: execution.sequence },
        tx,
      );
      return tx.execution.findUniqueOrThrow({
        where: { id: execution.id },
        include: { participants: true, items: { orderBy: { position: 'asc' } } },
      });
    });
  }

  /** Loads an IN_PROGRESS execution and proves the caller is an active participant. */
  async participantContext(tx: Tx, t: TenantContext, executionId: string) {
    const execution = await tx.execution.findFirst({
      where: { id: executionId, companyId: t.companyId },
      include: { participants: { where: { leftAt: null } } },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    const me = execution.participants.find((p) => p.membershipId === t.membershipId);
    if (!me) throw new ForbiddenException('Not a participant of this execution');
    if (execution.status !== 'IN_PROGRESS') {
      throw new ConflictException(`Execution is ${execution.status}`);
    }
    return { execution, me };
  }

  async updateItem(
    t: TenantContext,
    actor: string,
    executionId: string,
    /** Item id, or its position in the checklist (what an offline device knows before syncing). */
    itemRef: string | number,
    dto: UpdateItemDto,
  ) {
    return this.prisma.transactional(async (tx) => {
      const { execution } = await this.participantContext(tx, t, executionId);
      const item = await tx.executionChecklistItem.findFirst({
        where:
          typeof itemRef === 'number'
            ? { position: itemRef, executionId }
            : { id: itemRef, executionId },
      });
      const itemId = item?.id ?? '';
      if (!item) throw new NotFoundException('Checklist item not found');

      if (
        item.kind === 'NUMBER' &&
        dto.value !== undefined &&
        dto.value !== '' &&
        Number.isNaN(Number(dto.value))
      ) {
        throw new BadRequestException('value must be numeric');
      }
      const value = dto.value !== undefined ? dto.value || null : item.value;
      const done =
        dto.done ??
        (dto.value !== undefined && (item.kind === 'TEXT' || item.kind === 'NUMBER')
          ? !!value
          : item.done);
      const updated = await tx.executionChecklistItem.update({
        where: { id: itemId },
        data: {
          value,
          done,
          completedAt: done ? new Date() : null,
          completedBy: done ? t.membershipId : null,
        },
      });
      await this.log(
        t,
        actor,
        execution.workOrderId,
        'execution.item_updated',
        { itemId, done },
        tx,
      );
      return updated;
    });
  }

  async addNote(t: TenantContext, actor: string, executionId: string, text: string, id?: string) {
    return this.prisma.transactional(async (tx) => {
      const { execution } = await this.participantContext(tx, t, executionId);
      const note = await tx.executionNote.create({
        data: { id, executionId, membershipId: t.membershipId, text },
      });
      await this.log(
        t,
        actor,
        execution.workOrderId,
        'execution.note_added',
        { noteId: note.id },
        tx,
      );
      return note;
    });
  }

  async setPrimary(t: TenantContext, actor: string, executionId: string, membershipId: string) {
    return this.prisma.transactional(async (tx) => {
      const { execution } = await this.participantContext(tx, t, executionId);
      await lockOrder(tx, t.companyId, execution.workOrderId);
      const target = execution.participants.find((p) => p.membershipId === membershipId);
      if (!target) throw new BadRequestException('Target is not an active participant');
      // Clear first: the partial unique index allows a single active primary.
      await tx.executionParticipant.updateMany({
        where: { executionId, isPrimary: true, leftAt: null },
        data: { isPrimary: false },
      });
      await tx.executionParticipant.update({ where: { id: target.id }, data: { isPrimary: true } });
      await tx.workOrderAssignment.updateMany({
        where: { workOrderId: execution.workOrderId, releasedAt: null, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.workOrderAssignment.updateMany({
        where: { workOrderId: execution.workOrderId, releasedAt: null, membershipId },
        data: { isPrimary: true },
      });
      await this.log(
        t,
        actor,
        execution.workOrderId,
        'execution.primary_changed',
        { membershipId },
        tx,
      );
      return { executionId, primaryMembershipId: membershipId };
    });
  }

  async captureSignature(
    t: TenantContext,
    actor: string,
    executionId: string,
    dto: CaptureSignatureDto,
  ) {
    return this.prisma.transactional(async (tx) => {
      const { execution, me } = await this.participantContext(tx, t, executionId);
      if (!me.isPrimary)
        throw new ForbiddenException('Only the primary technician captures the signature');

      let image: Buffer | undefined;
      if (dto.status === 'SIGNED') {
        if (!dto.signerName || !dto.imagePngBase64) {
          throw new BadRequestException(
            'signerName and imagePngBase64 are required for a signed status',
          );
        }
        image = Buffer.from(dto.imagePngBase64, 'base64');
        if (image.length === 0 || image.length > MAX_SIGNATURE_BYTES) {
          throw new BadRequestException('Signature image must be between 1 byte and 256 KB');
        }
        if (!image.subarray(0, 8).equals(PNG_MAGIC)) {
          throw new BadRequestException('Signature image must be a PNG');
        }
      } else if (!dto.reason) {
        throw new BadRequestException('reason is required when the signature is refused or absent');
      }

      const previous = await tx.signature.findUnique({ where: { executionId } });
      const data = {
        status: dto.status,
        signerName: dto.status === 'SIGNED' ? dto.signerName : (dto.signerName ?? null),
        reason: dto.status === 'SIGNED' ? null : dto.reason,
        image: image ? new Uint8Array(image) : null,
        capturedBy: t.membershipId,
        capturedAt: new Date(),
      };
      const signature = previous
        ? await tx.signature.update({ where: { executionId }, data })
        : await tx.signature.create({ data: { ...data, executionId } });
      await this.log(
        t,
        actor,
        execution.workOrderId,
        'execution.signature_captured',
        { status: dto.status, replaced: previous?.status ?? null },
        tx,
      );
      return { id: signature.id, status: signature.status, capturedAt: signature.capturedAt };
    });
  }

  /** Finishing needs: primary technician, required items done, and a signature decision recorded. */
  async finish(t: TenantContext, actor: string, executionId: string) {
    return this.prisma.transactional(async (tx) => {
      const { execution, me } = await this.participantContext(tx, t, executionId);
      if (!me.isPrimary) throw new ForbiddenException('Only the primary technician can finish');
      const order = await lockOrder(tx, t.companyId, execution.workOrderId);

      const pending = await tx.executionChecklistItem.findMany({
        where: { executionId, required: true, done: false },
        select: { position: true, label: true },
      });
      if (pending.length > 0) {
        throw new ConflictException({
          message: 'Required checklist items are incomplete',
          pending,
        });
      }
      const signature = await tx.signature.findUnique({ where: { executionId } });
      if (!signature) {
        throw new ConflictException(
          'Record the signature step (signed, refused or absent) before finishing',
        );
      }

      await transition(
        tx,
        order,
        ['IN_PROGRESS'],
        signature.status === 'SIGNED' ? 'PENDING_APPROVAL' : 'SIGNATURE_REVIEW',
      );
      await tx.execution.update({
        where: { id: executionId },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
      await this.log(
        t,
        actor,
        execution.workOrderId,
        'execution.finished',
        { executionId, signature: signature.status },
        tx,
      );
      return tx.workOrder.findUniqueOrThrow({ where: { id: execution.workOrderId } });
    });
  }
}
