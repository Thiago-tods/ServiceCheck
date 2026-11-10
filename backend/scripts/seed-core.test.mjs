import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addClients, addOrders, fakeApi, sameState, shape } from './fake-api.mjs';
import { DEMO, runSeed, SeedError, slot } from './seed-core.mjs';

const EXPECTED = {
  users: 2,
  companies: 1,
  members: 2, // the Owner and the technician
  clients: 1,
  addresses: 1,
  services: 1,
  versions: 1,
  orders: 2,
  assignments: 2,
};

function assertNoDuplicates(db) {
  const unique = (list, key) => assert.equal(new Set(list.map(key)).size, list.length);
  unique([...db.users.values()], (u) => u.email);
  unique(db.companies, (c) => c.name);
  unique(
    db.clients.filter((c) => c.name === DEMO.client),
    (c) => c.name,
  );
  unique(db.services, (s) => s.name);
  unique(
    db.orders.filter((o) => DEMO.orders.some((d) => d.title === o.title)),
    (o) => o.title,
  );
  unique(db.assignments, (a) => a.orderId);
}

const demoOrders = (db) => db.orders.filter((o) => DEMO.orders.some((d) => d.title === o.title));
const posts = (api, prefix) => api.log.filter((l) => l.startsWith(`POST ${prefix}`));

describe('seed core', () => {
  it('creates the demo data on an empty backend', async () => {
    const api = fakeApi();
    const { created } = await runSeed(api.call);
    assert.deepEqual(shape(api.db), EXPECTED);
    assert.ok(created.length >= 9);
    assertNoDuplicates(api.db);
  });

  it('running again creates nothing and duplicates nothing', async () => {
    const api = fakeApi();
    await runSeed(api.call);
    const second = await runSeed(api.call);
    const third = await runSeed(api.call);
    assert.deepEqual(second.created, []);
    assert.deepEqual(third.created, []);
    // A repeat only sends register (answered 409) and login: no data is written.
    assert.deepEqual(shape(api.db), EXPECTED);
  });

  it('never deletes or overwrites: only GET and POST are used, even after failures', async () => {
    const reference = fakeApi();
    await runSeed(reference.call);
    for (let k = 1; k <= reference.writes(); k++) {
      const api = fakeApi({ failAt: k });
      await assert.rejects(() => runSeed(api.call), SeedError);
      const retry = sameState(api);
      await runSeed(retry.call);
      for (const entry of [...api.log, ...retry.log]) assert.match(entry, /^(GET|POST) /);
    }
  });

  it('an interruption at ANY write is completed by the next run, without duplicates', async () => {
    const reference = fakeApi();
    await runSeed(reference.call);
    const total = reference.writes();
    assert.ok(total >= 12, `expected a dozen writes, got ${total}`);

    for (let k = 1; k <= total; k++) {
      for (const mode of ['failAt', 'dropAt']) {
        const api = fakeApi({ [mode]: k });
        await assert.rejects(
          () => runSeed(api.call),
          SeedError,
          `${mode}=${k} should stop the first run`,
        );
        // A later run against the same state, with the problem gone, finishes the job.
        const retry = sameState(api);
        await runSeed(retry.call);
        assert.deepEqual(shape(api.db), EXPECTED, `${mode}=${k}: incomplete or duplicated`);
        assertNoDuplicates(api.db);
        // And once complete, another run changes nothing.
        const again = await runSeed(retry.call);
        assert.deepEqual(again.created, [], `${mode}=${k}: third run created something`);
      }
    }
  });

  it('completes an order that was created but never assigned', async () => {
    const api = fakeApi();
    await runSeed(api.call);
    api.db.assignments.length = 0; // simulate: orders exist, assignments are missing
    const { created } = await runSeed(api.call);
    assert.equal(api.db.assignments.length, 2);
    assert.equal(api.db.orders.length, 2);
    assert.equal(created.filter((c) => c.startsWith('atribuição')).length, 2);
  });

  it('explains a login failure when the demo account exists with another password', async () => {
    const api = fakeApi();
    api.db.users.set(DEMO.owner.email, { id: 'u0', password: 'something-else', token: 't0' });
    await assert.rejects(() => runSeed(api.call), /login de owner@demo\.servicecheck\.test/);
  });

  it('stops with a clear error when the backend is not healthy', async () => {
    await assert.rejects(
      () => runSeed(async () => ({ status: 503, body: {} })),
      /\/health respondeu HTTP 503/,
    );
  });

  it('schedules the orders in the future, one hour each', () => {
    const now = new Date('2030-01-10T15:30:00Z');
    const s = slot(2, now);
    assert.equal(s.startsAt, '2030-01-12T09:00:00.000Z');
    assert.equal(s.endsAt, '2030-01-12T10:00:00.000Z');
  });
});

