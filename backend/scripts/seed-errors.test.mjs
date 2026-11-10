import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fakeApi } from './fake-api.mjs';
import { describeHttpStatus, runSeed, SeedError } from './seed-core.mjs';

/**
 * Whatever a server puts in the body of an error, none of it may reach a message. Each case below
 * answers ONE request of a complete seed run (every position in turn) with a hostile response
 * and checks the resulting error.
 */
const SECRETS = [
  'tok-fict-400',
  'pw-fict-401',
  'Bearer tok-fict-403',
  'tok-fict-500',
  'cookie-fict-500',
  'tok-fict-502',
  'senha-fict-conflito',
];

const BAD_RESPONSES = [
  { status: 400, body: { message: 'bad token tok-fict-400', token: 'tok-fict-400' } },
  { status: 401, body: { error: 'password is pw-fict-401', password: 'pw-fict-401' } },
  { status: 403, body: { headers: { authorization: 'Bearer tok-fict-403' } } },
  {
    status: 500,
    body: {
      received: {
        authorization: 'Bearer tok-fict-500',
        cookie: 'cookie-fict-500',
        url: 'http://127.0.0.1:3000/api/v1/auth/me',
        body: { password: 'senha-fict-conflito' },
      },
    },
  },
  { status: 502, body: '<html>Bad gateway tok-fict-502</html>' },
  { status: 404, body: ['tok-fict-500'] },
  { status: 429, body: 'cookie-fict-500' },
];

function assertSafeMessage(message, context) {
  assert.ok(message.length > 0, context);
  for (const secret of SECRETS)
    assert.ok(!message.includes(secret), `${context}: leaked ${secret}`);
  for (const word of ['Bearer', 'authorization', 'cookie', 'http://', '127.0.0.1', '<html>']) {
    assert.ok(!message.toLowerCase().includes(word.toLowerCase()), `${context}: leaked ${word}`);
  }
  assert.ok(!/\n\s+at /.test(message), `${context}: stack trace in message`);
}

describe('HTTP error bodies never reach the messages', () => {
  it('describeHttpStatus gives a generic hint for every class of status', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 302, 200]) {
      const hint = describeHttpStatus(status);
      assert.equal(typeof hint, 'string');
      assert.ok(hint.length > 5);
    }
    assert.match(describeHttpStatus(500), /servidor/);
    assert.match(describeHttpStatus(401), /não autorizado/);
  });

  it('every request position x every hostile response: safe message, status still identifiable', async () => {
    const reference = fakeApi();
    await runSeed(reference.call);
    const total = reference.log.length;
    assert.ok(total >= 20, `expected a long run, got ${total} requests`);

    let failures = 0;
    for (const bad of BAD_RESPONSES) {
      for (let position = 1; position <= total; position++) {
        let seen = 0;
        const api = fakeApi({
          intercept: () => {
            seen += 1;
            return seen === position ? bad : undefined;
          },
        });
        const context = `status ${bad.status} on request ${position}`;
        const error = await runSeed(api.call).then(
          () => null,
          (e) => e,
        );
        if (error === null) continue; // a response the seed legitimately tolerates (such as a 409)
        failures++;
        assert.ok(error instanceof SeedError, `${context}: ${error?.name}`);
        assertSafeMessage(error.message, context);
        assert.match(
          error.message,
          new RegExp(`HTTP ${bad.status}`),
          `${context}: status not shown`,
        );
      }
    }
    assert.ok(failures > 100, `only ${failures} failing combinations were exercised`);
  });

  it('a body is not needed to explain a failure: the message carries method-free, body-free text', async () => {
    const api = fakeApi({
      intercept: (method, path) =>
        method === 'GET' && path === '/members'
          ? { status: 500, body: { received: { authorization: 'Bearer tok-fict-500' } } }
          : undefined,
    });
    const error = await runSeed(api.call).then(
      () => null,
      (e) => e,
    );
    assert.equal(error.message, 'membros: HTTP 500 (erro interno do servidor).');
  });

  it('a login answer without a usable token is reported without echoing the answer', async () => {
    const api = fakeApi({
      intercept: (method, path) =>
        path === '/auth/login'
          ? { status: 200, body: { accessToken: 12345, note: 'tok-fict-400' } }
          : undefined,
    });
    const error = await runSeed(api.call).then(
      () => null,
      (e) => e,
    );
    assert.match(error.message, /não devolveu um token válido/);
    assertSafeMessage(error.message, 'invalid login answer');
  });
});
