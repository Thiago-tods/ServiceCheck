import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  http: () => Server;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), http: () => app.getHttpServer() as Server };
}

/** TRUNCATE is allowed on AuditLog; only row UPDATE/DELETE are blocked by trigger. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "RefreshToken","AuditLog","Membership","Company","User" RESTART IDENTITY CASCADE',
  );
}

export interface Session {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

export async function signUp(t: TestApp, name = 'User'): Promise<Session> {
  const email = `user${++counter}-${Date.now()}@example.com`;
  const password = 'Sup3rSecret!';
  await request(t.http()).post('/api/v1/auth/register').send({ email, password, name }).expect(201);
  const res = await request(t.http())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const body = res.body as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
  return {
    userId: body.user.id,
    email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

export const bearer = (s: Session): [string, string] => [
  'Authorization',
  `Bearer ${s.accessToken}`,
];

export async function createCompany(t: TestApp, s: Session, name = 'Acme'): Promise<string> {
  const res = await request(t.http())
    .post('/api/v1/companies')
    .set(...bearer(s))
    .send({ name })
    .expect(201);
  return (res.body as { id: string }).id;
}
