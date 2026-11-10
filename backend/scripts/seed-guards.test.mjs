import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import {
  assertSafeToSeed,
  assessApiUrl,
  assessDatabaseUrl,
  assessNodeEnv,
  canonicalNodeEnv,
  collectDatabaseUrls,
  readDeclarations,
  SeedRefusal,
} from './seed-guards.mjs';

const LOCAL_DB = 'postgresql://postgres@localhost:54329/servicecheck_dev?schema=public';

describe('NODE_ENV', () => {
  it('canonicalNodeEnv trims, lowercases and treats empty as unset', () => {
    assert.equal(canonicalNodeEnv(' Production '), 'production');
    assert.equal(canonicalNodeEnv(''), undefined);
    assert.equal(canonicalNodeEnv('   '), undefined);
    assert.equal(canonicalNodeEnv(undefined), undefined);
  });

  for (const value of ['production', 'Production', 'PRODUCTION', ' production ']) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      assert.match(assessNodeEnv(value), /production/);
    });
  }
  for (const value of ['staging', 'prod', 'qa', 'homolog']) {
    it(`refuses the non-development value ${JSON.stringify(value)}`, () => {
      assert.ok(assessNodeEnv(value));
    });
  }
  for (const value of [
    undefined,
    '',
    'development',
    'Development',
    'DEVELOPMENT',
    'test',
    ' TEST ',
  ]) {
    it(`allows ${JSON.stringify(value)}`, () => {
      assert.equal(assessNodeEnv(value), null);
    });
  }
});

describe('API address', () => {
  const allowed = [
    'http://localhost:3000/api/v1',
    'http://LOCALHOST:3000/api/v1',
    'http://127.0.0.1:3000/api/v1',
    'http://[::1]:3000/api/v1',
    'https://localhost:3443/api/v1',
    'http://user:pw@localhost:3000/api/v1',
  ];
  const refused = [
    'http://127.0.0.2:3000',
    'http://0.0.0.0:3000',
    'http://10.0.2.2:3000',
    'http://192.168.1.10:3000',
    'http://localhost.evil.com',
    'http://localhost@evil.com',
    'http://evil.com#localhost',
    'http://evil.com/?h=localhost',
    'https://api.example.com/v1',
    'ftp://localhost/api',
    'file:///etc/hosts',
    '',
    'not a url',
    'http://::1:3000/api',
  ];
  for (const url of allowed) {
    it(`allows ${url}`, () => assert.equal(assessApiUrl(url), null));
  }
  for (const url of refused) {
    it(`refuses ${JSON.stringify(url)}`, () => assert.ok(assessApiUrl(url)));
  }
});

describe('database address', () => {
  const allowed = [
    LOCAL_DB,
    'postgres://u:p@127.0.0.1:5432/db',
    'postgresql://u:p@[::1]:5432/db',
    'postgresql://u:p@LOCALHOST/db',
    'postgresql://localhost/db?sslmode=disable&schema=public',
  ];
  const refused = {
    'IPv4 loopback range, not 127.0.0.1': 'postgresql://u:p@127.0.0.2:5432/db',
    'all interfaces': 'postgresql://u:p@0.0.0.0:5432/db',
    'private network IP': 'postgresql://u:p@192.168.1.50:5432/db',
    'another private network IP': 'postgresql://u:p@10.0.0.5:5432/db',
    'external host': 'postgresql://u:p@db.example.com:5432/db',
    'cloud host': 'postgresql://u:p@mydb.abc123.us-east-1.rds.amazonaws.com:5432/db',
    'host that starts with localhost': 'postgresql://u:p@localhost.evil.com:5432/db',
    'user part that looks like localhost': 'postgresql://localhost:p@evil.com:5432/db',
    'two hosts (ambiguous)': 'postgresql://u:p@localhost:5432,evil.com:5432/db',
    'no host': 'postgresql:///db',
    'unix socket path': 'postgresql://u@localhost/db?host=/var/run/postgresql',
    'host overridden by a parameter': 'postgresql://u:p@localhost:5432/db?host=evil.com',
    'hostaddr overridden by a parameter': 'postgresql://u:p@localhost:5432/db?hostaddr=203.0.113.9',
    'socket parameter': 'postgresql://u@localhost/db?socket=/tmp/pg',
    'another scheme': 'mysql://u:p@localhost:3306/db',
    'file URL': 'file:///tmp/db.sqlite',
    'not a URL': 'localhost',
    empty: '',
    'whitespace only': '   ',
    missing: undefined,
  };
  for (const url of allowed) {
    it(`allows a local database (${url.replace(/\/\/.*@/, '//…@')})`, () => {
      assert.equal(assessDatabaseUrl(url), null);
    });
  }
  for (const [label, url] of Object.entries(refused)) {
    it(`refuses ${label}`, () => assert.ok(assessDatabaseUrl(url)));
  }
});

