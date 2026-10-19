/**
 * @afldb/db — the minimal SQL port (AFLDB V2 Stage 4, docs/v2/adr/0008-curated-awards.md).
 *
 * Pure services in @afldb/admin take a `SqlExecutor` instead of importing a connection, so the
 * same service SQL runs on the production postgres.js import connection and on an in-memory
 * PGlite database in tests (`@afldb/testing`). The port is deliberately three members wide:
 * run one parameterised statement, and run a unit of work in ONE transaction.
 *
 * This module imports only the TYPE of `postgres`: it never opens a connection and never
 * imports `src/db/client.ts` (which builds a pool on import).
 *
 * Two driver differences every caller must absorb, because the port does not hide them:
 *   - postgres.js returns `int8` as a STRING and PGlite returns it as a number. Services cast
 *     `::int` in SQL and coerce with `Number()`.
 *   - Parameters are positional (`$1`). Pass a jsonb value as `JSON.stringify(x)` with an
 *     explicit `$n::jsonb` cast so it is written single-encoded by both drivers.
 */
import type postgres from 'postgres';

/** One parameterised statement. Never build SQL text from caller input. */
export interface SqlExecutor {
  query<R extends object = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<R[]>;
}

/**
 * An executor that can also run a unit of work atomically: `work` receives an executor bound to
 * ONE transaction; it commits when `work` resolves and rolls back when it throws (the error
 * propagates unchanged). The executor passed to `work` has no `transaction` member of its own,
 * so a service cannot accidentally nest one.
 */
export interface TransactionalSqlExecutor extends SqlExecutor {
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/**
 * Executors created by the postgres.js adapter remember the native handle they wrap, so a
 * server-only adapter can hand the SAME transaction to an existing function that wants
 * `postgres.TransactionSql` (for example `insertAwardWinner`). Weakly held; not part of the port.
 */
const NATIVE_TRANSACTIONS = new WeakMap<SqlExecutor, postgres.TransactionSql>();

/** The postgres.js transaction behind an executor made by this module, or undefined. */
export function nativeTransactionOf(executor: SqlExecutor): postgres.TransactionSql | undefined {
  return NATIVE_TRANSACTIONS.get(executor);
}

type Runner = Pick<postgres.Sql, 'unsafe'>;

async function runUnsafe<R extends object>(
  runner: Runner,
  text: string,
  params: readonly unknown[],
): Promise<R[]> {
  const rows = await runner.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  return Array.from(rows) as unknown as R[];
}

/** Wrap a postgres.js transaction handle (the argument of `sql.begin(async (tx) => …)`). */
export function postgresTransactionExecutor(tx: postgres.TransactionSql): SqlExecutor {
  const executor: SqlExecutor = {
    query: <R extends object>(text: string, params: readonly unknown[] = []) =>
      runUnsafe<R>(tx, text, params),
  };
  NATIVE_TRANSACTIONS.set(executor, tx);
  return executor;
}

/**
 * Wrap a postgres.js connection. `transaction` opens `sql.begin`, so the work commits or rolls
 * back as one unit. The caller owns the connection's lifetime (`sql.end()`).
 */
export function postgresExecutor(sql: postgres.Sql): TransactionalSqlExecutor {
  return {
    query: <R extends object>(text: string, params: readonly unknown[] = []) =>
      runUnsafe<R>(sql, text, params),
    transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) =>
      sql.begin((tx) => work(postgresTransactionExecutor(tx))) as Promise<T>,
  };
}
