import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('accepts valid config and coerces PORT', () => {
    const env = validateEnv({ NODE_ENV: 'test', PORT: '4000', DATABASE_URL: 'postgresql://x' });
    expect(env.PORT).toBe(4000);
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => validateEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('rejects unknown NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'nope', DATABASE_URL: 'x' })).toThrow(/NODE_ENV/);
  });
});
