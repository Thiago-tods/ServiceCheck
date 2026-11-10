import request from 'supertest';

// ConfigModule validates the environment when AppModule is first imported, so the flag
// must be set before ./helpers (and therefore AppModule) is loaded.
process.env.RATE_LIMIT_ENABLED = 'true';

import { createTestApp, resetDb, TestApp } from './helpers';

describe('Rate limiting (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    await resetDb(t.prisma);
    await t.app.close();
  });

  it('throttles credential endpoints but not the rest of the API', async () => {
    const attempt = () =>
      request(t.http())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await attempt()).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    await request(t.http()).get('/api/v1/health').expect(200);
  });
});
