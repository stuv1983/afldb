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

import { afterAll, expect } from 'vitest';

import {
  PER_FILE_AUDIT_ENV,
  PER_FILE_DB_ENV,
  applyTestDsnPolicy,
  auditPerFileResidue,
  createPerFileDatabase,
  dropPerFileDatabase,
  perFileAppliesTo,
  perFileModeOf,
  redirectEnvToDatabase,
} from '@afldb/testing';
import { validateImportRoleParityDsnTargets } from './integration/import-role-parity';
import { COMMITTING_SUITES } from './integration/leaked-fixtures';

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

// AFLDB-ISSUE-363 owner decision (1): opt-in per-file disposable databases (AFLDB_TEST_PER_FILE_DB=1|all). Off by
// default and then nothing below runs. When on, an integration file gets a fresh copy of the base database
// (CREATE DATABASE ... TEMPLATE <base>) BEFORE anything is imported, every DSN variable naming the base is redirected
// to the copy, and the copy is dropped when the file ends (afterAll registered here runs after the file's own
// afterAll hooks). Every refusal (non-_test base, port 5432, malformed prefix, dropping a name this process did not
// generate) lives in packages/testing/src/per-file-db-policy.ts and is unit-tested in tests/dsn-policy.test.ts.
const perFileMode = perFileModeOf(process.env[PER_FILE_DB_ENV]);
const perFileTestPath = expect.getState().testPath;
if (perFileAppliesTo(perFileMode, perFileTestPath, COMMITTING_SUITES)) {
  const baseDsn = process.env.AFLDB_TEST_DATABASE_URL as string;
  const database = await createPerFileDatabase({ env: process.env, baseDsn });
  redirectEnvToDatabase(process.env, baseDsn, database.name);
  const auditPath = process.env[PER_FILE_AUDIT_ENV];
  afterAll(async () => {
    try {
      if (auditPath) await auditPerFileResidue(database, { env: process.env, baseDsn, testPath: perFileTestPath as string, auditPath });
    } finally {
      await dropPerFileDatabase(database, { env: process.env, baseDsn });
    }
  });
}

const testUrl = process.env.AFLDB_TEST_DATABASE_URL;
const restrictedImportTestUrl = process.env.AFLDB_TEST_IMPORT_DATABASE_URL;
if (testUrl && restrictedImportTestUrl) {
  validateImportRoleParityDsnTargets(testUrl, restrictedImportTestUrl);
}