const REMOTE_DB = 'postgresql://admin:p4ss-fict@db.remoto.example:5432/prod';
const file = (text, label = 'backend/.env') => [{ label, text }];

describe('reading DATABASE_URL declarations from a .env text', () => {
  it('reads plain, quoted, exported, spaced and commented-after values', () => {
    for (const line of [
      `DATABASE_URL=${LOCAL_DB}`,
      `DATABASE_URL="${LOCAL_DB}"`,
      `DATABASE_URL='${LOCAL_DB}'`,
      `export DATABASE_URL=${LOCAL_DB} # dev`,
      `  DATABASE_URL = ${LOCAL_DB}`,
      `\tDATABASE_URL=${LOCAL_DB}`,
    ]) {
      assert.deepEqual(
        readDeclarations(`NODE_ENV=development\n${line}\nPORT=3000\n`),
        [LOCAL_DB],
        line,
      );
    }
  });

  it('handles CRLF line endings and a leading BOM (files saved on Windows)', () => {
    assert.deepEqual(readDeclarations(`PORT=1\r\nDATABASE_URL=${LOCAL_DB}\r\nX=2\r\n`), [LOCAL_DB]);
    assert.deepEqual(readDeclarations(`﻿DATABASE_URL=${LOCAL_DB}\r\n`), [LOCAL_DB]);
  });

  it('ignores commented lines and similar names', () => {
    const text = `# DATABASE_URL=${REMOTE_DB}\nSHADOW_DATABASE_URL=${REMOTE_DB}\nDATABASE_URL_X=1\n`;
    assert.deepEqual(readDeclarations(text), []);
  });

  it('returns every declaration, in order', () => {
    assert.deepEqual(readDeclarations('DATABASE_URL=a\nDATABASE_URL=b\n'), ['a', 'b']);
  });
});

describe('where the backend gets DATABASE_URL (same precedence as dotenv)', () => {
  it('a process variable wins over the file, so the file is not even consulted', () => {
    const c = collectDatabaseUrls({ DATABASE_URL: LOCAL_DB }, file(`DATABASE_URL=${REMOTE_DB}\n`));
    assert.deepEqual(c.declarations, [
      { value: LOCAL_DB, source: 'variável de ambiente DATABASE_URL' },
    ]);
    assert.deepEqual(c.problems, []);
  });

  it('an EMPTY process variable still wins (dotenv never overwrites an existing key)', () => {
    const c = collectDatabaseUrls({ DATABASE_URL: '' }, file(`DATABASE_URL=${LOCAL_DB}\n`));
    assert.deepEqual(
      c.declarations.map((d) => d.value),
      [''],
    );
  });

  it('without a process variable, the file is used', () => {
    const c = collectDatabaseUrls({}, file(`DATABASE_URL=${LOCAL_DB}\n`));
    assert.deepEqual(c.declarations, [{ value: LOCAL_DB, source: 'backend/.env' }]);
  });

  it('a file that does not exist is skipped', () => {
    assert.deepEqual(collectDatabaseUrls({}, file(undefined)), { declarations: [], problems: [] });
    assert.deepEqual(collectDatabaseUrls({}, []), { declarations: [], problems: [] });
  });

  it('flags a file that declares it twice, whatever the values', () => {
    const c = collectDatabaseUrls({}, file(`DATABASE_URL=${LOCAL_DB}\nDATABASE_URL=${LOCAL_DB}\n`));
    assert.equal(c.problems.length, 1);
    assert.match(c.problems[0], /2 vezes/);
  });
});

