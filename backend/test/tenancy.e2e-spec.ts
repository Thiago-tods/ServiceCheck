import { Role } from '@prisma/client';
import request from 'supertest';
import { bearer, createCompany, createTestApp, resetDb, Session, signUp, TestApp } from './helpers';

describe('Tenancy and roles (e2e, real PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t.prisma));
  afterAll(() => t.app.close());

  const asCompany = (s: Session, companyId: string): [string, string][] => [
    bearer(s),
    ['X-Company-Id', companyId],
  ];
  const get = (path: string, s: Session, companyId?: string) => {
    const r = request(t.http())
      .get(path)
      .set(...bearer(s));
    return companyId ? r.set('X-Company-Id', companyId) : r;
  };
  const addMember = (owner: Session, companyId: string, email: string, role: Role) =>
    request(t.http())
      .post('/api/v1/members')
      .set(...asCompany(owner, companyId)[0])
      .set('X-Company-Id', companyId)
      .send({ email, role });

  it('creating a company makes the creator Owner', async () => {
    const owner = await signUp(t);
    const companyId = await createCompany(t, owner);
    const res = await get('/api/v1/companies', owner).expect(200);
    expect(res.body).toEqual([{ id: companyId, name: 'Acme', role: 'OWNER' }]);
  });

  it('isolates companies: outsiders cannot read another tenant', async () => {
    const ownerA = await signUp(t);
    const ownerB = await signUp(t);
    const companyA = await createCompany(t, ownerA, 'Company A');
    await createCompany(t, ownerB, 'Company B');

    await get('/api/v1/members', ownerA, companyA).expect(200);
    await get('/api/v1/members', ownerB, companyA).expect(403);
    await get('/api/v1/members', ownerA).expect(403); // no header
    await get('/api/v1/members', ownerA, 'not-a-uuid').expect(403);
    await get('/api/v1/members', ownerA, '00000000-0000-4000-8000-000000000000').expect(403);
  });

  it('one user can belong to several companies with different roles', async () => {
    const owner = await signUp(t);
    const other = await signUp(t);
    const companyA = await createCompany(t, owner, 'Company A');
    const companyB = await createCompany(t, other, 'Company B');
    await addMember(other, companyB, owner.email, Role.PROFESSIONAL).expect(201);

    const mine = await get('/api/v1/companies', owner).expect(200);
    expect((mine.body as { role: string }[]).map((c) => c.role).sort()).toEqual([
      'OWNER',
      'PROFESSIONAL',
    ]);
    await get('/api/v1/members', owner, companyA).expect(200);
    await get('/api/v1/members', owner, companyB).expect(403); // professional cannot list members
  });

  it('enforces roles in the backend', async () => {
    const owner = await signUp(t);
    const pro = await signUp(t);
    const companyId = await createCompany(t, owner);
    await addMember(owner, companyId, pro.email, Role.PROFESSIONAL).expect(201);
    await get('/api/v1/members', pro, companyId).expect(403);
    await addMember(pro, companyId, owner.email, Role.ADMIN).expect(403);
  });

  it('admins cannot grant or modify Owner/Admin members', async () => {
    const owner = await signUp(t);
    const admin = await signUp(t);
    const newcomer = await signUp(t);
    const companyId = await createCompany(t, owner);
    await addMember(owner, companyId, admin.email, Role.ADMIN).expect(201);

    await addMember(admin, companyId, newcomer.email, Role.ADMIN).expect(403);
    await addMember(admin, companyId, newcomer.email, Role.OWNER).expect(403);
    await addMember(admin, companyId, newcomer.email, Role.RECEPTIONIST).expect(201);

    const members = (await get('/api/v1/members', owner, companyId).expect(200)).body as {
      id: string;
      role: string;
    }[];
    const ownerMember = members.find((m) => m.role === 'OWNER')!;
    await request(t.http())
      .patch(`/api/v1/members/${ownerMember.id}`)
      .set(...bearer(admin))
      .set('X-Company-Id', companyId)
      .send({ active: false })
      .expect(403);
  });

  it('never leaves a company without an active Owner', async () => {
    const owner = await signUp(t);
    const companyId = await createCompany(t, owner);
    const members = (await get('/api/v1/members', owner, companyId).expect(200)).body as {
      id: string;
    }[];
    const patch = (body: object) =>
      request(t.http())
        .patch(`/api/v1/members/${members[0].id}`)
        .set(...bearer(owner))
        .set('X-Company-Id', companyId)
        .send(body);
    await patch({ role: 'ADMIN' }).expect(409);
    await patch({ active: false }).expect(409);
  });

  it('deactivated members lose access but their record and audit remain', async () => {
    const owner = await signUp(t);
    const pro = await signUp(t);
    const companyId = await createCompany(t, owner);
    const added = await addMember(owner, companyId, pro.email, Role.RECEPTIONIST).expect(201);
    const membershipId = (added.body as { id: string }).id;
    await get('/api/v1/members', pro, companyId).expect(200);

    await request(t.http())
      .patch(`/api/v1/members/${membershipId}`)
      .set(...bearer(owner))
      .set('X-Company-Id', companyId)
      .send({ active: false })
      .expect(200);

    await get('/api/v1/members', pro, companyId).expect(403);
    expect(await t.prisma.membership.count({ where: { id: membershipId } })).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { entityId: membershipId } })).toBe(2);
  });

  it('cannot touch a membership from another company by id', async () => {
    const ownerA = await signUp(t);
    const ownerB = await signUp(t);
    const companyA = await createCompany(t, ownerA, 'Company A');
    await createCompany(t, ownerB, 'Company B');
    const bMembers = (await t.prisma.membership.findMany({ where: { userId: ownerB.userId } }))[0];
    await request(t.http())
      .patch(`/api/v1/members/${bMembers.id}`)
      .set(...bearer(ownerA))
      .set('X-Company-Id', companyA)
      .send({ active: false })
      .expect(404);
  });
});
