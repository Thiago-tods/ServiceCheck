import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canonicalNodeEnv, checkJwtSecret, validateEnv } from './env.validation';

/**
 * Test secrets are derived from fixed labels instead of being drawn at random: the same values on
 * every run, so a failure always means the policy changed and never bad luck. Nothing here is a
 * usable key, and the "fixed vectors" tests below prove each derived value is accepted.
 */
function det(label: string, bytes: number): Buffer {
  const parts: Buffer[] = [];
  let length = 0;
  for (let i = 0; length < bytes; i++) {
    const part = createHash('sha256').update(`${label}:${i}`).digest();
    parts.push(part);
    length += part.length;
  }
  return Buffer.concat(parts).subarray(0, bytes);
}
const b64url = (bytes: number): string => det(`b64url-${bytes}`, bytes).toString('base64url');
const hex = (bytes: number): string => det(`hex-${bytes}`, bytes).toString('hex');
const std64 = (bytes: number): string => det(`base64-${bytes}`, bytes).toString('base64');

const VALID = b64url(48);

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: VALID,
};

const withEnv = (
  nodeEnv: string | undefined,
  secret: string,
  extra: Record<string, unknown> = {},
) => {
  const { NODE_ENV: _unused, ...rest } = base;
  void _unused;
  return {
    ...rest,
    ...(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }),
    JWT_ACCESS_SECRET: secret,
    ...extra,
  };
};
const prod = (secret: string, extra: Record<string, unknown> = {}) =>
  withEnv('production', secret, extra);

function exampleSecret(): string {
  const text = readFileSync(join(__dirname, '../../.env.example'), 'utf8');
  const match = /^JWT_ACCESS_SECRET=(.+)$/m.exec(text);
  if (!match) throw new Error('.env.example has no JWT_ACCESS_SECRET');
  return match[1].trim();
}

const quiet = <T>(fn: () => T): { result: T; warnings: string[] } => {
  const warn = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
  try {
    const result = fn();
    return { result, warnings: warn.mock.calls.map((c) => String(c[0])) };
  } finally {
    warn.mockRestore();
  }
};

describe('validateEnv', () => {
  it('accepts valid config, coerces numbers and applies defaults', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TTL_DAYS).toBe(30);
  });

  it('parses boolean flags from strings without treating "false" as true', () => {
    expect(validateEnv({ ...base, RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED).toBe(false);
    expect(validateEnv({ ...base, RATE_LIMIT_ENABLED: 'true' }).RATE_LIMIT_ENABLED).toBe(true);
    expect(validateEnv(base).RATE_LIMIT_ENABLED).toBe(true);
  });

  it('requires S3 settings only when the S3 driver is selected', () => {
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 'local' })).not.toThrow();
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});

describe('NODE_ENV handling', () => {
  it.each(['production', 'Production', 'PRODUCTION', '  production  '])(
    'treats %j as production, so the placeholder is refused',
    (value) => {
      expect(() => validateEnv(prod(exampleSecret(), { NODE_ENV: value }))).toThrow(/rejected/);
      expect(validateEnv(prod(VALID, { NODE_ENV: value })).NODE_ENV).toBe('production');
    },
  );

  it.each([
    ['Development', 'development'],
    ['DEVELOPMENT', 'development'],
    [' Test ', 'test'],
  ])('normalizes %j to %j', (value, expected) => {
    const { result } = quiet(() => validateEnv(withEnv(value, VALID)));
    expect(result.NODE_ENV).toBe(expected);
  });

  it.each(['prod', 'staging', 'nope', 'productionn'])('rejects the invalid value %j', (value) => {
    expect(() => validateEnv(withEnv(value, VALID))).toThrow(/NODE_ENV/);
  });

  it.each([undefined, '', '   '])(
    'a missing NODE_ENV (%j) applies the strict policy instead of accepting a placeholder',
    (value) => {
      let message = '';
      try {
        validateEnv(withEnv(value, exampleSecret()));
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/rejected \(placeholder\)/);
      expect(message).toMatch(/NODE_ENV is not set/);
      expect(() => validateEnv(withEnv(value, VALID))).not.toThrow();
    },
  );

  it('canonicalNodeEnv trims, lowercases and treats empty as unset', () => {
    expect(canonicalNodeEnv(' Production ')).toBe('production');
    expect(canonicalNodeEnv('')).toBeUndefined();
    expect(canonicalNodeEnv('  ')).toBeUndefined();
    expect(canonicalNodeEnv(undefined)).toBeUndefined();
    expect(canonicalNodeEnv(42)).toBeUndefined();
  });
});

