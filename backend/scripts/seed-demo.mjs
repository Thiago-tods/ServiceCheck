#!/usr/bin/env node
/**
 * Demo data for LOCAL DEVELOPMENT ONLY.
 *
 * Creates, through the API of a backend running on your own machine, a fictitious company, an
 * Owner and a technician, a client with an address, a service with a checklist and two scheduled
 * orders. The accounts use a public password (see seed-core.mjs), so this must never run against a
 * server other people can reach.
 *
 * Before touching anything it checks that BOTH the API and the backend's database are local
 * (seed-guards.mjs). If it cannot be sure, it stops. It never deletes or overwrites anything and
 * can be run again: it only creates what is missing, which also completes an interrupted run.
 *
 *   npm run seed:demo
 *   API_URL=http://localhost:3100/api/v1 npm run seed:demo
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSummary, runSeed, SeedError } from './seed-core.mjs';
import { makeHttpCall } from './seed-http.mjs';
import { assertSafeToSeed, SeedRefusal } from './seed-guards.mjs';

const API_URL = (process.env.API_URL ?? 'http://localhost:3000/api/v1').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The .env files the backend reads. Checked in the installed packages: the Prisma client loads only
 * backend/.env (its schemaEnvPath) and Nest reads .env from the folder the backend runs in.
 */
async function readEnvFiles() {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  try {
    return [{ label: 'backend/.env', text: await readFile(file, 'utf8') }];
  } catch (e) {
    if (e?.code === 'ENOENT') return [{ label: 'backend/.env', text: undefined }];
    throw e;
  }
}

async function main() {
  const { databaseSource } = assertSafeToSeed({
    apiUrl: API_URL,
    nodeEnv: process.env.NODE_ENV,
    env: process.env,
    envFiles: await readEnvFiles(),
  });

  const { created } = await runSeed(makeHttpCall(API_URL, { timeoutMs: REQUEST_TIMEOUT_MS }));

  console.log(formatSummary({ created, databaseSource }));
}

try {
  await main();
} catch (e) {
  if (e instanceof SeedRefusal || e instanceof SeedError) {
    console.error(`\n${e.message}\n`);
    if (e instanceof SeedError) {
      console.error(
        'Nada foi apagado. Corrija o problema e rode de novo: o seed completa o que faltar.\n',
      );
    }
    process.exit(1);
  }
  throw e;
}
