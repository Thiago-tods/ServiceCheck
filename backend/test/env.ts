import { createHash } from 'crypto';

// Defaults for local runs. CI overrides DATABASE_URL via the environment.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??=
  'postgresql://postgres@localhost:54329/servicecheck_test?schema=public';
// The secret policy also applies when NODE_ENV=test, so this must be a valid secret: 64 hex
// characters (256 bits). It is derived, not a literal, and only signs throwaway test tokens.
process.env.JWT_ACCESS_SECRET ??= createHash('sha256')
  .update('servicecheck-e2e-jwt-secret')
  .digest('hex');
process.env.RATE_LIMIT_ENABLED ??= 'false';
process.env.JOBS_WORKER_ENABLED ??= 'false';
process.env.STORAGE_DRIVER ??= 'local';
process.env.STORAGE_LOCAL_DIR ??= './storage-test';
