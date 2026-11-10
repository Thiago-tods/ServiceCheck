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

/** TRUNCATE is allowed on append-only tables; only row UPDATE/DELETE are blocked by triggers. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((r) => `"${r.tablename}"`).join(',');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
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

/** Adds an existing user to a company with the given role; returns the membership id. */
export async function addMember(
  t: TestApp,
  owner: Session,
  companyId: string,
  email: string,
  role: 'OWNER' | 'ADMIN' | 'RECEPTIONIST' | 'PROFESSIONAL',
): Promise<string> {
  const res = await request(t.http())
    .post('/api/v1/members')
    .set(...bearer(owner))
    .set('X-Company-Id', companyId)
    .send({ email, role })
    .expect(201);
  return (res.body as { id: string }).id;
}

/** Authenticated request builder scoped to a company. */
export function api(t: TestApp, s: Session, companyId: string) {
  const set = (r: request.Test) => r.set(...bearer(s)).set('X-Company-Id', companyId);
  return {
    get: (p: string) => set(request(t.http()).get(`/api/v1${p}`)),
    post: (p: string, body: object = {}) => set(request(t.http()).post(`/api/v1${p}`).send(body)),
    patch: (p: string, body: object = {}) => set(request(t.http()).patch(`/api/v1${p}`).send(body)),
    put: (p: string, body: object = {}) => set(request(t.http()).put(`/api/v1${p}`).send(body)),
  };
}
