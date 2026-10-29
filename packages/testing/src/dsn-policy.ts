/**
 * @afldb/testing — AFLDB V2 plan D5 (review resolutions R-001..R-004): the test-process DSN policy.
 *
 * `tests/setup.ts` is the global vitest setup file, so whatever it leaves in `process.env` is
 * what every test file, every module it imports and every child process it spawns can reach.
 * This module is the pure policy that setup applies; it is factored out so each branch is
 * unit-tested on plain env objects (tests/dsn-policy.test.ts) rather than only on the one
 * environment a given workstation happens to have.
 *
 * The rule is an allowlist on the DATABASE NAME SUFFIX (`_test`), not a host heuristic:
 *
 *   - no `AFLDB_TEST_DATABASE_URL`  → strip every `*DATABASE_URL*` variable and the libpq
 *     connection variables, and do NOT throw (unit tests run without a database);
 *   - a test DSN naming a `_test` database → `DATABASE_URL` is redirected to it (never deleted),
 *     and every other set `*DATABASE_URL*` variable whose database is not `_test` is removed;
 *   - a test DSN naming anything else (`afldb_dev`, `afldb_prod`, ...) or not a URL → throw.
 *
 * The existing refusal of `AFLDB_TEST_IMPORT_DATABASE_URL` without a test DSN is evaluated
 * BEFORE the strip, so stripping can never silence it.
 *
 * LIMITATION (recorded in docs/v2/known-gaps.md): the present-DSN branch is unit-tested here
 * but unverified on a live database, because none exists on the V2 workstation.
 */

export type DsnEnv = Record<string, string | undefined>;

export const TEST_DSN = 'AFLDB_TEST_DATABASE_URL';
export const TEST_IMPORT_DSN = 'AFLDB_TEST_IMPORT_DATABASE_URL';
export const APP_DSN = 'DATABASE_URL';

/**
 * libpq / postgres.js connection defaults. postgres.js fills a missing host, port, database,
 * user or password from these, so with no test database they are removed too.
 */
export const LIBPQ_CONNECTION_VARIABLES: readonly string[] = [
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGPASSFILE',
  'PGSERVICE',
  'PGSERVICEFILE',
];

/** True for any variable that by name carries a PostgreSQL connection string. */
export function isDsnVariable(name: string): boolean {
  return /DATABASE_URL/.test(name);
}

/** The database name a connection URL selects. Throws on a value that is not a URL. */
export function databaseNameOf(dsn: string): string {
  return new URL(dsn).pathname.replace(/^\//, '');
}

/** True when the URL parses and names a database whose name ends in `_test`. */
export function namesTestDatabase(dsn: string): boolean {
  try {
    return /_test$/.test(databaseNameOf(dsn));
  } catch {
    return false;
  }
}

export interface DsnPolicyResult {
  mode: 'no-test-database' | 'test-database';
  /** Variables removed from the env, in key order. Names only — never values. */
  removed: string[];
}

/**
 * Apply the policy to `env` IN PLACE (setup passes `process.env`) and report what it did.
 * Throws with the pre-V2 messages for the two existing refusals.
 */
export function applyTestDsnPolicy(env: DsnEnv): DsnPolicyResult {
  const testUrl = env[TEST_DSN];
  const removed: string[] = [];

  if (testUrl) {
    let database: string;
    try {
      database = databaseNameOf(testUrl);
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

    // Everything imported from src/db/client.ts now targets the test database.
    env[APP_DSN] = testUrl;

    // Any other DSN-bearing variable (an operator .env's AFLDB_IMPORT_DATABASE_URL or
    // AFLDB_AUTH_DATABASE_URL, say) that does not name a _test database is removed rather than
    // left for a code path that reads it directly. AFLDB_TEST_IMPORT_DATABASE_URL keeps its
    // own, stricter validation in setup (validateImportRoleParityDsnTargets).
    for (const name of Object.keys(env)) {
      if (name === TEST_DSN || name === APP_DSN || name === TEST_IMPORT_DSN) continue;
      if (!isDsnVariable(name)) continue;
      const value = env[name];
      if (value === undefined || value === '') continue;
      if (!namesTestDatabase(value)) {
        delete env[name];
        removed.push(name);
      }
    }
    return { mode: 'test-database', removed };
  }

  // Evaluated before the strip below, so stripping can never silence it.
  if (env[TEST_IMPORT_DSN]) {
    throw new Error(
      'AFLDB_TEST_DATABASE_URL must be set when AFLDB_TEST_IMPORT_DATABASE_URL is configured.',
    );
  }

  for (const name of Object.keys(env)) {
    if (isDsnVariable(name) || LIBPQ_CONNECTION_VARIABLES.includes(name)) {
      delete env[name];
      removed.push(name);
    }
  }
  return { mode: 'no-test-database', removed };
}
