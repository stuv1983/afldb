/**
 * AFLDB V2 Stage 6 — the shadow-rehearsal target policy (pure).
 *
 * A shadow rehearsal (`docs/v2/shadow-rehearsal.md`) runs V2 against a RESTORED COPY in a database
 * created for that purpose. Every V2 helper that a rehearsal step runs (`tools/v2/shadow-guard.ts`,
 * the shadow capture tools) refuses a target that is not such a copy. The rule is a NAME rule,
 * stricter than the D5 test-DSN rule it builds on (`packages/testing/src/dsn-policy.ts`, ADR 0005:
 * a database is a test database only when its name ends in `_test`): a shadow database name must
 * match {@link SHADOW_DATABASE_NAME_PATTERN}, so it also ends in `_test` and every existing D5 and
 * promotion-checker refusal still treats it as a test database, while `afldb_test`,
 * `afldb_restore_test`, `afldb_dev`, `code_test_db` and production are refused by name.
 *
 * Nothing here reads the process environment, the file system or a database; callers pass the
 * environment in. Results carry variable NAMES and database NAMES only, never a connection string,
 * host, port, role or password.
 */

/** `afldb_v2_shadow_test`, `afldb_v2_shadow_20261020_test`, `afldb_v2_shadow_r2_test`, ... */
export const SHADOW_DATABASE_NAME_PATTERN = /^afldb_v2_shadow(?:_[a-z0-9]+)*_test$/;

/** Databases a shadow step must never touch, named so the refusal can say why. */
export const RESERVED_DATABASE_NAMES: Readonly<Record<string, string>> = {
  afldb: 'production',
  afldb_prod: 'production',
  afldb_dev: 'the development database',
  afldb_test: 'the shared integration-test database (mutating it needs the owner)',
  afldb_restore_test: 'the backup restore-verification database (its sha256 comment is promotion evidence)',
  code_test_db: 'the ISSUE-146 full-rebuild rehearsal database',
  postgres: 'the maintenance database',
  template0: 'a template database',
  template1: 'a template database',
};

/** libpq variables that can redirect a connection independently of a DSN. */
export const REDIRECTING_LIBPQ_VARIABLES: readonly string[] = ['PGSERVICE', 'PGSERVICEFILE', 'PGDATABASE'];

export type ShadowDsnVerdict =
  | { readonly ok: true; readonly database: string }
  | { readonly ok: false; readonly database: string | null; readonly reason: string };

/**
 * The database name of a `postgres://` or `postgresql://` URL, or null when the value is not such a
 * URL or names no database. The libpq keyword form (`host=... dbname=...`) is deliberately not
 * parsed: a shadow step refuses what it cannot read.
 */
export function databaseNameFromDsn(dsn: string): string | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
  const fromQuery = url.searchParams.get('dbname');
  // postgres.js reads the path RAW (no percent-decoding), so an encoded name would be judged here
  // as one database and opened there as another. Refuse any percent sign instead of guessing.
  const path = url.pathname.replace(/^\//, '');
  if (path.includes('%')) return null;
  if (fromQuery !== null && fromQuery !== path) return null; // two different names: refuse, never guess
  return path.length > 0 ? path : null;
}

/** Is this database NAME an isolated shadow copy? */
export function evaluateShadowDatabaseName(name: string | null): ShadowDsnVerdict {
  if (name === null) return { ok: false, database: null, reason: 'no database name could be read' };
  const reserved = RESERVED_DATABASE_NAMES[name];
  if (reserved !== undefined) return { ok: false, database: name, reason: `${name} is ${reserved}` };
  if (!SHADOW_DATABASE_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      database: name,
      reason: `${name} does not match ${SHADOW_DATABASE_NAME_PATTERN.source} (a shadow copy is named afldb_v2_shadow[_<tag>]_test)`,
    };
  }
  return { ok: true, database: name };
}

/** Is this DSN a connection to an isolated shadow copy? Never echoes the DSN. */
export function evaluateShadowDsn(dsn: string): ShadowDsnVerdict {
  return evaluateShadowDatabaseName(databaseNameFromDsn(dsn));
}

export interface ShadowEnvironmentFinding {
  readonly variable: string;
  readonly database: string | null;
  readonly problem: string;
}

export interface ShadowEnvironmentResult {
  readonly ok: boolean;
  /** Every connection-bearing variable that is set, with the database it names (names only). */
  readonly checked: readonly { readonly variable: string; readonly database: string | null }[];
  readonly findings: readonly ShadowEnvironmentFinding[];
}

const isDsnVariable = (name: string): boolean => /DATABASE_URL/.test(name);

/**
 * Scan an environment for a shadow step: every `*DATABASE_URL*` variable that is set must name a
 * shadow copy (an unrelated DSN left in the shell could be picked up by any tool), every
 * `required` variable must be set, `PGDATABASE` (when set) must name a shadow copy, and
 * `PGSERVICE`/`PGSERVICEFILE` must be unset (a service entry can point anywhere).
 */
export function scanShadowEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  required: readonly string[],
): ShadowEnvironmentResult {
  const findings: ShadowEnvironmentFinding[] = [];
  const checked: { variable: string; database: string | null }[] = [];
  for (const variable of required) {
    if (!isDsnVariable(variable)) {
      findings.push({ variable, database: null, problem: 'a required variable must be a *DATABASE_URL* variable' });
      continue;
    }
    const value = env[variable];
    if (value === undefined || value.trim() === '') {
      findings.push({ variable, database: null, problem: 'required but not set' });
    }
  }
  const names = Object.keys(env).filter((name) => isDsnVariable(name)).sort();
  for (const variable of names) {
    const value = env[variable];
    if (value === undefined || value.trim() === '') continue;
    const verdict = evaluateShadowDsn(value.trim());
    checked.push({ variable, database: verdict.database });
    if (!verdict.ok) findings.push({ variable, database: verdict.database, problem: verdict.reason });
  }
  for (const variable of ['PGSERVICE', 'PGSERVICEFILE']) {
    const value = env[variable];
    if (value !== undefined && value.trim() !== '') {
      findings.push({ variable, database: null, problem: 'must be unset for a shadow step (a service entry can name any database)' });
    }
  }
  const pgDatabase = env.PGDATABASE;
  if (pgDatabase !== undefined && pgDatabase.trim() !== '') {
    const verdict = evaluateShadowDatabaseName(pgDatabase.trim());
    checked.push({ variable: 'PGDATABASE', database: verdict.database });
    if (!verdict.ok) findings.push({ variable: 'PGDATABASE', database: verdict.database, problem: verdict.reason });
  }
  return { ok: findings.length === 0, checked, findings };
}
