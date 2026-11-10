import { execSync } from 'child_process';

/** Applies all migrations to the real PostgreSQL test database before the suites run. */
export default function globalSetup(): void {
  const url =
    process.env.DATABASE_URL ??
    'postgresql://postgres@localhost:54329/servicecheck_test?schema=public';
  execSync('npx prisma migrate deploy', {
    cwd: __dirname + '/..',
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
