import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { HealthModule } from '../src/health/health.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };
  const httpServer = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] })
      .useMocker((token) => (token === PrismaService ? prisma : undefined))
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health -> 200', async () => {
    await request(httpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
  });

  it('GET /api/v1/health/ready -> 503 when database is down', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('down'));
    await request(httpServer()).get('/api/v1/health/ready').expect(503);
  });

  it('sends security headers and does not advertise the framework', async () => {
    const res = await request(httpServer()).get('/api/v1/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('is not exposed outside the versioned prefix', async () => {
    await request(httpServer()).get('/health').expect(404);
  });
});
