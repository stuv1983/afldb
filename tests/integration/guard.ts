/**
 * Connection guard for tests that need a real database.
 *
 * Imported FIRST by every integration test file, before anything that
 * reaches src/db/client.ts, so a missing or wrong target fails with a
 * sentence rather than a connection error thirty seconds later.
 *
 * tests/setup.ts has already checked that the URL, if set, names a _test
 * database. This adds the requirement that it is set at all — which is
 * true of integration tests and deliberately not of the unit tests. It
 * also opens one connection before the test module is evaluated, so an
 * unreachable or misconfigured endpoint cannot cascade through its tests.
 */
import postgres from 'postgres';

import { validateImportRoleParityDsnTargets } from './import-role-parity';

const testUrl = process.env.AFLDB_TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    'AFLDB_TEST_DATABASE_URL must be set to run integration tests. '
    + 'Unit tests run without it; these do not.',
  );
}

if (process.env.AFLDB_TEST_IMPORT_DATABASE_URL) {
  validateImportRoleParityDsnTargets(
    testUrl,
    process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
  );
}

const target = new URL(testUrl);
const host = target.hostname || 'localhost';
const port = target.port || '5432';
const database = target.pathname.replace(/^\//, '');
const preflightSql = postgres(testUrl, {
  connect_timeout: 5,
  max: 1,
});

let preflightFailed = false;
try {
  await preflightSql`SELECT 1`;
} catch {
  preflightFailed = true;
} finally {
  try {
    await preflightSql.end({ timeout: 5 });
  } catch {
    preflightFailed = true;
  }
}

if (preflightFailed) {
  throw new Error(
    'Integration test database preflight failed '
    + `(host=${host}, port=${port}, database=${database}). `
    + 'Check AFLDB_TEST_DATABASE_URL and any required SSH tunnel.',
  );
}

export {};
