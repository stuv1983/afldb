/**
 * Connection guard for tests that need a real database.
 *
 * Imported FIRST by every integration test file, before anything that
 * reaches src/db/client.ts, so a missing or wrong target fails with a
 * sentence rather than a connection error thirty seconds later.
 *
 * tests/setup.ts has already checked that the URL, if set, names a _test
 * database. This adds the requirement that it is set at all — which is
 * true of integration tests and deliberately not of the unit tests.
 */
import { validateImportRoleParityDsnTargets } from './import-role-parity';

if (!process.env.AFLDB_TEST_DATABASE_URL) {
  throw new Error(
    'AFLDB_TEST_DATABASE_URL must be set to run integration tests. '
    + 'Unit tests run without it; these do not.',
  );
}

if (process.env.AFLDB_TEST_IMPORT_DATABASE_URL) {
  validateImportRoleParityDsnTargets(
    process.env.AFLDB_TEST_DATABASE_URL,
    process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
  );
}

export {};
