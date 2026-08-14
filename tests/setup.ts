/**
 * Test setup.
 *
 * Integration tests run against `afldb_test` and nothing else. The
 * DATABASE_URL used by src/db/client.ts is redirected here so that a test
 * can never write to, or be misled by, another database.
 *
 * The guard is an allowlist, not a blocklist. Refusing only `afldb_dev`
 * left every other database — production included — acceptable to a suite
 * that issues real mutations.
 *
 * Unit tests (formatting, query-spec parsing) touch no database, so a
 * missing variable is not fatal here. tests/integration/guard.ts makes it
 * fatal for the tests that genuinely need a connection.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env without adding a dotenv dependency.
try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
  }
} catch {
  // .env is absent in CI; variables are expected to be set already.
}

const testUrl = process.env.AFLDB_TEST_DATABASE_URL;

if (testUrl) {
  let database: string;
  try {
    database = new URL(testUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('AFLDB_TEST_DATABASE_URL is not a valid connection URL.');
  }

  // The suite creates and deletes rows. Only a database whose name says it
  // exists to be thrown away may be pointed at.
  if (!/_test$/.test(database)) {
    throw new Error(
      `AFLDB_TEST_DATABASE_URL points at '${database}', which is not a _test `
      + 'database. Refusing to run: these tests mutate the database they '
      + 'connect to.',
    );
  }

  // Everything imported from src/db/client.ts now targets afldb_test.
  process.env.DATABASE_URL = testUrl;
}
