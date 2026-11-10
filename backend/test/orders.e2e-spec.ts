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
const at = (h: number, day = 10) =>
  `2027-01-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;

interface World {
  owner: Session;
  admin: Session;
  admin2: Session;
  recep: Session;
  techA: Session;
  techB: Session;
  companyId: string;
  m: { admin: string; admin2: string; recep: string; techA: string; techB: string };
  clientId: string;
  addressId: string;
  serviceId: string;
}

describe('Work orders (e2e, real PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t.prisma));
  afterAll(() => t.app.close());

  async function world(): Promise<World> {
    const [owner, admin, admin2, recep, techA, techB] = await Promise.all(
      ['Owner', 'Admin', 'Admin2', 'Recep', 'TechA', 'TechB'].map((n) => signUp(t, n)),
    );
    const companyId = await createCompany(t, owner, 'Company A');
    const m = {
      admin: await addMember(t, owner, companyId, admin.email, 'ADMIN'),
      admin2: await addMember(t, owner, companyId, admin2.email, 'ADMIN'),
      recep: await addMember(t, owner, companyId, recep.email, 'RECEPTIONIST'),
      techA: await addMember(t, owner, companyId, techA.email, 'PROFESSIONAL'),
      techB: await addMember(t, owner, companyId, techB.email, 'PROFESSIONAL'),
    };
    const client = await api(t, recep, companyId)
      .post('/clients', { name: 'Cliente Original', document: '123' })
      .expect(201);
    const clientId = (client.body as { id: string }).id;
    const addr = await api(t, recep, companyId)
      .post(`/clients/${clientId}/addresses`, {
        label: 'Casa',
        street: 'Rua 1',
        city: 'SP',
        state: 'SP',
      })
      .expect(201);
    const svc = await api(t, owner, companyId)
      .post('/services', { name: 'Instalação' })
      .expect(201);
    const serviceId = (svc.body as { id: string }).id;
    await api(t, owner, companyId)
      .post(`/services/${serviceId}/checklist-versions`, {
        items: [
          { label: 'Desligar disjuntor', required: true },
          { label: 'Observação', kind: 'TEXT' },
        ],
      })
      .expect(201);
    return {
      owner,
      admin,
      admin2,
      recep,
      techA,
      techB,
      companyId,
      m,
      clientId,
      addressId: (addr.body as { id: string }).id,
      serviceId,
    };
  }

  const createOrder = async (w: World, title = 'Trocar tomada') => {
    const res = await api(t, w.recep, w.companyId)
      .post('/work-orders', {
        clientId: w.clientId,
        addressId: w.addressId,
        serviceId: w.serviceId,
        title,
      })
      .expect(201);
    return res.body as { id: string; number: number; status: string };
  };
  const assign = (
    w: World,
    orderId: string,
    membershipId: string,
    startH: number,
    endH: number,
    extra: object = {},
    day = 10,
  ) =>
    api(t, w.recep, w.companyId).post(`/work-orders/${orderId}/assignments`, {
      membershipId,
      startsAt: at(startH, day),
      endsAt: at(endH, day),
      ...extra,
    });
  const getOrder = async (w: World, id: string, as: Session = w.owner) =>
    (await api(t, as, w.companyId).get(`/work-orders/${id}`).expect(200)).body as {
      status: string;
      version: number;
      clientSnapshot: { name: string };
      serviceSnapshot: { checklistVersion: number; items: unknown[] };
      assignments: {
        id: string;
        isPrimary: boolean;
        releasedAt: string | null;
        membershipId: string;
      }[];
      executions: {
        id: string;
        sequence: number;
        status: string;
        items: { id: string; label: string; done: boolean }[];
        participants: { membershipId: string; isPrimary: boolean }[];
      }[];
    };

  /** Drives an order to a started execution with techA (primary) and returns ids. */
  async function startedOrder(w: World) {
    const order = await createOrder(w);
    await assign(w, order.id, w.m.techA, 9, 11).expect(201);
    const started = await api(t, w.techA, w.companyId)
      .post(`/work-orders/${order.id}/start`)
      .expect(201);
    const exec = started.body as { id: string; items: { id: string; required: boolean }[] };
    return { order, execId: exec.id, items: exec.items };
  }

  const completeRequired = async (
    w: World,
    execId: string,
    items: { id: string; required: boolean }[],
  ) => {
    for (const item of items.filter((i) => i.required)) {
      await api(t, w.techA, w.companyId)
        .patch(`/executions/${execId}/items/${item.id}`, { done: true })
        .expect(200);
    }
  };
  const sign = (w: World, execId: string) =>
    api(t, w.techA, w.companyId).put(`/executions/${execId}/signature`, {
      status: 'SIGNED',
      signerName: 'Maria',
      imagePngBase64: PNG,
    });

  it('creates numbered orders with historical snapshots that later edits do not change', async () => {
    const w = await world();
    const o1 = await createOrder(w);
    const o2 = await createOrder(w, 'Segunda ordem');
    expect([o1.number, o2.number]).toEqual([1, 2]);

    await api(t, w.recep, w.companyId)
      .patch(`/clients/${w.clientId}`, { name: 'Cliente Renomeado' })
      .expect(200);
    await api(t, w.owner, w.companyId)
      .post(`/services/${w.serviceId}/checklist-versions`, { items: [{ label: 'Novo' }] })
      .expect(201);
    const o = await getOrder(w, o1.id);
    expect(o.clientSnapshot.name).toBe('Cliente Original');
    expect(o.serviceSnapshot.checklistVersion).toBe(1);
    expect(o.serviceSnapshot.items).toHaveLength(2);
  });

  it('never repeats an order number under concurrent creation', async () => {
    const w = await world();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createOrder(w, `Ordem ${i}`)),
    );
    expect(new Set(results.map((r) => r.number)).size).toBe(8);
  });

  it('professionals cannot create orders and only see their own', async () => {
    const w = await world();
    const mine = await createOrder(w, 'Minha');
    const other = await createOrder(w, 'Outra');
    await assign(w, mine.id, w.m.techA, 9, 11).expect(201);
    await api(t, w.techA, w.companyId)
      .post('/work-orders', {
        clientId: w.clientId,
        addressId: w.addressId,
        serviceId: w.serviceId,
        title: 'x1x',
      })
      .expect(403);
    const list = await api(t, w.techA, w.companyId).get('/work-orders').expect(200);
    expect((list.body as { id: string }[]).map((o) => o.id)).toEqual([mine.id]);
    await api(t, w.techA, w.companyId).get(`/work-orders/${other.id}`).expect(404);
    await api(t, w.techB, w.companyId).get(`/work-orders/${mine.id}`).expect(404);
  });

  it('blocks availability conflicts and allows adjacent windows', async () => {
    const w = await world();
    const o1 = await createOrder(w, 'Ordem um');
    const o2 = await createOrder(w, 'Ordem dois');
    await assign(w, o1.id, w.m.techA, 9, 11).expect(201);
    const clash = await assign(w, o2.id, w.m.techA, 10, 12).expect(409);
    expect(clash.body).toMatchObject({ conflict: { number: o1.number } });
    await assign(w, o2.id, w.m.techA, 11, 12).expect(201); // half-open ranges: touching is fine
    await assign(w, o2.id, w.m.techB, 9, 11).expect(201); // another technician is free
  });

  it('lets exactly one of two concurrent overlapping assignments win', async () => {
    const w = await world();
    const o1 = await createOrder(w, 'Ordem um');
    const o2 = await createOrder(w, 'Ordem dois');
    const results = await Promise.all([
      assign(w, o1.id, w.m.techA, 9, 11),
      assign(w, o2.id, w.m.techA, 10, 12),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await t.prisma.workOrderAssignment.count({
        where: { membershipId: w.m.techA, releasedAt: null },
      }),
    ).toBe(1);
  });

  it('keeps assignment history and frees the calendar on release and cancel', async () => {
    const w = await world();
    const o1 = await createOrder(w, 'Ordem um');
    const a = await assign(w, o1.id, w.m.techA, 9, 11).expect(201);
    const assignmentId = (a.body as { id: string }).id;
    expect((await getOrder(w, o1.id)).status).toBe('SCHEDULED');
    await api(t, w.recep, w.companyId)
      .post(`/work-orders/${o1.id}/assignments/${assignmentId}/release`, { reason: 'reagendado' })
      .expect(201);
    const after = await getOrder(w, o1.id);
    expect(after.status).toBe('OPEN');
    expect(after.assignments).toHaveLength(1);
    expect(after.assignments[0].releasedAt).not.toBeNull();

    const o2 = await createOrder(w, 'Ordem dois');
    await assign(w, o2.id, w.m.techA, 9, 11).expect(201); // calendar was freed
    await api(t, w.recep, w.companyId)
      .post(`/work-orders/${o2.id}/cancel`, { reason: 'cliente desistiu' })
      .expect(201);
    const o3 = await createOrder(w, 'Ordem três');
    await assign(w, o3.id, w.m.techA, 9, 11).expect(201);
    await assign(w, o2.id, w.m.techB, 9, 11).expect(409); // cancelled orders accept no assignment
  });

  it('keeps a single active primary assignment', async () => {
    const w = await world();
    const o = await createOrder(w);
    await assign(w, o.id, w.m.techA, 9, 11).expect(201);
    await assign(w, o.id, w.m.techB, 9, 11, { isPrimary: true }).expect(201);
    const after = await getOrder(w, o.id);
    const primaries = after.assignments.filter((a) => a.isPrimary && !a.releasedAt);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].membershipId).toBe(w.m.techB);
  });

  it('runs the full flow: execute, sign, finish, independent approval', async () => {
    const w = await world();
    const { order, execId, items } = await startedOrder(w);
    // add a second technician (helper) and an admin who will therefore be unable to approve
    await assign(w, order.id, w.m.admin, 9, 11).expect(201);

    await api(t, w.techB, w.companyId)
      .patch(`/executions/${execId}/items/${items[0].id}`, { done: true })
      .expect(403);
    await api(t, w.techA, w.companyId).post(`/executions/${execId}/finish`).expect(409); // required item pending
    await completeRequired(w, execId, items);
    await api(t, w.techA, w.companyId).post(`/executions/${execId}/finish`).expect(409); // no signature step
    await api(t, w.techA, w.companyId)
      .post(`/executions/${execId}/notes`, { text: 'Tudo certo' })
      .expect(201);

    await api(t, w.admin, w.companyId).post(`/executions/${execId}/finish`).expect(403); // not primary
    await sign(w, execId).expect(200);
    await api(t, w.techA, w.companyId).post(`/executions/${execId}/finish`).expect(201);
    expect((await getOrder(w, order.id)).status).toBe('PENDING_APPROVAL');

    // A participant cannot approve their own execution; staff without approval rights cannot either.
    await api(t, w.admin, w.companyId).post(`/work-orders/${order.id}/approve`, {}).expect(403);
    await api(t, w.recep, w.companyId).post(`/work-orders/${order.id}/approve`, {}).expect(403);
    await api(t, w.admin2, w.companyId)
      .post(`/work-orders/${order.id}/approve`, { note: 'ok' })
      .expect(201);
    expect((await getOrder(w, order.id)).status).toBe('APPROVED');

    const history = await api(t, w.owner, w.companyId)
      .get(`/work-orders/${order.id}/history`)
      .expect(200);
    const actions = (history.body as { action: string }[]).map((h) => h.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'order.created',
        'order.assigned',
        'execution.started',
        'execution.finished',
        'order.approved',
      ]),
    );
  });

  it('rejects invalid signatures', async () => {
    const w = await world();
    const { execId } = await startedOrder(w);
    const put = (body: object) =>
      api(t, w.techA, w.companyId).put(`/executions/${execId}/signature`, body);
    await put({ status: 'SIGNED' }).expect(400);
    await put({
      status: 'SIGNED',
      signerName: 'Ana',
      imagePngBase64: Buffer.from('not a png').toString('base64'),
    }).expect(400);
    await put({ status: 'REFUSED' }).expect(400);
    await put({ status: 'REFUSED', reason: 'Cliente recusou' }).expect(200);
  });

  it('sends refused signatures to review; only authorised users review', async () => {
    const w = await world();
    const { order, execId, items } = await startedOrder(w);
    await completeRequired(w, execId, items);
    await api(t, w.techA, w.companyId)
      .put(`/executions/${execId}/signature`, {
        status: 'REFUSED',
        reason: 'Cliente recusou assinar',
      })
      .expect(200);
    await api(t, w.techA, w.companyId).post(`/executions/${execId}/finish`).expect(201);
    expect((await getOrder(w, order.id)).status).toBe('SIGNATURE_REVIEW');

    const review = (as: Session, body: object) =>
      api(t, as, w.companyId).post(`/work-orders/${order.id}/signature-review`, body);
    await review(w.recep, { decision: 'ACCEPT', note: 'ok ok' }).expect(403);
    await review(w.techA, { decision: 'ACCEPT', note: 'ok ok' }).expect(403);

    // explicit permission lets a non-admin review
    await api(t, w.owner, w.companyId)
      .patch(`/members/${w.m.recep}`, { canReviewSignatures: true })
      .expect(200);
    await review(w.recep, { decision: 'RETURN', note: 'Coletar assinatura novamente' }).expect(201);
    expect((await getOrder(w, order.id)).status).toBe('IN_PROGRESS');

    await sign(w, execId).expect(200); // re-capture on the same execution
    await api(t, w.techA, w.companyId).post(`/executions/${execId}/finish`).expect(201);
    expect((await getOrder(w, order.id)).status).toBe('PENDING_APPROVAL');
  });

  it('accepting a missing signature moves the order to approval', async () => {
    const w = await world();
    const { order, execId, items } = await startedOrder(w);
    await completeRequired(w, execId, items);
    await api(t, w.techA, w.companyId)
      .put(`/executions/${execId}/signature`, { status: 'ABSENT', reason: 'Ninguém no local' })
      .expect(200);
    await api(t, w.techA, w.companyId).post(`/executions/${execId}/finish`).expect(201);
    await api(t, w.admin, w.companyId)
      .post(`/work-orders/${order.id}/signature-review`, {
        decision: 'ACCEPT',
        note: 'Foto comprova',
      })
      .expect(201);
    expect((await getOrder(w, order.id)).status).toBe('PENDING_APPROVAL');
    const reviews = await t.prisma.signatureReview.findMany();
    expect(reviews).toHaveLength(1);
  });

  it('reopens with a justification, creating a new execution and preserving the old one', async () => {
    const w = await world();
    const { order, execId, items } = await startedOrder(w);
    await completeRequired(w, execId, items);
    await sign(w, execId).expect(200);
    await api(t, w.techA, w.companyId).post(`/executions/${execId}/finish`).expect(201);
    await api(t, w.admin, w.companyId).post(`/work-orders/${order.id}/approve`, {}).expect(201);

    await api(t, w.recep, w.companyId)
      .post(`/work-orders/${order.id}/reopen`, { reason: 'Cliente reclamou do acabamento' })
      .expect(403);
    await api(t, w.admin, w.companyId)
      .post(`/work-orders/${order.id}/reopen`, { reason: 'curto' })
      .expect(400);
    await api(t, w.admin, w.companyId)
      .post(`/work-orders/${order.id}/reopen`, { reason: 'Cliente reclamou do acabamento' })
      .expect(201);

    const reopened = await getOrder(w, order.id);
    expect(reopened.status).toBe('SCHEDULED');
    expect(reopened.executions.map((e) => [e.sequence, e.status])).toEqual([
      [1, 'FINISHED'],
      [2, 'PENDING'],
    ]);
    expect(reopened.executions[0].items.some((i) => i.done)).toBe(true); // previous execution untouched
    expect(reopened.executions[1].items.every((i) => !i.done)).toBe(true);

    const restarted = await api(t, w.techA, w.companyId)
      .post(`/work-orders/${order.id}/start`)
      .expect(201);
    expect(restarted.body as { sequence: number; status: string }).toMatchObject({
      sequence: 2,
      status: 'IN_PROGRESS',
    });
    expect(await t.prisma.execution.count({ where: { workOrderId: order.id } })).toBe(2);
    // The admin who approved can approve again only if not a participant of execution 2: still allowed.
    await expect(t.prisma.execution.delete({ where: { id: execId } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it('only assigned technicians start, and only from the SCHEDULED state', async () => {
    const w = await world();
    const o = await createOrder(w);
    await api(t, w.techA, w.companyId).post(`/work-orders/${o.id}/start`).expect(403); // not assigned
    await assign(w, o.id, w.m.techA, 9, 11).expect(201);
    await api(t, w.techB, w.companyId).post(`/work-orders/${o.id}/start`).expect(403);
    await api(t, w.techA, w.companyId).post(`/work-orders/${o.id}/start`).expect(201);
    await api(t, w.techA, w.companyId).post(`/work-orders/${o.id}/start`).expect(409);
  });

  it('changes the primary technician during execution and keeps exactly one primary', async () => {
    const w = await world();
    const { order, execId } = await startedOrder(w);
    await assign(w, order.id, w.m.techB, 11, 13).expect(201);
    await api(t, w.techA, w.companyId)
      .put(`/executions/${execId}/primary`, { membershipId: w.m.techB })
      .expect(200);
    const o = await getOrder(w, order.id);
    const active = o.executions[0].participants.filter((p) => p.isPrimary);
    expect(active).toHaveLength(1);
    expect(active[0].membershipId).toBe(w.m.techB);
    await api(t, w.techA, w.companyId).post(`/executions/${execId}/finish`).expect(403); // no longer primary
  });

  it('shows professionals only their own agenda and validates ranges', async () => {
    const w = await world();
    const o1 = await createOrder(w, 'Ordem um');
    const o2 = await createOrder(w, 'Ordem dois');
    await assign(w, o1.id, w.m.techA, 9, 11).expect(201);
    await assign(w, o2.id, w.m.techB, 9, 11).expect(201);
    const q = `from=${at(0)}&to=${at(23)}`;
    const mine = await api(t, w.techA, w.companyId)
      .get(`/agenda?${q}&membershipId=${w.m.techB}`)
      .expect(200);
    expect((mine.body as { order: { id: string } }[]).map((r) => r.order.id)).toEqual([o1.id]);
    const all = await api(t, w.recep, w.companyId).get(`/agenda?${q}`).expect(200);
    expect(all.body).toHaveLength(2);
    await api(t, w.recep, w.companyId)
      .get(`/agenda?from=${at(23)}&to=${at(0)}`)
      .expect(400);
  });

  it('isolates orders between companies', async () => {
    const w = await world();
    const o = await createOrder(w);
    const ownerB = await signUp(t, 'OwnerB');
    const companyB = await createCompany(t, ownerB, 'Company B');
    await api(t, ownerB, companyB).get(`/work-orders/${o.id}`).expect(404);
    await api(t, ownerB, companyB)
      .post(`/work-orders/${o.id}/cancel`, { reason: 'invasão' })
      .expect(404);
    await api(t, ownerB, companyB).post(`/work-orders/${o.id}/approve`, {}).expect(404);
    await api(t, ownerB, companyB)
      .post('/work-orders', {
        clientId: w.clientId,
        addressId: w.addressId,
        serviceId: w.serviceId,
        title: 'cross',
      })
      .expect(404);
    const list = await api(t, ownerB, companyB).get('/work-orders').expect(200);
    expect(list.body).toEqual([]);
  });

  it('serialises concurrent state changes on the same order', async () => {
    const w = await world();
    const o = await createOrder(w);
    const results = await Promise.all([
      api(t, w.recep, w.companyId).post(`/work-orders/${o.id}/cancel`, { reason: 'cancelar A' }),
      api(t, w.recep, w.companyId).post(`/work-orders/${o.id}/cancel`, { reason: 'cancelar B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await getOrder(w, o.id)).version).toBe(2);
  });

  it('never hard-deletes orders or assignments', async () => {
    const w = await world();
    const o = await createOrder(w);
    const a = await assign(w, o.id, w.m.techA, 9, 11).expect(201);
    await expect(t.prisma.workOrder.delete({ where: { id: o.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      t.prisma.workOrderAssignment.delete({ where: { id: (a.body as { id: string }).id } }),
    ).rejects.toThrow(/cannot be deleted/);
  });
});
