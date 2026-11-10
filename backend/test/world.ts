import { addMember, api, createCompany, Session, signUp, TestApp } from './helpers';

/** A company with one person per role plus a client, address and service with a checklist. */
export async function setupWorld(
  t: TestApp,
  checklist: object[] = [
    { label: 'Obrigatório', required: true },
    { label: 'Texto', kind: 'TEXT' },
  ],
) {
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
    .post(`/clients/${clientId}/addresses`, { label: 'A', street: 'Rua', city: 'SP', state: 'SP' })
    .expect(201);
  const svc = await api(t, owner, companyId).post('/services', { name: 'Serviço' }).expect(201);
  const serviceId = (svc.body as { id: string }).id;
  await api(t, owner, companyId)
    .post(`/services/${serviceId}/checklist-versions`, { items: checklist })
    .expect(201);
  return {
    owner,
    admin,
    recep,
    tech,
    tech2,
    companyId,
    m,
    clientId,
    addressId: (addr.body as { id: string }).id,
    serviceId,
  };
}
export type World = Awaited<ReturnType<typeof setupWorld>>;

export async function scheduledOrder(
  t: TestApp,
  w: World,
  title = 'Ordem de teste',
  member = w.m.tech,
  hour = 9,
): Promise<string> {
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
      startsAt: `2027-03-01T${String(hour).padStart(2, '0')}:00:00Z`,
      endsAt: `2027-03-01T${String(hour + 1).padStart(2, '0')}:00:00Z`,
    })
    .expect(201);
  return id;
}

export async function startOrder(t: TestApp, w: World, orderId: string, as: Session = w.tech) {
  const res = await api(t, as, w.companyId).post(`/work-orders/${orderId}/start`).expect(201);
  return res.body as { id: string; items: { id: string; kind: string; required: boolean }[] };
}
