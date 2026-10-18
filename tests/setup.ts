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

import { applyTestDsnPolicy } from '@afldb/testing';
import { validateImportRoleParityDsnTargets } from './integration/import-role-parity';

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

// AFLDB V2 plan D5 (packages/testing/src/dsn-policy.ts): with a _test DSN, DATABASE_URL is redirected to it
// and any other non-_test DSN variable is removed; with none, every DSN variable and the libpq
// connection variables are removed (never a throw), so no test, imported module or spawned
// child can reach a non-test database. The pre-V2 refusals throw exactly as before.
applyTestDsnPolicy(process.env);

const testUrl = process.env.AFLDB_TEST_DATABASE_URL;
const restrictedImportTestUrl = process.env.AFLDB_TEST_IMPORT_DATABASE_URL;
if (testUrl && restrictedImportTestUrl) {
  validateImportRoleParityDsnTargets(testUrl, restrictedImportTestUrl);
}
