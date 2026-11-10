import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly ambient = new AsyncLocalStorage<Prisma.TransactionClient>();

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in a transaction. If one is already open in this async context
   * (e.g. the sync endpoint wrapping an operation together with its idempotency
   * record), `fn` joins it instead of opening a nested one, so the whole unit commits
   * or rolls back together.
   */
  transactional<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const current = this.ambient.getStore();
    if (current) return fn(current);
    return this.$transaction((tx) => this.ambient.run(tx, () => fn(tx)));
  }
}
