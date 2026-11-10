import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Turns a unique-constraint violation (P2002) into a 409, rethrows anything else. */
export function conflictOr(e: unknown, message: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ConflictException(message);
  }
  throw e;
}