describe('seed core with paginated lists', () => {
  async function seeded() {
    const api = fakeApi();
    await runSeed(api.call);
    return { api, companyId: api.db.companies[0].id };
  }

  it('finds the demo orders when they are on the first page', async () => {
    const { api } = await seeded();
    const again = await runSeed(api.call);
    assert.deepEqual(again.created, []);
    assert.equal(api.db.orders.length, 2);
  });

  it('asks for the largest page the API accepts, not for its default of 50', async () => {
    const { api, companyId } = await seeded();
    addOrders(api, 130, companyId); // more than the default page of 50
    const again = await runSeed(api.call);
    assert.deepEqual(again.created, []);
    assert.equal(demoOrders(api.db).length, 2, 'no duplicate demo orders');
    assert.ok(api.log.some((l) => l.startsWith('GET /work-orders?limit=200&offset=0')));
    assert.ok(!api.log.some((l) => /limit=(?!200)/.test(l)), 'every list request uses limit=200');
  });

  it('finds the demo orders AFTER the first page (more than 400 other orders exist)', async () => {
    const { api, companyId } = await seeded();
    addOrders(api, 450, companyId); // newer than the demo orders: they end up on page 3
    const again = await runSeed(api.call);
    assert.deepEqual(again.created, []);
    assert.equal(api.db.orders.length, 452);
    assert.equal(demoOrders(api.db).length, 2);
    for (const offset of [0, 200, 400]) {
      assert.ok(
        api.log.includes(`GET /work-orders?limit=200&offset=${offset}`),
        `read offset ${offset}`,
      );
    }
  });

  it('finds the demo client after the first page too', async () => {
    const { api, companyId } = await seeded();
    addClients(api, 450, companyId);
    const again = await runSeed(api.call);
    assert.deepEqual(again.created, []);
    assert.equal(api.db.clients.filter((c) => c.name === DEMO.client).length, 1);
  });

  it('repeated runs with hundreds of orders never duplicate anything', async () => {
    const { api, companyId } = await seeded();
    addOrders(api, 450, companyId);
    for (let i = 0; i < 3; i++) assert.deepEqual((await runSeed(api.call)).created, []);
    assert.equal(demoOrders(api.db).length, 2);
    assertNoDuplicates(api.db);
  });

  it('a list whose size is an exact multiple of the page ends on an empty page', async () => {
    const { api, companyId } = await seeded();
    addOrders(api, 8, companyId); // 10 orders in total
    const mark = api.log.length; // only the requests of this run
    const again = await runSeed(api.call, { pageSize: 5 });
    assert.deepEqual(again.created, []);
    const reads = api.log.slice(mark).filter((l) => l.startsWith('GET /work-orders?'));
    assert.deepEqual(reads, [
      'GET /work-orders?limit=5&offset=0',
      'GET /work-orders?limit=5&offset=5',
      'GET /work-orders?limit=5&offset=10',
    ]);
  });

  describe('when the search cannot be completed, no order is created', () => {
    /** The demo orders are missing and many others exist: creating on a partial read would be wrong. */
    async function withoutDemoOrders(options) {
      const { api, companyId } = await seeded();
      api.db.orders.length = 0;
      api.db.assignments.length = 0;
      addOrders(api, 450, companyId);
      return sameState(api, options);
    }
    const noOrderCreated = (api) => assert.deepEqual(posts(api, '/work-orders'), []);

    it('a server error on a later page', async () => {
      const broken = await withoutDemoOrders({
        intercept: (method, path) =>
          method === 'GET' && path.includes('/work-orders?') && path.includes('offset=200')
            ? { status: 500, body: { message: 'boom' } }
            : undefined,
      });
      await assert.rejects(() => runSeed(broken.call), SeedError);
      noOrderCreated(broken);
      // The next run, with the problem gone, creates exactly the two demo orders.
      const retry = sameState(broken);
      await runSeed(retry.call);
      assert.equal(demoOrders(broken.db).length, 2);
      assert.equal(broken.db.orders.length, 452);
    });

    it('a network error on a later page', async () => {
      const broken = await withoutDemoOrders({
        intercept: (method, path) => {
          if (path.includes('/work-orders?') && path.includes('offset=400')) {
            throw new SeedError('rede caiu');
          }
        },
      });
      await assert.rejects(() => runSeed(broken.call), SeedError);
      noOrderCreated(broken);
    });

    for (const [label, body] of [
      ['an object instead of a list', { items: [], total: 0 }],
      ['null', null],
      ['text', 'not a list'],
      ['a list with an item that has no id', [{ title: 'x' }]],
      ['a list with a non-object item', ['x']],
    ]) {
      it(`an invalid pagination response: ${label}`, async () => {
        const broken = await withoutDemoOrders({
          intercept: (method, path) =>
            method === 'GET' && path.includes('/work-orders?') ? { status: 200, body } : undefined,
        });
        await assert.rejects(() => runSeed(broken.call), /resposta de paginação inválida/);
        noOrderCreated(broken);
      });
    }

    it('a server that ignores the offset and repeats the first page', async () => {
      const broken = await withoutDemoOrders({ ignoreOffset: true });
      await assert.rejects(() => runSeed(broken.call), /paginação inconsistente.*repetido/);
      noOrderCreated(broken);
    });

    it('a server that ignores the limit and returns more than was asked', async () => {
      const broken = await withoutDemoOrders({ ignoreLimit: true });
      await assert.rejects(() => runSeed(broken.call), /paginação inconsistente/);
      noOrderCreated(broken);
    });

    it('a server that never runs out of new pages', async () => {
      const broken = await withoutDemoOrders({ endless: true });
      await assert.rejects(
        () => runSeed(broken.call, { pageSize: 10, maxPages: 3 }),
        /mais de 30 registros/,
      );
      noOrderCreated(broken);
    });

    it('a failure reading the pages never leaves a half-created order behind', async () => {
      const broken = await withoutDemoOrders({
        intercept: (method, path) =>
          path.includes('/work-orders?') && path.includes('offset=200')
            ? { status: 503, body: {} }
            : undefined,
      });
      const before = shape(broken.db);
      await assert.rejects(() => runSeed(broken.call), SeedError);
      assert.deepEqual(shape(broken.db), before);
    });
  });
});
