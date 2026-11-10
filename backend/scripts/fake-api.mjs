/**
 * A small in-memory stand-in for the backend API, used by the seed tests. It behaves like the real
 * thing where the seed depends on it: duplicate e-mails answer 409, lists are filtered by company,
 * and GET /work-orders and GET /clients are paginated with the real contract (limit 1..200, default
 * 50, offset >= 0; anything else is a 400; orders newest first).
 *
 * Failure injection:
 *   failAt      the Nth write (POST) answers HTTP 500
 *   dropAt      the Nth write (POST) throws, as a network error would
 *   intercept   (method, path) => undefined | { status, body } | throws: overrides any request
 *   ignoreOffset  list endpoints always return the first page
 *   endless     list endpoints return brand new items on every page, forever
 *   ignoreLimit list endpoints return everything, whatever limit was asked
 */
import { SeedError } from './seed-core.mjs';

let seq = 0; // global, so ids never collide between fakes that share state

export function fakeApi({ failAt, dropAt, intercept, ignoreOffset, endless, ignoreLimit } = {}) {
  const db = {
    users: new Map(),
    companies: [],
    members: [],
    clients: [],
    addresses: [],
    services: [],
    versions: [],
    orders: [],
    assignments: [],
  };
  const log = [];
  let writes = 0;
  const id = (p) => `${p}-${++seq}`;
  const res = (status, body = {}) => ({ status, body });
  const userOf = (token) => [...db.users.values()].find((u) => u.token === token);

  function page(rows, params) {
    const limit = params.has('limit') ? Number(params.get('limit')) : 50;
    const offset = params.has('offset') ? Number(params.get('offset')) : 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return res(400, { message: 'limit' });
    if (!Number.isInteger(offset) || offset < 0) return res(400, { message: 'offset' });
    if (endless) {
      return res(
        200,
        Array.from({ length: limit }, () => ({ id: id('x'), title: 'x', name: 'x' })),
      );
    }
    if (ignoreLimit) return res(200, rows);
    return res(200, rows.slice(ignoreOffset ? 0 : offset, (ignoreOffset ? 0 : offset) + limit));
  }

  async function call(method, fullPath, { token, companyId, body } = {}) {
    log.push(`${method} ${fullPath}`);
    const overridden = intercept?.(method, fullPath);
    if (overridden) return overridden;
    if (method === 'POST') {
      writes += 1;
      if (writes === dropAt) throw new SeedError('rede caiu');
      if (writes === failAt) return res(500, { message: 'boom' });
    }
    const [path, query = ''] = fullPath.split('?');
    const params = new URLSearchParams(query);
    const [, a, b, c] = path.split('/');
    if (path === '/health') return res(200, { status: 'ok' });
    if (path === '/auth/register') {
      if (db.users.has(body.email)) return res(409, { message: 'exists' });
      db.users.set(body.email, { id: id('user'), ...body, token: `tok-${body.email}` });
      return res(201, {});
    }
    if (path === '/auth/login') {
      const u = db.users.get(body.email);
      return u && u.password === body.password ? res(200, { accessToken: u.token }) : res(401);
    }
    const user = userOf(token);
    if (!user) return res(401);
    if (path === '/auth/me') {
      return res(200, {
        memberships: db.members
          .filter((m) => m.userId === user.id)
          .map((m) => ({
            companyId: m.companyId,
            companyName: db.companies.find((x) => x.id === m.companyId).name,
            membershipId: m.id,
          })),
      });
    }
    if (path === '/companies' && method === 'POST') {
      const company = { id: id('co'), name: body.name };
      db.companies.push(company);
      db.members.push({
        id: id('m'),
        companyId: company.id,
        userId: user.id,
        email: user.email,
        role: 'OWNER',
      });
      return res(201, company);
    }
    const inCompany = (x) => x.companyId === companyId;
    if (path === '/members') {
      if (method === 'GET') return res(200, db.members.filter(inCompany));
      const target = db.users.get(body.email);
      if (!target) return res(404);
      const member = {
        id: id('m'),
        companyId,
        userId: target.id,
        email: body.email,
        role: body.role,
      };
      db.members.push(member);
      return res(201, member);
    }
    if (a === 'clients') {
      if (!b) {
        if (method === 'GET') return page([...db.clients.filter(inCompany)].reverse(), params);
        const client = { id: id('cl'), companyId, name: body.name };
        db.clients.push(client);
        return res(201, client);
      }
      if (c === 'addresses') {
        const address = { id: id('ad'), companyId, clientId: b, ...body };
        db.addresses.push(address);
        return res(201, address);
      }
      return res(200, {
        ...db.clients.find((x) => x.id === b),
        addresses: db.addresses.filter((x) => x.clientId === b),
      });
    }
    if (a === 'services') {
      if (!b) {
        if (method === 'GET') return res(200, db.services.filter(inCompany));
        const service = { id: id('sv'), companyId, name: body.name };
        db.services.push(service);
        return res(201, service);
      }
      if (c === 'checklist-versions') {
        db.versions.push({ serviceId: b, items: body.items });
        return res(201, {});
      }
      const versions = db.versions.filter((v) => v.serviceId === b);
      return res(200, {
        ...db.services.find((x) => x.id === b),
        currentChecklist: versions.at(-1) ?? null,
      });
    }
    if (a === 'work-orders') {
      if (!b) {
        if (method === 'GET') return page([...db.orders.filter(inCompany)].reverse(), params);
        const order = { id: id('or'), companyId, ...body };
        db.orders.push(order);
        return res(201, order);
      }
      if (c === 'assignments') {
        db.assignments.push({ orderId: b, ...body, releasedAt: null });
        return res(201, {});
      }
      return res(200, {
        ...db.orders.find((x) => x.id === b),
        assignments: db.assignments.filter((x) => x.orderId === b),
      });
    }
    return res(404);
  }
  return { call, db, log, writes: () => writes };
}

/** A healthy server over the same data (no injected failure). */
export function sameState(api, options = {}) {
  const healthy = fakeApi(options);
  for (const key of Object.keys(api.db)) healthy.db[key] = api.db[key];
  return healthy;
}

export const shape = (db) => ({
  users: db.users.size,
  companies: db.companies.length,
  members: db.members.length,
  clients: db.clients.length,
  addresses: db.addresses.length,
  services: db.services.length,
  versions: db.versions.length,
  orders: db.orders.length,
  assignments: db.assignments.length,
});

/** Other people's records in the demo company: they push the demo ones off the first page. */
export function addOrders(api, n, companyId) {
  for (let i = 0; i < n; i++) {
    api.db.orders.push({ id: `other-or-${++seq}`, companyId, title: `Outra ordem ${i}` });
  }
}

export function addClients(api, n, companyId) {
  for (let i = 0; i < n; i++) {
    api.db.clients.push({ id: `other-cl-${++seq}`, companyId, name: `Outro cliente ${i}` });
  }
}
