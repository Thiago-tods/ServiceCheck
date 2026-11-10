import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface JobHandler {
  run(payload: Record<string, unknown>): Promise<void>;
  /** Called once when the last attempt failed. */
  onFailed?(payload: Record<string, unknown>, error: string): Promise<void>;
}

interface ClaimedJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

const STALE_LOCK_MS = 5 * 60 * 1000;

/**
 * PostgreSQL-backed job queue. Workers claim rows with FOR UPDATE SKIP LOCKED, so several
 * instances can run safely without Redis. Jobs are retried with exponential backoff.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  onModuleInit(): void {
    if (this.config.get<boolean>('JOBS_WORKER_ENABLED') === false) return;
    this.timer = setInterval(
      () => void this.runOnce().catch((e: unknown) => this.logger.error(e)),
      2000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  enqueue(tx: Prisma.TransactionClient | undefined, type: string, payload: Prisma.InputJsonObject) {
    return (tx ?? this.prisma).job.create({ data: { type, payload } });
  }

  /** Claims and runs at most one due job. Returns false when the queue is empty. */
  async runOnce(): Promise<boolean> {
    await this.prisma.job.updateMany({
      where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      data: { status: 'PENDING', lockedAt: null },
    });

    // Prisma stores timestamps as UTC wall time, so raw SQL must compare in UTC regardless of the server timezone.
    const [job] = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" SET status = 'RUNNING', "lockedAt" = (now() AT TIME ZONE 'UTC'), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM "Job" WHERE status = 'PENDING' AND "runAt" <= (now() AT TIME ZONE 'UTC')
        ORDER BY "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, attempts, "maxAttempts"`;
    if (!job) return false;

    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
      await handler.run(job.payload);
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'DONE', finishedAt: new Date(), lockedAt: null, lastError: null },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const last = job.attempts >= job.maxAttempts;
      this.logger.warn(`Job ${job.id} (${job.type}) attempt ${job.attempts} failed: ${message}`);
      await this.prisma.job.update({
        where: { id: job.id },
        data: last
          ? { status: 'FAILED', finishedAt: new Date(), lockedAt: null, lastError: message }
          : {
              status: 'PENDING',
              lockedAt: null,
              lastError: message,
              runAt: new Date(Date.now() + 2 ** job.attempts * 5000),
            },
      });
      if (last)
        await handler
          ?.onFailed?.(job.payload, message)
          .catch((err: unknown) => this.logger.error(err));
    }
    return true;
  }
}
