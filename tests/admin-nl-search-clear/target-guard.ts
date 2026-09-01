/**
 * AFLDB-ISSUE-119 — destructive-target safety for the telemetry-clear
 * Playwright acceptance harness.
 *
 * This harness is the ONLY test in the repository that drives
 * public.nl_search_telemetry_clear() for real: it deletes disposable
 * nl_search_log rows on whatever deployment AFLDB_E2E_BASE_URL points at,
 * and its seed helper (seed.ts) wipes and rebuilds the NL telemetry
 * tables on whatever database AFLDB_TEST_DATABASE_URL names. Both are
 * irreversible. Every safeguard below exists so that "whatever" can only
 * ever be a throwaway loopback `_test` deployment the operator stood up
 * for this run, never dev (10.0.40.100 / afldb_dev) and never production.
 *
 * The checks are deliberately duplicated across layers — the Playwright
 * config calls assertDisposableTestTarget() at load, auth.setup.ts and
 * the spec call it again, and seed.ts calls assertDisposableTestDatabase()
 * before it opens a connection — so that running any single file directly,
 * with any --config, still cannot reach a protected target.
 *
 * There is NO default and NO implicit fallback anywhere: an unset
 * variable is a hard refusal, not a guess.
 */

/** Hostnames that count as "this machine only". */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Named here only to be refused with a specific message. */
const KNOWN_PROTECTED_HOSTS = ['10.0.40.100'];

export type DisposableTarget = { baseURL: string };

/**
 * Throws unless AFLDB_E2E_BASE_URL names a loopback deployment and the
 * operator has acknowledged the destructive run for a `_test` database.
 * Returns the validated base URL for the Playwright config to use.
 */
export function assertDisposableTestTarget(): DisposableTarget {
  const raw = process.env.AFLDB_E2E_BASE_URL;
  if (!raw || !raw.trim()) {
    throw new Error(
      'AFLDB_E2E_BASE_URL is not set. The ISSUE-119 telemetry-clear harness has '
      + 'no default target: it performs a real, irreversible clear, so it must be '
      + 'pointed explicitly at a disposable loopback _test deployment '
      + '(e.g. http://127.0.0.1:3400).',
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`AFLDB_E2E_BASE_URL is not a valid URL: ${JSON.stringify(raw)}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`AFLDB_E2E_BASE_URL must be http(s); got ${url.protocol}`);
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error(
      'AFLDB_E2E_BASE_URL must be a bare origin (scheme://host:port) with no '
      + `path, query or fragment; got ${JSON.stringify(raw)}.`,
    );
  }

  const host = url.hostname.toLowerCase();
  if (KNOWN_PROTECTED_HOSTS.includes(host)) {
    throw new Error(
      `AFLDB_E2E_BASE_URL points at ${host}, which is the shared dev server. This `
      + 'harness clears telemetry for real and must never run against dev or '
      + 'production — only a disposable loopback _test deployment.',
    );
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `AFLDB_E2E_BASE_URL host ${JSON.stringify(host)} is not loopback. The `
      + 'telemetry-clear acceptance run is only permitted against a disposable '
      + 'deployment on 127.0.0.1 / localhost, never a remote host (dev, staging, '
      + 'production).',
    );
  }

  assertDestructiveAcknowledged('AFLDB_E2E_BASE_URL');

  return { baseURL: `${url.protocol}//${url.host}` };
}

export type DisposableDatabase = { dsn: string; database: string; endpoint: string };

/**
 * Throws unless AFLDB_TEST_DATABASE_URL names a `_test` database (and not
 * afldb_dev / anything that looks like production) and the operator has
 * acknowledged the destructive run against that exact database name.
 * Returns the validated DSN for seed.ts to connect with.
 */
export function assertDisposableTestDatabase(): DisposableDatabase {
  const dsn = process.env.AFLDB_TEST_DATABASE_URL;
  if (!dsn || !dsn.trim()) {
    throw new Error(
      'AFLDB_TEST_DATABASE_URL is not set. seed.ts wipes and rebuilds the NL '
      + 'telemetry tables and will not guess a target. Point it at the same '
      + 'disposable _test database the deployment under test is using.',
    );
  }

  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error('AFLDB_TEST_DATABASE_URL is not a valid connection URL.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('AFLDB_TEST_DATABASE_URL does not name a database.');

  if (!/_test$/.test(database)) {
    throw new Error(
      `AFLDB_TEST_DATABASE_URL names '${database}', which does not end in _test. `
      + 'The telemetry-clear seed refuses any database that is not explicitly a '
      + 'test database.',
    );
  }
  if (database === 'afldb_dev' || /prod/i.test(database)) {
    throw new Error(
      `AFLDB_TEST_DATABASE_URL names '${database}'. The seed will not run against `
      + 'a development or production database under any circumstances.',
    );
  }

  const ack = assertDestructiveAcknowledged('AFLDB_TEST_DATABASE_URL');
  if (ack !== database) {
    throw new Error(
      `AFLDB_E2E_TELEMETRY_CLEAR_CONFIRM is '${ack}', but AFLDB_TEST_DATABASE_URL `
      + `names '${database}'. Set the acknowledgement to the exact database name `
      + 'you intend to wipe, so a stale value from another project cannot arm '
      + 'this run.',
    );
  }

  return {
    dsn,
    database,
    endpoint: `${url.hostname.toLowerCase()}:${url.port || '5432'}`,
  };
}

/**
 * The one explicit "yes, delete for real" switch, shared by both guards.
 * Must be set and must end in _test; assertDisposableTestDatabase()
 * additionally pins it to the exact database name.
 */
function assertDestructiveAcknowledged(context: string): string {
  const ack = process.env.AFLDB_E2E_TELEMETRY_CLEAR_CONFIRM;
  if (!ack || !ack.trim()) {
    throw new Error(
      `${context} is set, but AFLDB_E2E_TELEMETRY_CLEAR_CONFIRM is not. This `
      + 'harness deletes telemetry and wipes the NL tables; set '
      + 'AFLDB_E2E_TELEMETRY_CLEAR_CONFIRM to the name of the disposable _test '
      + 'database you are targeting to acknowledge that.',
    );
  }
  if (!/_test$/.test(ack)) {
    throw new Error(
      `AFLDB_E2E_TELEMETRY_CLEAR_CONFIRM is ${JSON.stringify(ack)}, which does not `
      + 'end in _test. Only a _test database may be acknowledged for this run.',
    );
  }
  return ack;
}
