import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeApi, shape } from './fake-api.mjs';

/**
 * End to end through the real command line: the seed runs as a child process against a throwaway
 * HTTP server that speaks the backend's protocol (backed by the in-memory fake), and the tests look
 * at everything it prints. They never touch a database or a real backend.
 */
const CLI = fileURLToPath(new URL('./seed-demo.mjs', import.meta.url));
const LOCAL_DB = 'postgresql://postgres@localhost:54329/servicecheck_dev?schema=public';
const REMOTE_DB = 'postgresql://admin:p4ss-fict@db.remoto.example:5432/prod';

const servers = [];
after(() => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
});

async function serve(api, override) {
  const server = createServer((req, res) => {
    if (override?.(req, res)) return; // a route answered by the test itself
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const auth = req.headers.authorization ?? '';
      const result = await api.call(req.method, req.url.replace(/^\/api\/v1/, ''), {
        token: auth.startsWith('Bearer ') ? auth.slice(7) : undefined,
        companyId: req.headers['x-company-id'],
        body: text ? JSON.parse(text) : undefined,
      });
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server.address().port;
}

async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function runCli(env) {
  const base = { ...process.env };
  for (const key of ['NODE_ENV', 'API_URL', 'DATABASE_URL']) delete base[key];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI], { env: { ...base, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err, all: out + err }));
  });
}

const LEAKS = ['user-fict', 'senha-fict', 'p4ss-fict', 'db.remoto.example', 'http://', 'https://'];
function assertNoLeak(output, extra = []) {
  for (const leak of [...LEAKS, ...extra]) {
    assert.ok(!output.includes(leak), `the output contains ${JSON.stringify(leak)}`);
  }
  assert.ok(!/\n\s+at .*\(.*:\d+:\d+\)/.test(output), 'the output contains a stack trace');
}

describe('seed command line', () => {
  it('success: creates the data and its summary never contains the API address', async () => {
    const api = fakeApi();
    const port = await serve(api);
    const { code, out, err } = await runCli({
      API_URL: `http://127.0.0.1:${port}/api/v1`,
      DATABASE_URL: LOCAL_DB,
    });
    assert.equal(code, 0, err);
    assert.match(out, /criados ou completados/);
    assert.match(out, /Banco:\s+local, confirmado por variável de ambiente DATABASE_URL/);
    assert.match(out, /owner@demo\.servicecheck\.test/);
    assert.deepEqual(shape(api.db).orders, 2);
    assertNoLeak(out + err, ['127.0.0.1', String(port), 'localhost']);
  });

  it('a second run is a no-op and still prints no address', async () => {
    const api = fakeApi();
    const port = await serve(api);
    const env = { API_URL: `http://127.0.0.1:${port}/api/v1`, DATABASE_URL: LOCAL_DB };
    await runCli(env);
    const before = shape(api.db);
    const { code, out, err } = await runCli(env);
    assert.equal(code, 0, err);
    assert.match(out, /já existiam e estão completos/);
    assert.deepEqual(shape(api.db), before);
    assertNoLeak(out + err, ['127.0.0.1', String(port)]);
  });

  it('a URL with credentials: nothing from it appears on failure (backend running)', async () => {
    const api = fakeApi();
    const port = await serve(api);
    const { code, all } = await runCli({
      API_URL: `http://user-fict:senha-fict@127.0.0.1:${port}/api/v1`,
      DATABASE_URL: LOCAL_DB,
    });
    assert.equal(code, 1);
    assert.match(all, /API/);
    assertNoLeak(all, ['127.0.0.1', String(port)]);
    assert.equal(shape(api.db).orders, 0, 'nothing was created');
  });

  it('a URL with credentials: nothing from it appears when the backend is down', async () => {
    const port = await closedPort();
    const { code, all } = await runCli({
      API_URL: `http://user-fict:senha-fict@127.0.0.1:${port}/api/v1`,
      DATABASE_URL: LOCAL_DB,
    });
    assert.equal(code, 1);
    assertNoLeak(all, ['127.0.0.1', String(port)]);
  });

  it('a URL with credentials: nothing from it appears when the seed refuses the database', async () => {
    const port = await closedPort();
    const { code, all } = await runCli({
      API_URL: `http://user-fict:senha-fict@127.0.0.1:${port}/api/v1`,
      DATABASE_URL: REMOTE_DB,
    });
    assert.equal(code, 1);
    assert.match(all, /seed:demo recusado/);
    assertNoLeak(all, ['127.0.0.1', String(port)]);
  });

  it('a credentialed URL that is also not local: refused without echoing it', async () => {
    const { code, all } = await runCli({
      API_URL: 'https://user-fict:senha-fict@api.interna.example/v1',
      DATABASE_URL: LOCAL_DB,
    });
    assert.equal(code, 1);
    assert.match(all, /seed:demo recusado/);
    assertNoLeak(all, ['api.interna.example']);
  });

  it('refuses an external database even when the API is local and healthy', async () => {
    const api = fakeApi();
    const port = await serve(api);
    const { code, all } = await runCli({
      API_URL: `http://127.0.0.1:${port}/api/v1`,
      DATABASE_URL: REMOTE_DB,
    });
    assert.equal(code, 1);
    assert.deepEqual(api.log, [], 'the backend was never contacted');
    assertNoLeak(all, ['127.0.0.1', String(port)]);
  });
});

