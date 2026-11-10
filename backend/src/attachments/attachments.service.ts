import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { TenantContext } from '../common/request-context';
import { ExecutionsService } from '../orders/executions.service';
import { OrderEventsService } from '../orders/order-events.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE } from '../storage/storage';
import type { StorageDriver } from '../storage/storage';
import { ALLOWED_TYPES, matchesDeclaredType, sanitizeFilename } from './file-type';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executions: ExecutionsService,
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  /** `id` lets the device retry safely: the same id never produces a second file. */
  async upload(
    t: TenantContext,
    actor: string,
    executionId: string,
    file: UploadedFile | undefined,
    opts: { id?: string; checklistItemId?: string },
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (file.size > MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException('File exceeds 10 MB');
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
    }
    if (!matchesDeclaredType(file.mimetype, file.buffer)) {
      throw new BadRequestException('File content does not match its declared type');
    }
    const id = opts.id ?? randomUUID();

    return this.prisma.transactional(async (tx) => {
      const { execution } = await this.executions.participantContext(tx, t, executionId);

      const existing = await tx.attachment.findUnique({ where: { id } });
      if (existing) {
        if (existing.executionId === executionId && existing.uploadedBy === t.membershipId) {
          return this.view(existing);
        }
        throw new ConflictException('Attachment id already in use');
      }

      let itemKind: string | undefined;
      if (opts.checklistItemId) {
        const item = await tx.executionChecklistItem.findFirst({
          where: { id: opts.checklistItemId, executionId },
        });
        if (!item) throw new NotFoundException('Checklist item not found');
        itemKind = item.kind;
      }

      const storageKey = `attachments/${t.companyId}/${executionId}/${id}`;
      await this.storage.put(storageKey, file.buffer, file.mimetype);
      const attachment = await tx.attachment.create({
        data: {
          id,
          companyId: t.companyId,
          executionId,
          checklistItemId: opts.checklistItemId,
          uploadedBy: t.membershipId,
          filename: sanitizeFilename(file.originalname),
          contentType: file.mimetype,
          size: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          storageKey,
        },
      });
      if (opts.checklistItemId && itemKind === 'PHOTO' && file.mimetype.startsWith('image/')) {
        await tx.executionChecklistItem.update({
          where: { id: opts.checklistItemId },
          data: { done: true, completedAt: new Date(), completedBy: t.membershipId },
        });
      }
      await this.events.record(
        t,
        actor,
        execution.workOrderId,
        'execution.attachment_added',
        { attachmentId: id, contentType: file.mimetype, size: file.size },
        tx,
      );
      return this.view(attachment);
    });
  }

  private view(a: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    checklistItemId: string | null;
    createdAt: Date;
  }) {
    return {
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      checklistItemId: a.checklistItemId,
      createdAt: a.createdAt,
    };
  }

  async download(t: TenantContext, id: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id, companyId: t.companyId },
      include: { execution: { select: { workOrderId: true } } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.orders.assertVisible(t, attachment.execution.workOrderId);
    return {
      body: await this.storage.get(attachment.storageKey),
      contentType: attachment.contentType,
      filename: attachment.filename,
    };
  }
}