describe('assertSafeToSeed', () => {
  const ok = {
    apiUrl: 'http://localhost:3000/api/v1',
    nodeEnv: undefined,
    env: { DATABASE_URL: LOCAL_DB },
    envFiles: [],
  };
  const withFile = (text) => ({ ...ok, env: {}, envFiles: file(text) });

  it('passes with a local DATABASE_URL, and says where it was read from', () => {
    assert.match(assertSafeToSeed(ok).databaseSource, /DATABASE_URL/);
    assert.equal(
      assertSafeToSeed(withFile(`DATABASE_URL=${LOCAL_DB}\n`)).databaseSource,
      'backend/.env',
    );
  });

  it('refuses a single remote declaration in the file', () => {
    assert.throws(() => assertSafeToSeed(withFile(`DATABASE_URL=${REMOTE_DB}\n`)), SeedRefusal);
  });

  it('refuses two declarations, local first and remote last (the one dotenv uses)', () => {
    assert.throws(
      () => assertSafeToSeed(withFile(`DATABASE_URL=${LOCAL_DB}\nDATABASE_URL=${REMOTE_DB}\n`)),
      SeedRefusal,
    );
  });

  it('refuses two declarations, remote first and local last', () => {
    assert.throws(
      () => assertSafeToSeed(withFile(`DATABASE_URL=${REMOTE_DB}\nDATABASE_URL=${LOCAL_DB}\n`)),
      SeedRefusal,
    );
  });

  it('refuses two local declarations too: the file is ambiguous', () => {
    try {
      assertSafeToSeed(withFile(`DATABASE_URL=${LOCAL_DB}\nDATABASE_URL=${LOCAL_DB}\n`));
      assert.fail('should refuse');
    } catch (e) {
      assert.ok(e instanceof SeedRefusal);
      assert.match(e.message, /2 vezes/);
    }
  });

  it('follows the process variable, like the application: a local variable beats a remote file', () => {
    const input = {
      ...ok,
      env: { DATABASE_URL: LOCAL_DB },
      envFiles: file(`DATABASE_URL=${REMOTE_DB}\n`),
    };
    assert.doesNotThrow(() => assertSafeToSeed(input));
  });

  it('follows the process variable, like the application: a remote variable beats a local file', () => {
    const input = {
      ...ok,
      env: { DATABASE_URL: REMOTE_DB },
      envFiles: file(`DATABASE_URL=${LOCAL_DB}\n`),
    };
    assert.throws(() => assertSafeToSeed(input), SeedRefusal);
  });

  it('refuses when nothing is found, instead of guessing', () => {
    assert.throws(() => assertSafeToSeed({ ...ok, env: {}, envFiles: [] }), /DATABASE_URL/);
    assert.throws(() => assertSafeToSeed(withFile('PORT=3000\n')), /DATABASE_URL/);
    assert.throws(
      () => assertSafeToSeed({ ...ok, env: {}, envFiles: file(undefined) }),
      /DATABASE_URL/,
    );
  });

  it('fails safe on invalid values, from the environment and from the file', () => {
    const invalid = [
      '',
      '   ',
      'not a url',
      'localhost',
      'mysql://u@localhost/db',
      'postgresql://localhost:5432,evil.example:5432/db',
      'postgresql:///db',
      'postgresql://u@localhost/db?host=evil.example',
    ];
    for (const value of invalid) {
      const label = JSON.stringify(value);
      assert.throws(
        () => assertSafeToSeed({ ...ok, env: { DATABASE_URL: value } }),
        SeedRefusal,
        label,
      );
      assert.throws(
        () => assertSafeToSeed(withFile(`DATABASE_URL=${value}\n`)),
        SeedRefusal,
        `file ${label}`,
      );
    }
  });

  it('refuses a local API in front of an external database: localhost is not enough', () => {
    assert.throws(() => assertSafeToSeed({ ...ok, env: { DATABASE_URL: REMOTE_DB } }), SeedRefusal);
  });

  it('refuses an external API even with a local database', () => {
    assert.throws(
      () => assertSafeToSeed({ ...ok, apiUrl: 'https://api.example.com/v1' }),
      SeedRefusal,
    );
  });

  it('refuses production in any spelling', () => {
    for (const nodeEnv of ['production', 'Production', 'PRODUCTION']) {
      assert.throws(() => assertSafeToSeed({ ...ok, nodeEnv }), /production/);
    }
  });

  it('lists every problem at once', () => {
    try {
      assertSafeToSeed({
        apiUrl: 'https://x.example.com',
        nodeEnv: 'production',
        env: {},
        envFiles: [],
      });
      assert.fail('should refuse');
    } catch (e) {
      assert.ok(e instanceof SeedRefusal);
      assert.equal(e.problems.length, 3);
    }
  });

  it('never puts passwords, full URLs or host names in a refusal', () => {
    const cases = [
      { ...ok, env: { DATABASE_URL: REMOTE_DB } },
      {
        ...ok,
        env: { DATABASE_URL: 'postgresql://admin:p4ss-fict@localhost:5432,evil.example:5432/app' },
      },
      withFile(`DATABASE_URL=${LOCAL_DB}\nDATABASE_URL=${REMOTE_DB}\n`),
      withFile(`DATABASE_URL=${REMOTE_DB}\nDATABASE_URL=${REMOTE_DB}\n`),
      { ...ok, apiUrl: 'https://user-fict:senha-fict@api.interna.example/v1' },
    ];
    const leaks = [
      'p4ss-fict',
      'user-fict',
      'senha-fict',
      'db.remoto.example',
      'evil.example',
      'api.interna.example',
      'postgresql://',
      'https://',
    ];
    for (const input of cases) {
      let message = '';
      try {
        assertSafeToSeed(input);
      } catch (e) {
        message = e.message;
      }
      assert.notEqual(message, '');
      for (const leak of leaks) assert.ok(!message.includes(leak), `message leaked ${leak}`);
    }
  });
});

