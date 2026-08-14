/**
 * PostgreSQL client.
 *
 * `server-only` makes importing this from a Client Component a build
 * error, so database credentials can never reach a browser bundle.
 */
import 'server-only';

import postgres from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __afldbSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const statementTimeout = Number(process.env.AFLDB_STATEMENT_TIMEOUT_MS ?? 5000);

  // Next.js prerenders with several worker processes, each of which
  // builds its own pool. At the serving default that multiplies out past
  // PostgreSQL's max_connections and the build fails with "too many
  // clients". Prerendering is throughput-bound, not latency-bound, so a
  // small pool per worker is sufficient.
  const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
  const poolMax = isBuild ? 2 : Number(process.env.AFLDB_POOL_MAX ?? 10);

  return postgres(connectionString, {
    max: poolMax,
    idle_timeout: 30,
    connect_timeout: 10,
    // A public Advanced Search could otherwise pin a backend indefinitely.
    connection: { statement_timeout: statementTimeout },
    // Never let query text or parameters reach the logs.
    onnotice: () => {},
    transform: { undefined: null },
  });
}

// Next.js dev-mode hot reload re-evaluates modules; without this the
// connection pool would be recreated on every edit until PostgreSQL
// refused new connections.
export const sql = globalThis.__afldbSql ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__afldbSql = sql;
}
