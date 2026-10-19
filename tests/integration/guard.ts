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

import { ISOLATED_SERVER_FACTS_SQL, checkIsolatedTestDsn, checkIsolatedTestServer } from '@afldb/domain';

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

// AFLDB V2 Launch F: under tools/v2/isolated-pg.ts (AFLDB_V2_ISOLATED_PG=1) every integration file
// re-verifies, inside the test process, that the DSN is loopback on the isolated port and that the
// server is the marked isolated cluster and database. Independent of the runner's own check.
if (process.env.AFLDB_V2_ISOLATED_PG === '1') {
  const expectedPort = Number(process.env.AFLDB_V2_ISOLATED_PORT);
  const findings = checkIsolatedTestDsn(testUrl, expectedPort);
  if (findings.length === 0) {
    const factsSql = postgres(testUrl, { connect_timeout: 5, max: 1, onnotice: () => {} });
    try {
      const [row] = await factsSql.unsafe(ISOLATED_SERVER_FACTS_SQL);
      findings.push(...checkIsolatedTestServer(database, {
        clusterName: row?.cluster_name ?? null,
        databaseComment: row?.database_comment ?? null,
        currentDatabase: row?.current_database ?? null,
      }));
    } finally {
      await factsSql.end({ timeout: 5 });
    }
  }
  if (findings.length > 0) {
    throw new Error(
      'Isolated test target refused: '
      + findings.map((f) => `${f.check} (${f.detail})`).join('; '),
    );
  }
}

export {};

/** Repeat all isolated proofs on the exact connection a destructive fixture will use. */
export async function verifyIsolatedIntegrationDatabase(connection: postgres.Sql): Promise<string> {
  const findings = checkIsolatedTestDsn(testUrl!, Number(process.env.AFLDB_V2_ISOLATED_PORT));
  if (process.env.AFLDB_V2_ISOLATED_PG !== '1') findings.push({ check: 'runner', detail: 'isolated runner required' });
  if (!findings.length) {
    const [facts] = await connection.unsafe(ISOLATED_SERVER_FACTS_SQL);
    findings.push(...checkIsolatedTestServer(database, {
      clusterName: facts?.cluster_name ?? null, databaseComment: facts?.database_comment ?? null,
      currentDatabase: facts?.current_database ?? null,
    }));
  }
  if (findings.length) throw new Error(`Isolated integration target refused: ${findings.map((f) => f.check).join(', ')}`);
  return database;
}