describe('KEY: value syntax (accepted by dotenv) is handled like KEY=value', () => {
  const REMOTE = 'postgresql://admin:p4ss-fict@db.remoto.example:5432/prod';
  const check = (text, env = {}) =>
    assertSafeToSeed({
      apiUrl: 'http://localhost:3000/api/v1',
      nodeEnv: undefined,
      env,
      envFiles: [{ label: 'backend/.env', text }],
    });

  it('1. a local declaration with = is accepted', () => {
    assert.equal(check(`DATABASE_URL=${LOCAL_DB}\n`).databaseSource, 'backend/.env');
  });

  it('2. a remote declaration with = is refused', () => {
    assert.throws(() => check(`DATABASE_URL=${REMOTE}\n`), SeedRefusal);
  });

  it('3. a local declaration with : is read as dotenv reads it, and accepted', () => {
    assert.deepEqual(readDeclarations(`DATABASE_URL: ${LOCAL_DB}\n`), [LOCAL_DB]);
    assert.equal(dotenv.parse(`DATABASE_URL: ${LOCAL_DB}\n`).DATABASE_URL, LOCAL_DB);
    assert.equal(check(`DATABASE_URL: ${LOCAL_DB}\n`).databaseSource, 'backend/.env');
  });

  it('4. a remote declaration with : is refused', () => {
    assert.throws(() => check(`DATABASE_URL: ${REMOTE}\n`), SeedRefusal);
  });

  it('5. local with = followed by remote with : is refused (the file dotenv resolves to remote)', () => {
    const text = `DATABASE_URL=${LOCAL_DB}\nDATABASE_URL: ${REMOTE}\n`;
    assert.equal(new URL(dotenv.parse(text).DATABASE_URL).hostname, 'db.remoto.example');
    assert.throws(() => check(text), SeedRefusal);
  });

  it('6. remote with : followed by local with = is refused', () => {
    const text = `DATABASE_URL: ${REMOTE}\nDATABASE_URL=${LOCAL_DB}\n`;
    assert.throws(() => check(text), SeedRefusal);
  });

  it('7. two declarations with : are refused, whatever the values', () => {
    for (const text of [
      `DATABASE_URL: ${LOCAL_DB}\nDATABASE_URL: ${LOCAL_DB}\n`,
      `DATABASE_URL: ${LOCAL_DB}\nDATABASE_URL: ${REMOTE}\n`,
      `DATABASE_URL: ${REMOTE}\nDATABASE_URL: ${LOCAL_DB}\n`,
    ]) {
      assert.deepEqual(readDeclarations(text).length, 2);
      assert.throws(() => check(text), /2 vezes/);
    }
  });

  it('8. a process variable keeps the precedence dotenv gives it, whatever the file says', () => {
    const remoteFile = `DATABASE_URL=${LOCAL_DB}\nDATABASE_URL: ${REMOTE}\n`;
    assert.doesNotThrow(() => check(remoteFile, { DATABASE_URL: LOCAL_DB }));
    assert.throws(
      () => check(`DATABASE_URL: ${LOCAL_DB}\n`, { DATABASE_URL: REMOTE }),
      SeedRefusal,
    );
    // and the real dotenv agrees: an existing variable is never overwritten, even an empty one
    const target = { DATABASE_URL: '' };
    dotenv.populate(target, dotenv.parse(`DATABASE_URL: ${REMOTE}\n`));
    assert.equal(target.DATABASE_URL, '');
    assert.throws(() => check(`DATABASE_URL: ${LOCAL_DB}\n`, { DATABASE_URL: '' }), SeedRefusal);
  });

  it('9. no refusal reveals credentials, hosts or URLs', () => {
    const texts = [
      `DATABASE_URL: ${REMOTE}\n`,
      `DATABASE_URL=${LOCAL_DB}\nDATABASE_URL: ${REMOTE}\n`,
      `DATABASE_URL: ${REMOTE}\nDATABASE_URL=${LOCAL_DB}\n`,
      `DATABASE_URL: ${REMOTE}\nDATABASE_URL: ${REMOTE}\n`,
      `DATABASE_URL=\${REMOTE_URL}\n`,
    ];
    for (const text of texts) {
      let message = '';
      try {
        check(text);
      } catch (e) {
        message = e.message;
      }
      assert.notEqual(message, '', text);
      for (const leak of [
        'p4ss-fict',
        'admin',
        'db.remoto.example',
        'postgresql://',
        'REMOTE_URL',
      ]) {
        assert.ok(!message.includes(leak), `message leaked ${leak}`);
      }
    }
  });

  it('refuses a mention of the key it cannot read as a declaration (drift backstop)', () => {
    assert.throws(
      () => check(`DATABASE_URL=${LOCAL_DB}\nOTHER=\${DATABASE_URL}\n`),
      /não consegui ler/,
    );
    // comments and look-alike names are not mentions
    assert.doesNotThrow(() =>
      check(`# DATABASE_URL=${REMOTE}\nSHADOW_DATABASE_URL=${REMOTE}\nDATABASE_URL=${LOCAL_DB}\n`),
    );
  });
});

