import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  const build = (query: jest.Mock) =>
    new HealthController({ $queryRaw: query } as unknown as PrismaService);

  it('live returns ok without touching the database', () => {
    const query = jest.fn();
    expect(build(query).live()).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('ready returns up when the database answers', async () => {
    await expect(build(jest.fn().mockResolvedValue([{ '?column?': 1 }])).ready()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('ready throws 503 when the database fails', async () => {
    await expect(
      build(jest.fn().mockRejectedValue(new Error('down'))).ready(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
