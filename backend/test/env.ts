// Defaults for local runs. CI overrides DATABASE_URL via the environment.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??=
  'postgresql://postgres@localhost:54329/servicecheck_test?schema=public';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-test-secret-test-secret-123456';