describe('JWT secret policy by environment', () => {
  const placeholder = exampleSecret();
  const weakSecrets = {
    'the .env.example placeholder': placeholder,
    'a placeholder in capitals': 'CHANGE_ME_' + b64url(40),
    'a repeated character': 'x'.repeat(64),
    'a short value': 'short',
  };

  describe.each([['test'], ['TEST'], ['production'], ['Production']])('NODE_ENV=%s', (env) => {
    it.each(Object.entries(weakSecrets))('refuses %s', (_label, secret) => {
      expect(() => validateEnv(withEnv(env, secret))).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('accepts a valid secret', () => {
      expect(validateEnv(withEnv(env, VALID)).NODE_ENV).toBe(env.toLowerCase());
    });
  });

  describe('NODE_ENV=development (the only place that tolerates a weak secret)', () => {
    it('accepts the placeholder, with a warning that does not contain it', () => {
      const { warnings } = quiet(() => validateEnv(withEnv('development', placeholder)));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/placeholder/);
      expect(warnings[0]).not.toContain(placeholder);
    });

    it('accepts a valid secret without warning', () => {
      const { warnings } = quiet(() => validateEnv(withEnv('development', VALID)));
      expect(warnings).toHaveLength(0);
    });
  });

  it('applies to a missing NODE_ENV as well, which is not a way around the policy', () => {
    for (const secret of Object.values(weakSecrets)) {
      expect(() => validateEnv(withEnv(undefined, secret))).toThrow(/JWT_ACCESS_SECRET/);
    }
    expect(() => validateEnv(withEnv(undefined, VALID))).not.toThrow();
  });
});

describe('JWT secret policy', () => {
  describe('fixed vectors that are accepted', () => {
    it.each([
      ['base64url, 48 bytes (the documented generator)', b64url(48), 64],
      ['base64url, 32 bytes (43 characters, 256 bits)', b64url(32), 43],
      ['hex, 32 bytes (64 characters, 256 bits)', hex(32), 64],
      ['hex, 48 bytes', hex(48), 96],
      ['standard base64 with padding, 32 bytes', std64(32), 44],
      ['standard base64, 48 bytes', std64(48), 64],
    ])('%s', (_label, secret, length) => {
      expect(secret).toHaveLength(length);
      expect(checkJwtSecret(secret)).toBeNull();
      for (const env of ['production', 'test']) {
        expect(validateEnv(withEnv(env, secret)).NODE_ENV).toBe(env);
      }
    });
  });

  describe('rejects', () => {
    it('the placeholder in .env.example, so the two cannot drift apart', () => {
      expect(checkJwtSecret(exampleSecret())).toBe('placeholder');
      expect(() => validateEnv(prod(exampleSecret()))).toThrow(/placeholder/);
    });

    it.each([
      'change-me-change-me-change-me-change-me',
      'CHANGE_ME_' + b64url(40),
      'ChangeMe' + b64url(40),
      'replace me ' + b64url(40),
      'your_jwt_secret_goes_here_' + b64url(30),
      'please-generate-a-secret-' + b64url(30),
      b64url(30) + '-example',
    ])('the placeholder %#', (secret) => {
      expect(checkJwtSecret(secret)).toBe('placeholder');
    });

    it.each([
      'my-super-secret-key-for-jwt-signing-in-production-2024',
      'Password123' + b64url(40),
      'qwerty' + b64url(40),
    ])('the weak word %#', (secret) => {
      expect(checkJwtSecret(secret)).toBe('weak-word');
    });

    it.each([
      ['one repeated character', 'x'.repeat(64), 'few-character-classes'],
      ['a two-character pattern (valid hex, 2 distinct)', 'ab'.repeat(40), 'low-diversity'],
      ['few distinct characters across all classes', 'aB3-'.repeat(20), 'low-diversity'],
      ['a 17-character unit repeated', 'aB3dE6gH9jK2mN5pQ'.repeat(4), 'repetitive'],
      ['a 16-digit hex unit repeated', '3fa91c7e5b20d486'.repeat(4), 'repetitive'],
      ['a long base64 unit repeated', 'Qw3Rt5Yu7Io9Pa1Sd'.repeat(3), 'repetitive'],
      ['a run of equal characters', b64url(30) + 'AAAAAAAAAA' + b64url(10), 'repetitive'],
    ])('%s', (_label, secret, reason) => {
      expect(checkJwtSecret(secret)).toBe(reason);
    });

    it.each([
      ['the alphabet and digits in order', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP'],
      ['a decimal run inside hex', '0123456789' + hex(27)],
      ['a descending run', b64url(20) + 'zyxwvutsrq' + b64url(20)],
    ])('%s', (_label, secret) => {
      expect(checkJwtSecret(secret)).toBe('sequential');
    });

    it('a long passphrase with only lowercase letters and hyphens', () => {
      expect(checkJwtSecret('correct-horse-battery-staple-correct-horse-battery')).toBe(
        'few-character-classes',
      );
    });

    it.each([
      ['hex shorter than 256 bits', hex(24)],
      ['base64url shorter than 256 bits', b64url(24)],
      ['a 32-character alphanumeric value', b64url(24).replace(/[-_]/g, 'a')],
      ['one character short of 256 bits', b64url(32).slice(0, 42)],
    ])('%s', (_label, secret) => {
      expect(checkJwtSecret(secret)).toBe('too-short');
    });

    it.each([
      ['inner spaces', 'abc def ' + b64url(40)],
      ['punctuation outside base64', b64url(30) + '!@#$%^&*()' + b64url(10)],
      ['non-ASCII characters', 'senha-forte-çãõ-' + b64url(40)],
    ])('%s', (_label, secret) => {
      expect(checkJwtSecret(secret)).toBe('format');
    });

    it('still enforces the absolute minimum length', () => {
      expect(() => validateEnv(prod(b64url(16)))).toThrow(/JWT_ACCESS_SECRET/);
    });
  });

  describe('outer whitespace', () => {
    it('is ignored when judging the secret, and the value in use is not changed', () => {
      const padded = `  ${VALID}\t `;
      expect(checkJwtSecret(padded)).toBeNull();
      expect(validateEnv(prod(padded)).JWT_ACCESS_SECRET).toBe(padded);
    });

    it('does not hide a placeholder', () => {
      expect(checkJwtSecret(`   ${exampleSecret()}   `)).toBe('placeholder');
    });
  });

  describe('never exposes the secret', () => {
    it('in any rejection message, whatever the environment', () => {
      const secrets = [
        exampleSecret(),
        'x'.repeat(64),
        'correct-horse-battery-staple-correct-horse-battery',
        b64url(16),
        'abc def ' + b64url(40),
      ];
      for (const secret of secrets) {
        for (const env of ['production', 'test', undefined]) {
          let message = '';
          try {
            validateEnv(withEnv(env, secret));
          } catch (e) {
            message = (e as Error).message;
          }
          expect(message).not.toBe('');
          expect(message).not.toContain(secret);
        }
      }
    });
  });
});
