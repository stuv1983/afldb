/**
 * AFLDB V2 Launch F — the isolated local PostgreSQL target policy (pure).
 *
 * Real-PostgreSQL verification of V2 runs on a cluster created for that purpose only
 * (`tools/v2/isolated-pg.ts`): a portable PostgreSQL bound to loopback, whose `cluster_name` is
 * {@link ISOLATED_CLUSTER_NAME}, holding databases that the tool created and marked with the
 * database comment {@link ISOLATED_DATABASE_MARKER}. Every step that mutates such a database
 * (the runner before it spawns anything, and `tests/integration/guard.ts` inside the test
 * process when `AFLDB_V2_ISOLATED_PG=1`) checks BOTH halves below; each is an independent guard
 * on top of the D5 `_test` suffix rule (ADR 0005):
 *
 *   1. the DSN itself: a `_test` database named by {@link ISOLATED_DATABASE_NAME_PATTERN}, a
 *      loopback host, the expected port, and no libpq redirection (`service`, `host` lists);
 *   2. the server it reached: `cluster_name`, the database comment marker, and
 *      `current_database()` equal to the DSN's database.
 *
 * A shared or live database fails at least one of these by construction: none of them carries
 * the cluster name or the marker, and none is named `afldb_v2_*_test`.
 *
 * Nothing here reads the environment, the file system or a database. Findings name the check
 * and the database name only, never a host, role or password.
 */

export const ISOLATED_CLUSTER_NAME = 'afldb_v2_isolated';
export const ISOLATED_DATABASE_MARKER = 'afldb-v2-isolated-test';
/** `afldb_v2_int_test`, `afldb_v2_shadow_test`, `afldb_v2_prev2_test`, ... */
export const ISOLATED_DATABASE_NAME_PATTERN = /^afldb_v2_[a-z0-9]+(?:_[a-z0-9]+)*_test$/;
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export interface IsolatedTargetFinding {
  readonly check: string;
  readonly detail: string;
}

export interface IsolatedServerFacts {
  readonly clusterName: string | null;
  readonly databaseComment: string | null;
  readonly currentDatabase: string | null;
}

function parse(dsn: string): URL | null {
  try {
    const url = new URL(dsn);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:' ? url : null;
  } catch {
    return null;
  }
}

/** Database name of a DSN, or null when it is not a postgres URL. */
export function isolatedDatabaseOf(dsn: string): string | null {
  const url = parse(dsn);
  if (!url) return null;
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return name.length > 0 ? name : null;
}

/** Guard 1: the connection string, before any connection is opened. */
export function checkIsolatedTestDsn(dsn: string, expectedPort: number): IsolatedTargetFinding[] {
  const url = parse(dsn);
  if (!url) return [{ check: 'dsn_url', detail: 'not a postgres:// or postgresql:// URL' }];
  const findings: IsolatedTargetFinding[] = [];
  const database = isolatedDatabaseOf(dsn);
  if (!database || !database.endsWith('_test')) {
    findings.push({ check: 'database_suffix', detail: `database ${database ?? '(none)'} does not end in _test` });
  }
  if (!database || !ISOLATED_DATABASE_NAME_PATTERN.test(database)) {
    findings.push({ check: 'database_name', detail: `database ${database ?? '(none)'} is not an afldb_v2_*_test name` });
  }
  if (!LOOPBACK_HOSTS.includes(url.hostname)) {
    findings.push({ check: 'loopback_host', detail: 'host is not loopback' });
  }
  if (url.port === '' || Number(url.port) !== expectedPort) {
    findings.push({ check: 'port', detail: `port is not the isolated cluster port ${expectedPort}` });
  }
  for (const key of ['service', 'host', 'hostaddr', 'port', 'dbname']) {
    if (url.searchParams.has(key)) findings.push({ check: 'libpq_redirect', detail: `query parameter ${key} can redirect the connection` });
  }
  return findings;
}

/** Guard 2: what the server says about itself once connected. */
export function checkIsolatedTestServer(dsnDatabase: string, facts: IsolatedServerFacts): IsolatedTargetFinding[] {
  const findings: IsolatedTargetFinding[] = [];
  if (facts.clusterName !== ISOLATED_CLUSTER_NAME) {
    findings.push({ check: 'cluster_name', detail: `cluster_name is not ${ISOLATED_CLUSTER_NAME}` });
  }
  if (facts.databaseComment !== ISOLATED_DATABASE_MARKER) {
    findings.push({ check: 'database_marker', detail: `database ${dsnDatabase} does not carry the isolated-test marker comment` });
  }
  if (facts.currentDatabase !== dsnDatabase) {
    findings.push({ check: 'current_database', detail: `connected database is not ${dsnDatabase}` });
  }
  return findings;
}

/** The read-only query whose single row feeds {@link checkIsolatedTestServer}. */
export const ISOLATED_SERVER_FACTS_SQL = `SELECT current_setting('cluster_name') AS cluster_name,
       shobj_description(d.oid, 'pg_database') AS database_comment,
       current_database() AS current_database
  FROM pg_database d
 WHERE d.datname = current_database()`;
