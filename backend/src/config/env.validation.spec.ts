import { validateEnv } from './env.validation';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
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

  it('rejects unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'nope' })).toThrow(/NODE_ENV/);
  });
});