describe('seed command line: hostile HTTP responses never reach stdout or stderr', () => {
  // The server behaves, except on one route, where it answers like a misbehaving or malicious one.
  const hostile = [
    {
      label: 'HTTP 400 whose body holds a token',
      route: /\/auth\/register$/,
      status: 400,
      body: () => JSON.stringify({ message: 'bad request', token: 'tok-fict-400' }),
      shown: /HTTP 400/,
    },
    {
      label: 'HTTP 401 whose body holds a password',
      route: /\/auth\/login$/,
      status: 401,
      body: () => JSON.stringify({ error: 'wrong password pw-fict-401' }),
      shown: /HTTP 401/,
    },
    {
      label: 'HTTP 403 whose body holds an Authorization header',
      route: /\/clients\?/,
      status: 403,
      body: () => JSON.stringify({ headers: { authorization: 'Bearer tok-fict-403' } }),
      shown: /HTTP 403/,
    },
    {
      label: 'HTTP 500 that echoes the request headers and URL',
      route: /\/auth\/me$/,
      status: 500,
      body: (req) =>
        JSON.stringify({ received: { headers: req.headers, url: req.url, method: req.method } }),
      shown: /HTTP 500/,
    },
    {
      label: 'HTTP 502 with an arbitrary HTML text',
      route: /\/work-orders\?/,
      status: 502,
      body: () => '<html><body>Bad gateway tok-fict-502 cookie=cookie-fict-502</body></html>',
      shown: /HTTP 502/,
    },
    {
      label: 'HTTP 200 whose body is not valid JSON',
      route: /\/auth\/register$/,
      status: 200,
      body: () => 'not json at all tok-fict-text {{{',
      shown: /HTTP 200/,
    },
    {
      label: 'HTTP 200 with invalid JSON where a token is expected',
      route: /\/auth\/login$/,
      status: 200,
      body: () => '<<< tok-fict-text >>>',
      shown: /token válido/,
    },
  ];
  const SECRETS = [
    'tok-fict-400',
    'pw-fict-401',
    'tok-fict-403',
    'tok-fict-502',
    'cookie-fict-502',
    'tok-fict-text',
  ];

  for (const { label, route, status, body, shown } of hostile) {
    it(label, async () => {
      const api = fakeApi();
      const port = await serve(api, (req, res) => {
        if (!route.test(req.url)) return false;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(body(req));
        return true;
      });
      const { code, all } = await runCli({
        API_URL: `http://127.0.0.1:${port}/api/v1`,
        DATABASE_URL: LOCAL_DB,
      });
      assert.equal(code, 1, all);
      assert.match(all, shown, 'the failure is still identifiable');
      for (const secret of SECRETS) assert.ok(!all.includes(secret), `leaked ${secret}`);
      for (const word of ['Bearer', 'authorization', 'cookie', 'x-company-id']) {
        assert.ok(!all.toLowerCase().includes(word.toLowerCase()), `leaked ${word}`);
      }
      assertNoLeak(all, ['127.0.0.1', String(port)]);
    });
  }
});
