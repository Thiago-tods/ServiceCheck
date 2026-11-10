import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';
import { SeedError } from './seed-core.mjs';
import { makeHttpCall, routeOf } from './seed-http.mjs';

const servers = [];

/** Starts a throwaway local server; `handler` decides how each request is (not) answered. */
async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}/api/v1`, port };
}

after(() => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
});

// Values that must never show up in an error message.
const SECRETS = { token: 'tok-SECRET-123', password: 'pw-SECRET-456', companyId: 'co-SECRET-789' };

async function failureOf(call) {
  try {
    await call('POST', '/auth/login', {
      token: SECRETS.token,
      companyId: SECRETS.companyId,
      body: { email: 'a@b.test', password: SECRETS.password },
    });
  } catch (e) {
    return e;
  }
  assert.fail('the call should have failed');
}

function assertFriendly(error, server) {
  assert.ok(error instanceof SeedError, `expected a SeedError, got ${error?.name}`);
  const text = `${error.message}`;
  for (const secret of Object.values(SECRETS))
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.ok(!text.includes(String(server.port)), 'message contains the server port');
  assert.ok(
    !text.includes('127.0.0.1') && !text.includes('http://'),
    'message contains the address',
  );
  assert.ok(!/\n\s+at /.test(text), 'message contains a stack trace');
}

describe('seed HTTP calls', () => {
  it('returns status and parsed JSON', async () => {
    const api = await serve((req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end('{"id":"x"}');
    });
    const result = await makeHttpCall(api.baseUrl)('POST', '/clients', { body: { name: 'n' } });
    assert.deepEqual(result, { status: 201, body: { id: 'x' } });
  });

  it('a body that is not JSON keeps nothing of its text, and arbitrary text never survives', async () => {
    const api = await serve((req, res) => res.end('<html>nope tok-fict-text</html>'));
    const result = await makeHttpCall(api.baseUrl)('GET', '/health');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {});
    assert.ok(!JSON.stringify(result).includes('tok-fict-text'));
  });

  it('timeout WHILE READING the body: headers arrive, the body never completes', async () => {
    const api = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"status"'); // and then nothing, ever
    });
    const started = Date.now();
    const error = await failureOf(makeHttpCall(api.baseUrl, { timeoutMs: 300 }));
    assert.ok(Date.now() - started < 3000, 'should give up near the timeout');
    assert.match(error.message, /não respondeu por completo em 0\.3s/);
    assert.match(error.message, /POST \/auth\/login/);
    assertFriendly(error, api);
  });

  it('timeout when the server never even sends headers', async () => {
    const api = await serve(() => {
      /* never answers */
    });
    const error = await failureOf(makeHttpCall(api.baseUrl, { timeoutMs: 300 }));
    assert.match(error.message, /não respondeu por completo/);
    assertFriendly(error, api);
  });

  it('the connection is cut in the middle of the body', async () => {
    const api = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '500' });
      res.write('{"partial":');
      setTimeout(() => res.destroy(), 30);
    });
    const error = await failureOf(makeHttpCall(api.baseUrl, { timeoutMs: 3000 }));
    assert.match(error.message, /interrompida durante a resposta/);
    assertFriendly(error, api);
  });

  it('connection refused says the backend may be down, without the port', async () => {
    const api = await serve(() => {});
    const closed = { ...api, baseUrl: api.baseUrl };
    servers.pop().close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const error = await failureOf(makeHttpCall(closed.baseUrl, { timeoutMs: 2000 }));
    assert.match(error.message, /ECONNREFUSED/);
    assert.match(error.message, /backend está rodando/);
    assertFriendly(error, closed);
  });

  it('an id in the route is masked in the message, whatever its format', async () => {
    const closed = await serve(() => {});
    const baseUrl = closed.baseUrl;
    servers.pop().close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const call = makeHttpCall(baseUrl, { timeoutMs: 500 });
    for (const id of [
      '3f2a9c1e-5b20-4d48-86a1-0c7e9f3d2b14',
      'tok-fict-leak',
      '12345',
      'ação-fict',
    ]) {
      const error = await call('POST', `/clients/${id}/addresses?limit=200`).catch((e) => e);
      assert.ok(error instanceof SeedError);
      assert.match(error.message, /POST \/clients\/:id\/addresses[:)]/, `route kept for ${id}`);
      assert.ok(!error.message.includes(id), `message leaked ${id}`);
      assert.ok(!error.message.includes('limit'), 'the query string is dropped');
    }
  });
});

describe('route masking (routeOf)', () => {
  const UUID_ID = '3f2a9c1e-5b20-4d48-86a1-0c7e9f3d2b14';
  // Every shape an id can take: UUID, token-like, numeric, free text, encoded, very long, and
  // even values that look like the fixed words of the routes.
  const ids = [
    UUID_ID,
    'tok-fict-leak',
    'Bearer tok-fict-leak',
    'eyJhbGciOi.fict.sig',
    '12345',
    '0',
    '007',
    'ação',
    'a%2Fb',
    '..',
    'ABC.def_ghi-123',
    'x'.repeat(300),
    'clients',
    'me',
    'addresses',
    'work-orders',
  ];

  it('keeps every route of the seed readable, with no id', () => {
    const fixed = [
      ['/health', '/health'],
      ['/auth/register', '/auth/register'],
      ['/auth/login', '/auth/login'],
      ['/auth/me', '/auth/me'],
      ['/companies', '/companies'],
      ['/members', '/members'],
      ['/clients', '/clients'],
      ['/services', '/services'],
      ['/work-orders', '/work-orders'],
      ['/clients?limit=200&offset=0', '/clients'],
      ['/work-orders?limit=200&offset=400', '/work-orders'],
    ];
    for (const [path, expected] of fixed) assert.equal(routeOf(path), expected, path);
  });

  it('masks the id of every route that has one, in every format', () => {
    const templates = [
      [(id) => `/clients/${id}`, '/clients/:id'],
      [(id) => `/clients/${id}/addresses`, '/clients/:id/addresses'],
      [(id) => `/services/${id}`, '/services/:id'],
      [(id) => `/services/${id}/checklist-versions`, '/services/:id/checklist-versions'],
      [(id) => `/work-orders/${id}`, '/work-orders/:id'],
      [(id) => `/work-orders/${id}/assignments`, '/work-orders/:id/assignments'],
    ];
    for (const [make, expected] of templates) {
      for (const id of ids)
        assert.equal(routeOf(make(id)), expected, `${make('ID')} with ${id.slice(0, 20)}`);
    }
  });

  it('shows no part of an id', () => {
    for (const id of ids.filter(
      (v) => v.length > 6 && !/^(clients|addresses|work-orders)$/.test(v),
    )) {
      const shown = routeOf(`/clients/${id}/addresses?token=${id}`);
      assert.ok(!shown.includes(id), `${id.slice(0, 20)} appears in ${shown.slice(0, 60)}`);
      assert.ok(!shown.includes('token'), 'the query string is dropped');
    }
  });

  it('masks a segment that is not one of the fixed words of the seed routes', () => {
    assert.equal(routeOf('/other/xyz'), '/:id/:id');
    assert.equal(routeOf('/auth/secret-route'), '/auth/:id');
  });

  it('copes with odd input', () => {
    assert.equal(routeOf(''), '/');
    assert.equal(routeOf('/'), '/');
    assert.equal(routeOf('clients/abc'), '/clients/:id');
    assert.equal(routeOf('//clients///abc//addresses//'), '/clients/:id/addresses');
    assert.equal(routeOf('/clients/abc#fragment'), '/clients/:id');
    assert.equal(routeOf(undefined), '/:id');
  });
});