describe('the guard reads .env files exactly like the installed dotenv', () => {
  const LOCAL = LOCAL_DB;
  const REMOTE = 'postgresql://u:p@db.remoto.example:5432/prod';
  const forms = [
    (v) => `DATABASE_URL=${v}`,
    (v) => `DATABASE_URL: ${v}`,
    (v) => `DATABASE_URL:   ${v}`,
    (v) => `DATABASE_URL:\t${v}`,
    (v) => `DATABASE_URL = ${v}`,
    (v) => `export DATABASE_URL=${v}`,
    (v) => `export DATABASE_URL: ${v}`,
    (v) => `DATABASE_URL="${v}"`,
    (v) => `DATABASE_URL: "${v}"`,
    (v) => `DATABASE_URL='${v}'`,
    (v) => `DATABASE_URL=\`${v}\``,
    (v) => `  DATABASE_URL=${v} # note`,
    (v) => `DATABASE_URL=${v}#no-space-comment`,
    (v) => `\tDATABASE_URL=${v}`,
  ];
  const lines = forms.flatMap((form) => [form(LOCAL), form(REMOTE)]);

  function* corpus() {
    for (const eol of ['\n', '\r\n']) {
      for (const a of lines) {
        yield a + eol;
        for (const b of lines) {
          yield a + eol + b + eol;
          for (const c of lines) yield `PORT=3000${eol}${a}${eol}${b}${eol}${c}${eol}`;
        }
      }
    }
  }

  it('the dotenv compared here is the one declared in package.json and the one @nestjs/config loads', () => {
    const require = createRequire(import.meta.url);
    const declared = require('../package.json').devDependencies.dotenv;
    // Pinned exactly on purpose: the grammar copied into the guard is that of this version.
    assert.match(declared, /^\d+\.\d+\.\d+$/, 'dotenv must be declared with an exact version');
    assert.equal(require('dotenv/package.json').version, declared);
    assert.equal(typeof dotenv.parse, 'function');
    // @nestjs/config resolves 'dotenv' to the very same copy this test imports.
    const nestRequire = createRequire(require.resolve('@nestjs/config'));
    assert.equal(nestRequire.resolve('dotenv'), require.resolve('dotenv'));
    assert.equal(
      require('@nestjs/config/package.json').dependencies.dotenv,
      declared,
      '@nestjs/config and package.json must agree on the dotenv version',
    );
  });

  it('reads the same value dotenv ends up with, in every generated file', () => {
    let checked = 0;
    for (const text of corpus()) {
      const real = dotenv.parse(text).DATABASE_URL;
      const mine = readDeclarations(text);
      assert.equal(mine.at(-1), real, JSON.stringify(text));
      checked++;
    }
    assert.ok(checked > 10000, `only ${checked} files compared`);
  });

  it('never accepts a file whose real dotenv value is not local, and only accepts what dotenv reads the same', () => {
    let accepted = 0;
    let refused = 0;
    for (const text of corpus()) {
      const real = dotenv.parse(text).DATABASE_URL;
      let verdict = 'refused';
      try {
        assertSafeToSeed({
          apiUrl: 'http://localhost:3000/api/v1',
          nodeEnv: undefined,
          env: {},
          envFiles: [{ label: 'backend/.env', text }],
        });
        verdict = 'accepted';
      } catch {
        // refused
      }
      if (verdict === 'accepted') {
        accepted++;
        const mine = readDeclarations(text);
        assert.equal(
          mine.length,
          1,
          `accepted a file with ${mine.length} declarations: ${JSON.stringify(text)}`,
        );
        assert.equal(mine[0], real, JSON.stringify(text));
        assert.equal(
          assessDatabaseUrl(real),
          null,
          `accepted a non-local value: ${JSON.stringify(text)}`,
        );
      } else {
        refused++;
      }
    }
    // Only the files with exactly one LOCAL declaration (every form, both line endings) pass.
    assert.equal(accepted, forms.length * 2);
    assert.ok(refused > 40000, `refused ${refused}`);
  });

  it('accepts every single local declaration in any form dotenv accepts', () => {
    for (const form of forms) {
      const text = form(LOCAL) + '\n';
      assert.equal(dotenv.parse(text).DATABASE_URL, LOCAL, text);
      assert.doesNotThrow(
        () =>
          assertSafeToSeed({
            apiUrl: 'http://localhost:3000/api/v1',
            nodeEnv: undefined,
            env: {},
            envFiles: [{ label: 'backend/.env', text }],
          }),
        text,
      );
    }
  });
});
