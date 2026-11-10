import request from 'supertest';
import { bearer, createTestApp, resetDb, signUp, TestApp } from './helpers';

describe('Auth (e2e, real PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t.prisma));
  afterAll(() => t.app.close());

  it('registers, rejects duplicate e-mail and weak input', async () => {
    const body = { email: 'A@Example.com', password: 'longenough1', name: 'A' };
    const res = await request(t.http()).post('/api/v1/auth/register').send(body).expect(201);
    expect(res.body).toMatchObject({ email: 'a@example.com' });
    expect(res.body).not.toHaveProperty('passwordHash');
    await request(t.http()).post('/api/v1/auth/register').send(body).expect(409);
    await request(t.http())
      .post('/api/v1/auth/register')
      .send({ ...body, email: 'b@example.com', password: 'short' })
      .expect(400);
    await request(t.http())
      .post('/api/v1/auth/register')
      .send({ ...body, email: 'c@example.com', isAdmin: true })
      .expect(400);
  });

  it('does not store plaintext passwords', async () => {
    const s = await signUp(t);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user.passwordHash).not.toContain('Sup3rSecret');
    expect(user.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects wrong password and unknown e-mail with the same error', async () => {
    const s = await signUp(t);
    const wrong = await request(t.http())
      .post('/api/v1/auth/login')
      .send({ email: s.email, password: 'wrong-password' })
      .expect(401);
    const unknown = await request(t.http())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('protects /auth/me and serves it with a valid token', async () => {
    await request(t.http()).get('/api/v1/auth/me').expect(401);
    await request(t.http()).get('/api/v1/auth/me').set('Authorization', 'Bearer junk').expect(401);
    const s = await signUp(t);
    const res = await request(t.http())
      .get('/api/v1/auth/me')
      .set(...bearer(s))
      .expect(200);
    expect(res.body).toMatchObject({ user: { id: s.userId }, memberships: [] });
  });

  it('rotates refresh tokens and stores only hashes', async () => {
    const s = await signUp(t);
    const res = await request(t.http())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(200);
    const next = (res.body as { refreshToken: string }).refreshToken;
    expect(next).not.toEqual(s.refreshToken);
    const stored = await t.prisma.refreshToken.findMany();
    expect(stored.map((r) => r.tokenHash)).not.toContain(s.refreshToken);
    expect(stored.filter((r) => !r.revokedAt)).toHaveLength(1);
  });

  it('detects refresh token reuse and revokes the whole family', async () => {
    const s = await signUp(t);
    const first = await request(t.http())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(200);
    const second = (first.body as { refreshToken: string }).refreshToken;

    // Replaying the old token is an attack signal.
    await request(t.http())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(401);
    // The legitimate newer token is now revoked too.
    await request(t.http()).post('/api/v1/auth/refresh').send({ refreshToken: second }).expect(401);
    expect(await t.prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('lets only one of two concurrent refreshes win', async () => {
    const s = await signUp(t);
    const send = () =>
      request(t.http()).post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    const results = await Promise.all([send(), send()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('logout revokes the token family and is idempotent', async () => {
    const s = await signUp(t);
    await request(t.http())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: s.refreshToken })
      .expect(204);
    await request(t.http())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: s.refreshToken })
      .expect(204);
    await request(t.http())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(401);
  });

  it('writes audit entries that the database refuses to modify or delete', async () => {
    await signUp(t);
    const entry = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'user.logged_in' } });
    await expect(
      t.prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(t.prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(t.prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);
  });
});
