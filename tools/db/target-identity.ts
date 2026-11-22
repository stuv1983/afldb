// tools-db | Connected database identity guard for direct test-target migrate and privileges runners
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.

/**
 * AFLDB-ISSUE-374 — the database a direct `db:migrate:test`, `db:migrate:code-test`,
 * `db:privileges:test` or `db:privileges:code-test` run may change.
 *
 * Selecting a DSN variable by target name is not enough: a nonempty AFLDB_TEST_DATABASE_URL
 * that names (or, through a libpq `dbname=` parameter, reaches) another writable database used
 * to be migrated or granted on. Two independent checks now precede the first write:
 *
 *   1. the NAME the DSN gives must be a permitted name for the target, before any connection:
 *      `code-test` is exactly `code_test_db` (the AFLDB-ISSUE-146 contract, tools/db/rebuild-test.ts
 *      REBUILD_TARGETS); `test` is a plain-identifier `*_test` database (the suffix tests/setup.ts
 *      and src/db/test-process-guard.ts require), never one that looks like production;
 *   2. `current_database()` on the SAME connection that performs the DDL or grants must equal
 *      that name (`targetIdentityAssertionSql`), so a DSN whose connection lands elsewhere is
 *      refused by the server session itself.
 *
 * `dev` and `prod` are unchanged here: they have no name contract to enforce. Messages name the
 * variable and database only, never the DSN.
 */

export class TargetIdentityRefused extends Error {}

/** The explicit rehearsal database (AFLDB-ISSUE-146). */
export const CODE_TEST_DATABASE = 'code_test_db';

/** The RAISE marker the session assertion uses, so callers and tests can recognise it. */
export const TARGET_IDENTITY_MARKER = 'AFLDB-TARGET-IDENTITY';

const PLAIN_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/** The database a URL-form DSN names in its path, percent-decoded. */
export function dsnDatabaseName(variable: string, dsn: string): string {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new TargetIdentityRefused(`${variable} is not a valid connection URL. Nothing has been changed.`);
  }
  try {
    return decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    throw new TargetIdentityRefused(`${variable} names its database with invalid percent-encoding. Nothing has been changed.`);
  }
}

/**
 * The exact database the connection must report for `target`, or null for a target this guard
 * does not bind (`dev`, `prod`). Throws `TargetIdentityRefused` before any connection is made.
 */
export function expectedTargetDatabase(target: string, variable: string, dsn: string): string | null {
  if (target !== 'test' && target !== 'code-test') return null;
  const database = dsnDatabaseName(variable, dsn);
  if (!PLAIN_IDENTIFIER.test(database)) {
    throw new TargetIdentityRefused(
      `${variable} must name the ${target} database as a plain lower-case identifier; got '${database}'. `
      + 'Nothing has been changed.');
  }
  if (target === 'code-test') {
    if (database !== CODE_TEST_DATABASE) {
      throw new TargetIdentityRefused(
        `${variable} names '${database}', but the code-test target is exactly '${CODE_TEST_DATABASE}'. `
        + 'Nothing has been changed.');
    }
    return database;
  }
  if (!database.endsWith('_test') || /prod/i.test(database)) {
    throw new TargetIdentityRefused(
      `${variable} names '${database}', which is not a disposable *_test database. `
      + 'The test target never migrates or grants on another database. Nothing has been changed.');
  }
  return database;
}

/** Null when the connected database is the expected one, otherwise the refusal message. */
export function connectedDatabaseRefusal(expected: string, connected: string | null | undefined): string | null {
  if (connected === expected) return null;
  return `${TARGET_IDENTITY_MARKER} connected to database '${connected ?? '<unknown>'}', not '${expected}'. `
    + 'Nothing has been changed.';
}

/**
 * A statement that raises unless the session running it is connected to `database`. Run it
 * first on the connection that performs the work (and inside each write transaction), so the
 * check binds the connection that acts rather than the URL that was parsed.
 */
export function targetIdentityAssertionSql(database: string): string {
  if (!PLAIN_IDENTIFIER.test(database)) {
    throw new TargetIdentityRefused(`Refusing to assert identity for '${database}': not a plain identifier.`);
  }
  return `DO $afldb_target_identity$
BEGIN
  IF current_database() <> '${database}' THEN
    RAISE EXCEPTION '${TARGET_IDENTITY_MARKER} connected to database %, not ${database}. Nothing has been changed.', current_database();
  END IF;
END $afldb_target_identity$;`;
}
