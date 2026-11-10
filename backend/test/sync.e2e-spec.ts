import { randomUUID } from 'crypto';
import {
  addMember,
  api,
  createCompany,
  createTestApp,
  resetDb,
  Session,
  signUp,
  TestApp,
} from './helpers';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Op = { operationId: string; type: string; payload: Record<string, unknown> };
interface Result {
  operationId: string;
  outcome: string;
  originalOutcome?: string;
  retryable?: boolean;
  response?: Record<string, string>;
  error?: unknown;
}

describe('Sync, notifications and dashboard (e2e, real PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t.prisma));
  afterAll(() => t.app.close());

  async function setup() {
    const [owner, admin, recep, tech, tech2] = await Promise.all(
      ['Owner', 'Admin', 'Recep', 'Tech', 'Tech2'].map((n) => signUp(t, n)),
    );
    const companyId = await createCompany(t, owner, 'Company A');
    const m = {
      admin: await addMember(t, owner, companyId, admin.email, 'ADMIN'),
      recep: await addMember(t, owner, companyId, recep.email, 'RECEPTIONIST'),
      tech: await addMember(t, owner, companyId, tech.email, 'PROFESSIONAL'),
      tech2: await addMember(t, owner, companyId, tech2.email, 'PROFESSIONAL'),
    };
    const client = await api(t, recep, companyId).post('/clients', { name: 'Cliente' }).expect(201);
    const clientId = (client.body as { id: string }).id;
    const addr = await api(t, recep, companyId)
      .post(`/clients/${clientId}/addresses`, {
        label: 'A',
        street: 'Rua',
        city: 'SP',
        state: 'SP',
      })
      .expect(201);
    const svc = await api(t, owner, companyId).post('/services', { name: 'Serviço' }).expect(201);
    const serviceId = (svc.body as { id: string }).id;
    await api(t, owner, companyId)
      .post(`/services/${serviceId}/checklist-versions`, {
        items: [
          { label: 'Obrigatório', required: true },
          { label: 'Texto', kind: 'TEXT' },
        ],
      })
      .expect(201);
    const addressId = (addr.body as { id: string }).id;
    return { owner, admin, recep, tech, tech2, companyId, m, clientId, addressId, serviceId };
  }
  type W = Awaited<ReturnType<typeof setup>>;

  async function scheduledOrder(w: W, title = 'Ordem de teste', member = w.m.tech, hour = 9) {
    const o = await api(t, w.recep, w.companyId)
      .post('/work-orders', {
        clientId: w.clientId,
        addressId: w.addressId,
        serviceId: w.serviceId,
        title,
      })
      .expect(201);
    const id = (o.body as { id: string }).id;
    await api(t, w.recep, w.companyId)
      .post(`/work-orders/${id}/assignments`, {
        membershipId: member,
        startsAt: `2027-02-01T${String(hour).padStart(2, '0')}:00:00Z`,
        endsAt: `2027-02-01T${String(hour + 1).padStart(2, '0')}:00:00Z`,
      })
      .expect(201);
    return id;
  }

  const push = async (w: W, as: Session, operations: Op[]) =>
    (await api(t, as, w.companyId).post('/sync/push', { operations }).expect(200)).body as {
      results: Result[];
    };
  const op = (type: string, payload: Record<string, unknown>): Op => ({
    operationId: randomUUID(),
    type,
    payload,
  });

  async function startViaSync(w: W, orderId: string) {
    const start = op('EXECUTION_START', { orderId });
    const { results } = await push(w, w.tech, [start]);
    return { start, executionId: results[0].response!.executionId };
  }

  it('applies a full offline batch in order and finishes the work', async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    const { start, executionId } = await startViaSync(w, orderId);
    const items = await t.prisma.executionChecklistItem.findMany({
      where: { executionId },
      orderBy: { position: 'asc' },
    });

    const batch = [
      op('ITEM_UPDATE', { executionId, itemId: items[0].id, done: true }),
      op('ITEM_UPDATE', { executionId, itemId: items[1].id, value: 'tudo ok' }),
      op('NOTE_ADD', { executionId, text: 'Feito sem sinal' }),
      op('SIGNATURE_SET', {
        executionId,
        status: 'SIGNED',
        signerName: 'Maria',
        imagePngBase64: PNG,
      }),
      op('EXECUTION_FINISH', { executionId }),
    ];
    const { results } = await push(w, w.tech, batch);
    expect(results.map((r) => r.outcome)).toEqual([
      'APPLIED',
      'APPLIED',
      'APPLIED',
      'APPLIED',
      'APPLIED',
    ]);
    expect((await t.prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      'PENDING_APPROVAL',
    );
    expect(start.operationId).toBeDefined();

    // Replaying the whole batch (lost response) changes nothing.
    const replay = await push(w, w.tech, batch);
    expect(replay.results.map((r) => r.outcome)).toEqual(Array(5).fill('DUPLICATE'));
    expect(await t.prisma.executionNote.count()).toBe(1);
    expect(await t.prisma.execution.count({ where: { workOrderId: orderId } })).toBe(1);
  });

  it('supports a fully offline chain: device-chosen execution id and checklist positions', async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    const executionId = randomUUID(); // generated on the device, before any server contact
    const batch = [
      op('EXECUTION_START', { orderId, executionId }),
      op('ITEM_UPDATE', { executionId, itemPosition: 0, done: true }),
      op('ITEM_UPDATE', { executionId, itemPosition: 1, value: 'texto offline' }),
      op('NOTE_ADD', { executionId, text: 'nota offline' }),
      op('SIGNATURE_SET', { executionId, status: 'ABSENT', reason: 'Ninguém no local' }),
      op('EXECUTION_FINISH', { executionId }),
    ];
    const { results } = await push(w, w.tech, batch);
    expect(results.map((r) => r.outcome)).toEqual(Array(6).fill('APPLIED'));
    expect(results[0].response).toMatchObject({ executionId });
    expect((await t.prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      'SIGNATURE_REVIEW',
    );
    const items = await t.prisma.executionChecklistItem.findMany({
      where: { executionId },
      orderBy: { position: 'asc' },
    });
    expect(items.map((i) => i.done)).toEqual([true, true]);
    expect(items[1].value).toBe('texto offline');
  });

  it('requires an item id or position, and rejects a stale device-chosen execution id', async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    const executionId = randomUUID();
    await push(w, w.tech, [op('EXECUTION_START', { orderId, executionId })]);
    const bad = await push(w, w.tech, [op('ITEM_UPDATE', { executionId, done: true })]);
    expect(bad.results[0].outcome).toBe('REJECTED');
    const missing = await push(w, w.tech, [
      op('ITEM_UPDATE', { executionId, itemPosition: 99, done: true }),
    ]);
    expect(missing.results[0].outcome).toBe('REJECTED');

    // Reopen -> PENDING execution exists; an offline start with its own id must conflict.
    const items = await t.prisma.executionChecklistItem.findMany({ where: { executionId } });
    await push(w, w.tech, [
      op('ITEM_UPDATE', { executionId, itemId: items.find((i) => i.required)!.id, done: true }),
      op('SIGNATURE_SET', {
        executionId,
        status: 'SIGNED',
        signerName: 'Ana',
        imagePngBase64: PNG,
      }),
      op('EXECUTION_FINISH', { executionId }),
    ]);
    await api(t, w.admin, w.companyId).post(`/work-orders/${orderId}/approve`, {}).expect(201);
    await api(t, w.admin, w.companyId)
      .post(`/work-orders/${orderId}/reopen`, { reason: 'Refazer o acabamento' })
      .expect(201);
    const stale = await push(w, w.tech, [
      op('EXECUTION_START', { orderId, executionId: randomUUID() }),
    ]);
    expect(stale.results[0].outcome).toBe('CONFLICT');
    const pending = await t.prisma.execution.findFirstOrThrow({
      where: { workOrderId: orderId, status: 'PENDING' },
    });
    const ok = await push(w, w.tech, [op('EXECUTION_START', { orderId, executionId: pending.id })]);
    expect(ok.results[0].outcome).toBe('APPLIED');
  });

  it('replaying EXECUTION_START returns the original result and never starts twice', async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    const start = op('EXECUTION_START', { orderId });
    const first = await push(w, w.tech, [start]);
    const second = await push(w, w.tech, [start]);
    expect(first.results[0].outcome).toBe('APPLIED');
    expect(second.results[0]).toMatchObject({ outcome: 'DUPLICATE', originalOutcome: 'APPLIED' });
    expect(second.results[0].response).toEqual(first.results[0].response);
    expect(await t.prisma.execution.count({ where: { workOrderId: orderId } })).toBe(1);
  });

  it('applies a duplicated operation exactly once under concurrency', async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    const { executionId } = await startViaSync(w, orderId);
    const note = op('NOTE_ADD', { executionId, text: 'concorrente' });
    const [a, b, c] = await Promise.all([
      push(w, w.tech, [note]),
      push(w, w.tech, [note]),
      push(w, w.tech, [note]),
    ]);
    const outcomes = [a, b, c].map((r) => r.results[0].outcome).sort();
    expect(outcomes.filter((o) => o === 'APPLIED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'DUPLICATE')).toHaveLength(2);
    expect(await t.prisma.executionNote.count()).toBe(1);
  });

  it('preserves conflicting operations instead of dropping them', async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    // Office cancels while the technician is offline.
    await api(t, w.recep, w.companyId)
      .post(`/work-orders/${orderId}/cancel`, { reason: 'cliente cancelou' })
      .expect(201);

    const start = op('EXECUTION_START', { orderId });
    const first = await push(w, w.tech, [start]);
    expect(first.results[0].outcome).toBe('REJECTED'); // released assignment -> forbidden, not a state clash

    const conflicts = await api(t, w.tech, w.companyId).get('/sync/conflicts').expect(200);
    expect(conflicts.body).toEqual([
      expect.objectContaining({ id: start.operationId, status: 'REJECTED', payload: { orderId } }),
    ]);
    const replay = await push(w, w.tech, [start]);
    expect(replay.results[0]).toMatchObject({ outcome: 'DUPLICATE', originalOutcome: 'REJECTED' });
  });

  it('reports state conflicts (409) as CONFLICT and keeps the payload', async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    const { executionId } = await startViaSync(w, orderId);
    const items = await t.prisma.executionChecklistItem.findMany({ where: { executionId } });
    const required = items.find((i) => i.required)!;
    const sig = op('SIGNATURE_SET', { executionId, status: 'ABSENT', reason: 'Sem ninguém' });
    await push(w, w.tech, [
      op('ITEM_UPDATE', { executionId, itemId: required.id, done: true }),
      sig,
      op('EXECUTION_FINISH', { executionId }),
    ]);

    // A late, stale update arrives after the execution was finished.
    const stale = op('ITEM_UPDATE', { executionId, itemId: required.id, done: false });
    const { results } = await push(w, w.tech, [stale]);
    expect(results[0].outcome).toBe('CONFLICT');
    const stored = await t.prisma.processedOperation.findUniqueOrThrow({
      where: { id: stale.operationId },
    });
    expect(stored.status).toBe('CONFLICT');
    expect(stored.payload).toMatchObject({ done: false });
  });

  it('rejects invalid payloads and unknown fields without side effects', async () => {
    const w = await setup();
    const { results } = await push(w, w.tech, [
      op('EXECUTION_START', { orderId: 'not-a-uuid' }),
      op('NOTE_ADD', { executionId: randomUUID(), text: 'x', extra: 1 }),
    ]);
    expect(results.map((r) => r.outcome)).toEqual(['REJECTED', 'REJECTED']);
    await api(t, w.tech, w.companyId).post('/sync/push', { operations: [] }).expect(400);
    await api(t, w.tech, w.companyId)
      .post('/sync/push', {
        operations: [{ operationId: 'nope', type: 'EXECUTION_START', payload: {} }],
      })
      .expect(400);
  });

  it("does not let one user replay or read another user's operationId", async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    const start = op('EXECUTION_START', { orderId });
    await push(w, w.tech, [start]);
    const other = await push(w, w.tech2, [start]);
    expect(other.results[0].outcome).toBe('REJECTED');
    expect(JSON.stringify(other.results[0])).not.toContain(orderId);
  });

  it("pull returns only the caller's orders and picks up child changes after a cursor", async () => {
    const w = await setup();
    const mine = await scheduledOrder(w, 'Minha ordem', w.m.tech, 9);
    await scheduledOrder(w, 'Ordem alheia', w.m.tech2, 9);

    const first = (await api(t, w.tech, w.companyId).get('/sync/pull').expect(200)).body as {
      orders: { id: string }[];
      nextCursor: string;
      hasMore: boolean;
    };
    expect(first.orders.map((o) => o.id)).toEqual([mine]);
    expect(first.hasMore).toBe(false);

    // The 2 s overlap re-sends the boundary order; it is idempotent for the client and carries no new data.
    const again = (
      await api(t, w.tech, w.companyId)
        .get(`/sync/pull?since=${encodeURIComponent(first.nextCursor)}`)
        .expect(200)
    ).body as { orders: { executions: unknown[] }[] };
    expect(again.orders.length).toBeLessThanOrEqual(1);
    expect(again.orders.every((o) => o.executions.length === 0)).toBe(true);
    const { executionId } = await startViaSync(w, mine);
    await push(w, w.tech, [op('NOTE_ADD', { executionId, text: 'nova nota' })]);
    const changed = (
      await api(t, w.tech, w.companyId)
        .get(`/sync/pull?since=${encodeURIComponent(first.nextCursor)}`)
        .expect(200)
    ).body as {
      orders: { executions: { notes: unknown[] }[] }[];
    };
    expect(changed.orders).toHaveLength(1);
    expect(changed.orders[0].executions[0].notes).toHaveLength(1);

    const staff = (await api(t, w.recep, w.companyId).get('/sync/pull').expect(200)).body as {
      orders: unknown[];
    };
    expect(staff.orders).toHaveLength(2);
  });

  it('notifies the right people for assignment, approval and signature review', async () => {
    const w = await setup();
    const orderId = await scheduledOrder(w);
    const techNotes = (
      await api(t, w.tech, w.companyId).get('/notifications?unread=true').expect(200)
    ).body as { id: string; type: string }[];
    expect(techNotes.map((n) => n.type)).toEqual(['order.assigned']);
    expect(
      (await api(t, w.tech2, w.companyId).get('/notifications').expect(200)).body as unknown[],
    ).toHaveLength(0);

    await api(t, w.tech, w.companyId).post(`/notifications/${techNotes[0].id}/read`).expect(201);
    await api(t, w.tech2, w.companyId).post(`/notifications/${techNotes[0].id}/read`).expect(404); // not theirs
    expect(
      (await api(t, w.tech, w.companyId).get('/notifications?unread=true').expect(200))
        .body as unknown[],
    ).toHaveLength(0);

    // refused signature -> reviewers (owner/admin and members with explicit permission)
    await api(t, w.owner, w.companyId)
      .patch(`/members/${w.m.recep}`, { canReviewSignatures: true })
      .expect(200);
    const { executionId } = await startViaSync(w, orderId);
    const items = await t.prisma.executionChecklistItem.findMany({ where: { executionId } });
    await push(w, w.tech, [
      op('ITEM_UPDATE', { executionId, itemId: items.find((i) => i.required)!.id, done: true }),
      op('SIGNATURE_SET', { executionId, status: 'REFUSED', reason: 'Recusou assinar' }),
      op('EXECUTION_FINISH', { executionId }),
    ]);
    const reviewers = await t.prisma.notification.findMany({
      where: { type: 'signature.review_required' },
    });
    expect(reviewers.map((n) => n.membershipId).sort()).toEqual(
      [w.m.admin, w.m.recep]
        .concat(
          (
            await t.prisma.membership.findFirstOrThrow({
              where: { companyId: w.companyId, role: 'OWNER' },
            })
          ).id,
        )
        .sort(),
    );
    expect(reviewers.every((n) => n.membershipId !== w.m.tech)).toBe(true);

    await api(t, w.admin, w.companyId)
      .post(`/work-orders/${orderId}/signature-review`, {
        decision: 'RETURN',
        note: 'Voltar e coletar',
      })
      .expect(201);
    const returned = await t.prisma.notification.findMany({
      where: { type: 'signature.returned' },
    });
    expect(returned.map((n) => n.membershipId)).toEqual([w.m.tech]);
  });

  it('dashboard counts are role-aware and tenant-scoped', async () => {
    const w = await setup();
    await scheduledOrder(w, 'Primeira', w.m.tech, 9);
    await scheduledOrder(w, 'Segunda', w.m.tech2, 9);
    await api(t, w.recep, w.companyId)
      .post('/work-orders', {
        clientId: w.clientId,
        addressId: w.addressId,
        serviceId: w.serviceId,
        title: 'Sem técnico',
      })
      .expect(201);

    const staff = (await api(t, w.recep, w.companyId).get('/dashboard').expect(200)).body as {
      byStatus: Record<string, number>;
      unassigned: number;
      overdue: number;
    };
    expect(staff.byStatus).toMatchObject({ OPEN: 1, SCHEDULED: 2 });
    expect(staff.unassigned).toBe(1);
    expect(staff.overdue).toBe(0); // windows are in the future
    const pro = (await api(t, w.tech, w.companyId).get('/dashboard').expect(200)).body as {
      byStatus: Record<string, number>;
    };
    expect(pro.byStatus.SCHEDULED).toBe(1);

    const ownerB = await signUp(t, 'OwnerB');
    const companyB = await createCompany(t, ownerB, 'Company B');
    const other = (await api(t, ownerB, companyB).get('/dashboard').expect(200)).body as {
      byStatus: Record<string, number>;
    };
    expect(Object.values(other.byStatus).every((n) => n === 0)).toBe(true);
  });
});
