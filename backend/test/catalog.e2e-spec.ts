import { addMember, api, createCompany, createTestApp, resetDb, signUp, TestApp } from './helpers';

describe('Clients, people and catalog (e2e, real PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t.prisma));
  afterAll(() => t.app.close());

  async function setup() {
    const owner = await signUp(t);
    const reception = await signUp(t);
    const pro = await signUp(t);
    const companyId = await createCompany(t, owner, 'Company A');
    await addMember(t, owner, companyId, reception.email, 'RECEPTIONIST');
    const proMembership = await addMember(t, owner, companyId, pro.email, 'PROFESSIONAL');
    return { owner, reception, pro, companyId, proMembership };
  }

  it('clients: office roles manage them, professionals are blocked', async () => {
    const { owner, reception, pro, companyId } = await setup();
    const created = await api(t, reception, companyId)
      .post('/clients', { name: 'Maria Silva' })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await api(t, pro, companyId).get('/clients').expect(403);
    await api(t, pro, companyId).get(`/clients/${id}`).expect(403);

    await api(t, owner, companyId)
      .post(`/clients/${id}/contacts`, { name: 'João', phone: '11999990000' })
      .expect(201);
    await api(t, owner, companyId)
      .post(`/clients/${id}/addresses`, {
        label: 'Casa',
        street: 'Rua A',
        city: 'São Paulo',
        state: 'SP',
        latitude: -23.5,
        longitude: -46.6,
      })
      .expect(201);
    const detail = await api(t, owner, companyId).get(`/clients/${id}`).expect(200);
    expect(detail.body).toMatchObject({ name: 'Maria Silva' });
    expect((detail.body as { contacts: unknown[] }).contacts).toHaveLength(1);
    expect((detail.body as { addresses: unknown[] }).addresses).toHaveLength(1);

    const search = await api(t, owner, companyId).get('/clients?q=maria').expect(200);
    expect(search.body).toHaveLength(1);
    await api(t, owner, companyId).get('/clients?limit=0').expect(400);
  });

  it('clients: strict tenant isolation, including nested resources', async () => {
    const a = await setup();
    const ownerB = await signUp(t);
    const companyB = await createCompany(t, ownerB, 'Company B');
    const created = await api(t, a.owner, a.companyId)
      .post('/clients', { name: 'Cliente A' })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const contact = await api(t, a.owner, a.companyId)
      .post(`/clients/${id}/contacts`, { name: 'Contato' })
      .expect(201);
    const contactId = (contact.body as { id: string }).id;

    await api(t, ownerB, companyB).get(`/clients/${id}`).expect(404);
    await api(t, ownerB, companyB).patch(`/clients/${id}`, { name: 'hack' }).expect(404);
    await api(t, ownerB, companyB).post(`/clients/${id}/contacts`, { name: 'x1' }).expect(404);
    await api(t, ownerB, companyB)
      .patch(`/clients/${id}/contacts/${contactId}`, { name: 'hack' })
      .expect(404);
    const listB = await api(t, ownerB, companyB).get('/clients').expect(200);
    expect(listB.body).toEqual([]);
    // Using company A's id with B's token is rejected at the tenant guard.
    await api(t, ownerB, a.companyId).get('/clients').expect(403);
  });

  it('clients are deactivated, not deleted, and changes are audited', async () => {
    const { owner, companyId } = await setup();
    const created = await api(t, owner, companyId)
      .post('/clients', { name: 'Cliente X' })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await api(t, owner, companyId).patch(`/clients/${id}`, { active: false }).expect(200);
    expect(await t.prisma.client.count({ where: { id } })).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { entityType: 'Client', entityId: id } })).toBe(
      2,
    );
  });

  it('specialties and teams: managers write, everyone reads, names are unique per company', async () => {
    const { owner, pro, companyId, proMembership } = await setup();
    await api(t, pro, companyId).post('/specialties', { name: 'Elétrica' }).expect(403);
    const sp = await api(t, owner, companyId)
      .post('/specialties', { name: 'Elétrica' })
      .expect(201);
    await api(t, owner, companyId).post('/specialties', { name: 'Elétrica' }).expect(409);
    await api(t, pro, companyId).get('/specialties').expect(200);

    const spId = (sp.body as { id: string }).id;
    await api(t, owner, companyId)
      .put(`/members/${proMembership}/specialties`, { specialtyIds: [spId] })
      .expect(200);
    await api(t, owner, companyId)
      .put(`/members/${proMembership}/specialties`, {
        specialtyIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(400);

    const team = await api(t, owner, companyId).post('/teams', { name: 'Equipe 1' }).expect(201);
    const teamId = (team.body as { id: string }).id;
    await api(t, owner, companyId)
      .put(`/teams/${teamId}/members`, { membershipIds: [proMembership] })
      .expect(200);
    const teams = await api(t, pro, companyId).get('/teams').expect(200);
    expect((teams.body as { members: unknown[] }[])[0].members).toHaveLength(1);
  });

  it("teams and specialties cannot reference another company's records", async () => {
    const a = await setup();
    const ownerB = await signUp(t);
    const companyB = await createCompany(t, ownerB, 'Company B');
    const spA = await api(t, a.owner, a.companyId)
      .post('/specialties', { name: 'Hidráulica' })
      .expect(201);
    const teamB = await api(t, ownerB, companyB).post('/teams', { name: 'Equipe B' }).expect(201);
    const bMember = (await t.prisma.membership.findFirstOrThrow({ where: { companyId: companyB } }))
      .id;

    await api(t, ownerB, companyB)
      .put(`/members/${bMember}/specialties`, { specialtyIds: [(spA.body as { id: string }).id] })
      .expect(400);
    await api(t, a.owner, a.companyId)
      .put(`/teams/${(teamB.body as { id: string }).id}/members`, { membershipIds: [] })
      .expect(404);
    await api(t, a.owner, a.companyId)
      .put(`/members/${bMember}/specialties`, { specialtyIds: [] })
      .expect(404);
  });

  it('checklists are versioned and immutable', async () => {
    const { owner, pro, companyId } = await setup();
    const svc = await api(t, owner, companyId)
      .post('/services', { name: 'Instalação de tomada' })
      .expect(201);
    const serviceId = (svc.body as { id: string }).id;
    await api(t, pro, companyId)
      .post(`/services/${serviceId}/checklist-versions`, { items: [{ label: 'x' }] })
      .expect(403);

    const v1 = await api(t, owner, companyId)
      .post(`/services/${serviceId}/checklist-versions`, {
        items: [
          { label: 'Desligar disjuntor', required: true },
          { label: 'Foto final', kind: 'PHOTO' },
        ],
      })
      .expect(201);
    const v2 = await api(t, owner, companyId)
      .post(`/services/${serviceId}/checklist-versions`, { items: [{ label: 'Novo item' }] })
      .expect(201);
    expect((v1.body as { version: number }).version).toBe(1);
    expect((v2.body as { version: number }).version).toBe(2);

    const detail = await api(t, pro, companyId).get(`/services/${serviceId}`).expect(200);
    expect(
      (detail.body as { currentChecklist: { version: number } }).currentChecklist.version,
    ).toBe(2);
    const all = await api(t, pro, companyId)
      .get(`/services/${serviceId}/checklist-versions`)
      .expect(200);
    expect((all.body as { items: unknown[] }[])[1].items).toHaveLength(2);

    const versionId = (v1.body as { id: string }).id;
    const itemId = (v1.body as { items: { id: string }[] }).items[0].id;
    await expect(
      t.prisma.checklistItem.update({ where: { id: itemId }, data: { label: 'tampered' } }),
    ).rejects.toThrow(/immutable/);
    await expect(t.prisma.checklistItem.delete({ where: { id: itemId } })).rejects.toThrow(
      /immutable/,
    );
    await expect(
      t.prisma.serviceChecklistVersion.delete({ where: { id: versionId } }),
    ).rejects.toThrow(/immutable/);
  });

  it('concurrent checklist publications never produce duplicate version numbers', async () => {
    const { owner, companyId } = await setup();
    const svc = await api(t, owner, companyId)
      .post('/services', { name: 'Serviço concorrente' })
      .expect(201);
    const serviceId = (svc.body as { id: string }).id;
    const publish = () =>
      api(t, owner, companyId).post(`/services/${serviceId}/checklist-versions`, {
        items: [{ label: 'a' }],
      });
    const results = await Promise.all([publish(), publish(), publish()]);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const versions = await t.prisma.serviceChecklistVersion.findMany({ where: { serviceId } });
    expect(new Set(versions.map((v) => v.version)).size).toBe(versions.length);
    expect(versions.length).toBe(results.filter((r) => r.status === 201).length);
  });

  it('service names are unique per company and isolated across companies', async () => {
    const a = await setup();
    const ownerB = await signUp(t);
    const companyB = await createCompany(t, ownerB, 'Company B');
    const svc = await api(t, a.owner, a.companyId)
      .post('/services', { name: 'Manutenção' })
      .expect(201);
    await api(t, a.owner, a.companyId).post('/services', { name: 'Manutenção' }).expect(409);
    await api(t, ownerB, companyB).post('/services', { name: 'Manutenção' }).expect(201);
    await api(t, ownerB, companyB)
      .get(`/services/${(svc.body as { id: string }).id}`)
      .expect(404);
  });
});
