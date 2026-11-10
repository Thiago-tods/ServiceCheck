import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import request from 'supertest';
import { JobsService } from '../src/jobs/jobs.service';
import { api, bearer, createCompany, createTestApp, resetDb, signUp, TestApp } from './helpers';
import { scheduledOrder, setupWorld, startOrder, World } from './world';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Attachments, reports and jobs (e2e, real PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t.prisma));
  afterAll(() => t.app.close());

  const upload = (
    w: World,
    as: { accessToken: string },
    executionId: string,
    file: Buffer,
    filename: string,
    type: string,
    fields: Record<string, string> = {},
  ) => {
    const r = request(t.http())
      .post(`/api/v1/executions/${executionId}/attachments`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('X-Company-Id', w.companyId);
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r.attach('file', file, { filename, contentType: type });
  };

  it('stores a photo, lists it on the order and serves it back safely', async () => {
    const w = await setupWorld(t);
    const orderId = await scheduledOrder(t, w);
    const exec = await startOrder(t, w, orderId);

    const res = await upload(w, w.tech, exec.id, PNG, '../../foto "final".png', 'image/png').expect(
      201,
    );
    const body = res.body as { id: string; filename: string; size: number };
    expect(body.filename).not.toMatch(/[\\/"]/);
    expect(body.size).toBe(PNG.length);

    const order = await api(t, w.recep, w.companyId).get(`/work-orders/${orderId}`).expect(200);
    expect(
      (order.body as { executions: { attachments: unknown[] }[] }).executions[0].attachments,
    ).toHaveLength(1);

    const dl = await api(t, w.recep, w.companyId).get(`/attachments/${body.id}`).expect(200);
    expect(dl.headers['content-type']).toContain('image/png');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(Buffer.from(dl.body as Buffer).equals(PNG)).toBe(true);

    const row = await t.prisma.attachment.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.storageKey).toBe(`attachments/${w.companyId}/${exec.id}/${body.id}`);
    expect(row.sha256).toHaveLength(64);
    const onDisk = await fs.readFile(
      path.resolve(process.env.STORAGE_LOCAL_DIR ?? './storage-test', row.storageKey),
    );
    expect(onDisk.equals(PNG)).toBe(true);
  });

  it('enforces who can upload and who can read', async () => {
    const w = await setupWorld(t);
    const orderId = await scheduledOrder(t, w);
    const exec = await startOrder(t, w, orderId);
    await upload(w, w.tech2, exec.id, PNG, 'a.png', 'image/png').expect(403); // not a participant
    await upload(w, w.recep, exec.id, PNG, 'a.png', 'image/png').expect(403);
    const ok = await upload(w, w.tech, exec.id, PNG, 'a.png', 'image/png').expect(201);
    const id = (ok.body as { id: string }).id;

    await api(t, w.tech2, w.companyId).get(`/attachments/${id}`).expect(404); // not visible to them
    await api(t, w.tech, w.companyId).get(`/attachments/${id}`).expect(200);

    const ownerB = await signUp(t, 'OwnerB');
    const companyB = await createCompany(t, ownerB, 'Company B');
    await api(t, ownerB, companyB).get(`/attachments/${id}`).expect(404);
  });

  it('rejects dangerous or mismatched files', async () => {
    const w = await setupWorld(t);
    const exec = await startOrder(t, w, await scheduledOrder(t, w));
    const html = Buffer.from('<script>alert(1)</script>');
    await upload(w, w.tech, exec.id, html, 'x.html', 'text/html').expect(400);
    await upload(w, w.tech, exec.id, html, 'x.png', 'image/png').expect(400);
    await upload(
      w,
      w.tech,
      exec.id,
      Buffer.alloc(11 * 1024 * 1024, 0xff),
      'big.jpg',
      'image/jpeg',
    ).expect(413);
    await request(t.http())
      .post(`/api/v1/executions/${exec.id}/attachments`)
      .set(...bearer(w.tech))
      .set('X-Company-Id', w.companyId)
      .expect(400);
    expect(await t.prisma.attachment.count()).toBe(0);
  });

  it('is idempotent when the device retries with the same id', async () => {
    const w = await setupWorld(t);
    const exec = await startOrder(t, w, await scheduledOrder(t, w));
    const id = randomUUID();
    const a = await upload(w, w.tech, exec.id, PNG, 'a.png', 'image/png', { id }).expect(201);
    const b = await upload(w, w.tech, exec.id, PNG, 'a.png', 'image/png', { id }).expect(201);
    expect((a.body as { id: string }).id).toBe(id);
    expect(b.body).toEqual(a.body);
    expect(await t.prisma.attachment.count()).toBe(1);

    const otherOrder = await scheduledOrder(t, w, 'Outra ordem', w.m.tech2, 12);
    const otherExec = await startOrder(t, w, otherOrder, w.tech2);
    await upload(w, w.tech2, otherExec.id, PNG, 'a.png', 'image/png', { id }).expect(409);
  });

  it('completes a PHOTO checklist item when an image is attached to it', async () => {
    const w = await setupWorld(t, [{ label: 'Foto do serviço', kind: 'PHOTO', required: true }]);
    const exec = await startOrder(t, w, await scheduledOrder(t, w));
    const item = exec.items[0];
    await api(t, w.tech, w.companyId)
      .put(`/executions/${exec.id}/signature`, { status: 'ABSENT', reason: 'Sem ninguém' })
      .expect(200);
    await api(t, w.tech, w.companyId).post(`/executions/${exec.id}/finish`).expect(409); // photo missing
    await upload(w, w.tech, exec.id, PNG, 'p.png', 'image/png', {
      checklistItemId: item.id,
    }).expect(201);
    await api(t, w.tech, w.companyId).post(`/executions/${exec.id}/finish`).expect(201);
  });

  async function finishedOrder(w: World) {
    const orderId = await scheduledOrder(t, w, 'Trocar tomada da sala', w.m.tech, 14);
    const exec = await startOrder(t, w, orderId);
    await api(t, w.tech, w.companyId)
      .patch(`/executions/${exec.id}/items/${exec.items.find((i) => i.required)!.id}`, {
        done: true,
      })
      .expect(200);
    await api(t, w.tech, w.companyId)
      .post(`/executions/${exec.id}/notes`, { text: 'Serviço concluído' })
      .expect(201);
    await upload(w, w.tech, exec.id, PNG, 'foto.png', 'image/png').expect(201);
    await api(t, w.tech, w.companyId)
      .put(`/executions/${exec.id}/signature`, {
        status: 'SIGNED',
        signerName: 'Maria',
        imagePngBase64: PNG.toString('base64'),
      })
      .expect(200);
    await api(t, w.tech, w.companyId).post(`/executions/${exec.id}/finish`).expect(201);
    return orderId;
  }

  it('builds the PDF report asynchronously through the job queue', async () => {
    const w = await setupWorld(t);
    const orderId = await scheduledOrder(t, w, 'Ainda não executada');
    await api(t, w.recep, w.companyId).post(`/work-orders/${orderId}/reports`).expect(409);

    const doneId = await finishedOrder(w);
    await api(t, w.tech, w.companyId).post(`/work-orders/${doneId}/reports`).expect(403);
    const req = await api(t, w.recep, w.companyId)
      .post(`/work-orders/${doneId}/reports`)
      .expect(202);
    const reportId = (req.body as { id: string }).id;
    expect(req.body).toMatchObject({ status: 'PENDING' });
    await api(t, w.recep, w.companyId).get(`/reports/${reportId}/download`).expect(409); // not ready

    const jobs = t.app.get(JobsService);
    expect(await jobs.runOnce()).toBe(true);
    expect(await jobs.runOnce()).toBe(false);

    const status = await api(t, w.recep, w.companyId).get(`/reports/${reportId}`).expect(200);
    expect(status.body).toMatchObject({ status: 'DONE' });
    const pdf = await api(t, w.tech, w.companyId).get(`/reports/${reportId}/download`).expect(200);
    const bytes = Buffer.from(pdf.body as Buffer);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // pdfkit writes ASCII Info strings as plain PDF literals, even with compression on.
    expect(bytes.toString('latin1')).toContain('(OS #2 - Trocar tomada da sala)');
    expect(bytes.length).toBeGreaterThan(2000);

    await api(t, w.tech2, w.companyId).get(`/reports/${reportId}`).expect(404);
    const ownerB = await signUp(t, 'OwnerB');
    const companyB = await createCompany(t, ownerB, 'Company B');
    await api(t, ownerB, companyB).get(`/reports/${reportId}/download`).expect(404);
  });

  it('retries failed jobs with backoff and then marks them FAILED', async () => {
    const jobs = t.app.get(JobsService);
    const job = await t.prisma.job.create({
      data: { type: 'UNKNOWN_TYPE', payload: {}, maxAttempts: 2 },
    });
    await jobs.runOnce();
    const first = await t.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(first).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(first.runAt.getTime()).toBeGreaterThan(Date.now()); // backoff
    expect(first.lastError).toMatch(/No handler/);

    await t.prisma.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
    await jobs.runOnce();
    expect(await t.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'FAILED',
      attempts: 2,
    });
  });

  it('runs each job exactly once when workers compete', async () => {
    const jobs = t.app.get(JobsService);
    let runs = 0;
    jobs.register('COUNTER', {
      run: async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 20));
      },
    });
    await t.prisma.job.createMany({
      data: Array.from({ length: 6 }, () => ({ type: 'COUNTER', payload: {} })),
    });
    await Promise.all(Array.from({ length: 10 }, () => jobs.runOnce()));
    expect(runs).toBe(6);
    expect(await t.prisma.job.count({ where: { status: 'DONE' } })).toBe(6);
  });

  it('recovers jobs left RUNNING by a crashed worker', async () => {
    const jobs = t.app.get(JobsService);
    let runs = 0;
    jobs.register('RECOVER', {
      run: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    await t.prisma.job.create({
      data: {
        type: 'RECOVER',
        payload: {},
        status: 'RUNNING',
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    await jobs.runOnce();
    expect(runs).toBe(1);
  });
});
