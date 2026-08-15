/**
 * PostgreSQL client for the operational auth/submission tables.
 *
 * A second pool with a second role, on purpose. The public site runs as
 * afldb_app, which is read-only — an invariant established by the migration
 * GRANTs (afldb_app is granted SELECT only) and enforced against the live
 * cluster by tests/integration/privileges.test.ts, which interrogates the
 * catalogue so it also catches privileges the role holds but has never
 * exercised. Logins and uploads genuinely write, so they run as afldb_auth,
 * whose grants cover ONLY the tables from migration 023 — the same test file
 * asserts that role holds no write on the statistical tables. A SQL injection
 * in a public page still cannot write; a compromise of the auth path still
 * cannot touch statistics.
 */
import 'server-only';

import postgres from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __afldbAuthSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const connectionString = process.env.AFLDB_AUTH_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'AFLDB_AUTH_DATABASE_URL is not set. '
      + 'Run tools/maintenance/02_add_auth_role.sh on the server.',
    );
  }

  return postgres(connectionString, {
    // Auth traffic is a trickle next to page traffic.
    max: 3,
    idle_timeout: 30,
    connect_timeout: 10,
    connection: { statement_timeout: 5000 },
    onnotice: () => {},
    transform: { undefined: null },
  });
}

function getClient(): ReturnType<typeof postgres> {
  if (!globalThis.__afldbAuthSql) {
    globalThis.__afldbAuthSql = createClient();
  }
  return globalThis.__afldbAuthSql;
}

/**
 * Lazy: the pool (and the env check) exist only once a query runs.
 * `next build` imports every route while collecting page data, and a
 * build must not require auth credentials — only serving does.
 */
export const authSql: ReturnType<typeof postgres> = new Proxy(
  // The target must be callable for the tagged-template form.
  ((..._args: never[]) => undefined) as unknown as ReturnType<typeof postgres>,
  {
    apply(_target, _thisArg, args: unknown[]) {
      return Reflect.apply(getClient() as unknown as (...a: unknown[]) => unknown, undefined, args);
    },
    get(_target, property) {
      return Reflect.get(getClient(), property);
    },
  },
);
