/**
 * AFLDB V2 plan D5 / review resolution R-003 — refuse a non-test database inside a test process.
 *
 * `src/db/client.ts` and `src/db/authClient.ts` are production runtime paths and must keep
 * accepting the production and DEV DSNs they are deployed with, so this guard is a no-op
 * outside a test process. Inside one — `VITEST` is set by vitest in its workers and is
 * inherited by every child process a test spawns — a pool may only be built for:
 *
 *   - a database whose name ends in `_test` (the same allowlist suffix tests/setup.ts uses), or
 *   - a never-connectable unit placeholder: an RFC 6761 `.invalid` host, or a loopback host on
 *     port 1 (the repository's existing convention, e.g. tests/catalogue-lookups.test.ts).
 *
 * The refusal names the variable and the database name only, never the DSN (which may carry a
 * password). It complements tests/setup.ts (applyTestDsnPolicy from @afldb/testing,
 * packages/testing/src/dsn-policy.ts), which strips or redirects the
 * variables before any test module loads; this catches a value a test or tool sets afterwards.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/** True when `env` describes a vitest worker or a child process spawned from one. */
export function isTestProcess(env: Record<string, string | undefined> = process.env): boolean {
  return typeof env.VITEST === 'string' && env.VITEST !== '';
}

/** Null when `dsn` may be used by a test process, otherwise the reason it may not. */
export function testProcessDsnRefusal(variable: string, dsn: string): string | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return `${variable} is not a valid connection URL; refusing to connect from a test process.`;
  }
  const database = url.pathname.replace(/^\//, '');
  if (/_test$/.test(database)) return null;
  const host = url.hostname.toLowerCase();
  if (host.endsWith('.invalid')) return null;
  if (LOOPBACK_HOSTS.has(host) && url.port === '1') return null;
  return `${variable} names the database '${database}', which is not a _test database. `
    + 'Refusing to connect from a test process (AFLDB V2 plan D5).';
}

/** Throw when running under a test process and `dsn` is not an allowed test target. */
export function assertTestProcessDsn(
  variable: string,
  dsn: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!isTestProcess(env)) return;
  const refusal = testProcessDsnRefusal(variable, dsn);
  if (refusal) throw new Error(refusal);
}
