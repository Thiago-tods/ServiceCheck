import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { OperationStatus, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength, validate } from 'class-validator';
import { TenantContext } from '../common/request-context';
import { ExecutionsService } from '../orders/executions.service';
import { CaptureSignatureDto, UpdateItemDto } from '../orders/orders.dto';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOperationDto, SyncOperationType, SyncPullQuery } from './sync.dto';

class OrderRef {
  @IsUUID() orderId!: string;
}
class ExecRef {
  @IsUUID() executionId!: string;
}
class ItemUpdatePayload extends UpdateItemDto {
  @IsUUID() executionId!: string;
  @IsUUID() itemId!: string;
}
class NotePayload extends ExecRef {
  @IsString() @MinLength(1) @MaxLength(2000) text!: string;
}
class SignaturePayload extends CaptureSignatureDto {
  @IsUUID() executionId!: string;
}

export type OperationOutcome = 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED' | 'ERROR';

export interface OperationResult {
  operationId: string;
  outcome: OperationOutcome;
  /** Present on DUPLICATE: the status the operation originally got. */
  originalOutcome?: OperationStatus;
  /** True only for ERROR (unexpected server failure): the device should retry later. */
  retryable?: boolean;
  response?: unknown;
  error?: unknown;
}

async function parse<T extends object>(cls: new () => T, payload: unknown): Promise<T> {
  const instance = plainToInstance(cls, payload);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
  }
  return instance;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executions: ExecutionsService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Applies the device's outbox in order. Each operation commits atomically together
   * with its idempotency record, so replaying a batch (lost response, app restart)
   * never applies anything twice and always yields the original outcome.
   */
  async push(t: TenantContext, actor: string, operations: SyncOperationDto[]) {
    const results: OperationResult[] = [];
    for (const op of operations) results.push(await this.processOne(t, actor, op));
    return { results, serverTime: new Date() };
  }

  private async processOne(
    t: TenantContext,
    actor: string,
    op: SyncOperationDto,
  ): Promise<OperationResult> {
    try {
      return await this.prisma.transactional(async (tx) => {
        const inserted = await tx.$executeRaw`
          INSERT INTO "ProcessedOperation" ("id","companyId","membershipId","type","status","payload")
          VALUES (${op.operationId}::uuid, ${t.companyId}::uuid, ${t.membershipId}::uuid, ${op.type},
                  'APPLIED'::"OperationStatus", ${JSON.stringify(op.payload)}::jsonb)
          ON CONFLICT ("id") DO NOTHING`;
        if (inserted === 0) return this.duplicate(tx, t, op.operationId);

        const response = await this.apply(t, actor, op);
        await tx.processedOperation.update({
          where: { id: op.operationId },
          data: { response: response ?? {} },
        });
        return { operationId: op.operationId, outcome: 'APPLIED', response };
      });
    } catch (e) {
      if (e instanceof HttpException) return this.recordFailure(t, op, e);
      this.logger.error(
        `Sync operation ${op.operationId} failed unexpectedly`,
        e instanceof Error ? e.stack : e,
      );
      return { operationId: op.operationId, outcome: 'ERROR', retryable: true };
    }
  }

  private async duplicate(
    tx: Prisma.TransactionClient,
    t: TenantContext,
    operationId: string,
  ): Promise<OperationResult> {
    const prev = await tx.processedOperation.findUniqueOrThrow({ where: { id: operationId } });
    if (prev.companyId !== t.companyId || prev.membershipId !== t.membershipId) {
      // Same id from someone else: reveal nothing about the original.
      return { operationId, outcome: 'REJECTED', error: { message: 'operationId already used' } };
    }
    return {
      operationId,
      outcome: 'DUPLICATE',
      originalOutcome: prev.status,
      response: prev.response ?? undefined,
    };
  }

  /** Business rejections are final for that operationId; the payload is kept for the user to resolve. */
  private async recordFailure(
    t: TenantContext,
    op: SyncOperationDto,
    e: HttpException,
  ): Promise<OperationResult> {
    const status: OperationStatus = e.getStatus() === 409 ? 'CONFLICT' : 'REJECTED';
    const error = e.getResponse();
    await this.prisma.processedOperation.upsert({
      where: { id: op.operationId },
      create: {
        id: op.operationId,
        companyId: t.companyId,
        membershipId: t.membershipId,
        type: op.type,
        status,
        payload: op.payload as Prisma.InputJsonValue,
        response: { error },
      },
      update: {},
    });
    const stored = await this.prisma.processedOperation.findUniqueOrThrow({
      where: { id: op.operationId },
    });
    if (stored.companyId !== t.companyId || stored.membershipId !== t.membershipId) {
      return {
        operationId: op.operationId,
        outcome: 'REJECTED',
        error: { message: 'operationId already used' },
      };
    }
    if (stored.status === 'APPLIED') {
      // A concurrent request with the same id already succeeded.
      return {
        operationId: op.operationId,
        outcome: 'DUPLICATE',
        originalOutcome: 'APPLIED',
        response: stored.response ?? undefined,
      };
    }
    return { operationId: op.operationId, outcome: status, error };
  }

  private async apply(t: TenantContext, actor: string, op: SyncOperationDto): Promise<unknown> {
    switch (op.type) {
      case SyncOperationType.EXECUTION_START: {
        const p = await parse(OrderRef, op.payload);
        const execution = await this.executions.start(t, actor, p.orderId);
        return { executionId: execution.id, sequence: execution.sequence };
      }
      case SyncOperationType.ITEM_UPDATE: {
        const p = await parse(ItemUpdatePayload, op.payload);
        const item = await this.executions.updateItem(t, actor, p.executionId, p.itemId, {
          done: p.done,
          value: p.value,
        });
        return { itemId: item.id, done: item.done };
      }
      case SyncOperationType.NOTE_ADD: {
        const p = await parse(NotePayload, op.payload);
        // The note id is the operationId: a replay can never create a second note.
        const note = await this.executions.addNote(t, actor, p.executionId, p.text, op.operationId);
        return { noteId: note.id };
      }
      case SyncOperationType.SIGNATURE_SET: {
        const { executionId, ...dto } = await parse(SignaturePayload, op.payload);
        return this.executions.captureSignature(t, actor, executionId, dto);
      }
      case SyncOperationType.EXECUTION_FINISH: {
        const p = await parse(ExecRef, op.payload);
        const order = await this.executions.finish(t, actor, p.executionId);
        return { orderId: order.id, status: order.status, version: order.version };
      }
    }
  }

  async pull(t: TenantContext, q: SyncPullQuery) {
    const result = await this.orders.changedSince(
      t,
      q.since ? new Date(q.since) : undefined,
      q.limit,
    );
    return { ...result, serverTime: new Date() };
  }

  /** Operations that did not apply, so the app can show what needs the user's attention. */
  conflicts(t: TenantContext) {
    return this.prisma.processedOperation.findMany({
      where: {
        companyId: t.companyId,
        membershipId: t.membershipId,
        status: { in: ['CONFLICT', 'REJECTED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
