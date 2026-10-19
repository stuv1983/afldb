/**
 * @afldb/testing — the in-memory PGlite helper (AFLDB V2 plan D2, review resolution R-017).
 *
 * PGlite is PostgreSQL compiled to WebAssembly, run entirely inside the test process. It lets the V2
 * services' SQL and a V2 migration's constraints execute for real without any database server, DSN
 * or network (the owner forbids contact with any PostgreSQL instance from V2).
 *
 * Hard rules, asserted by tests/v2-curated-awards-pglite.test.ts:
 *   - IN MEMORY ONLY. `createInMemoryPglite()` never passes a `dataDir`, so no file is written and
 *     nothing persists between instances.
 *   - NO NETWORK. PGlite loads from the installed package; nothing is fetched at runtime.
 *   - NOT a copy of the repository's 110 migrations. A test builds LABELLED STUB prerequisites for
 *     only the tables a migration under test references, then applies the migration file VERBATIM
 *     from disk. A stub is a stub: plan D2 forbids extending PGlite towards the full schema, and a
 *     passing PGlite test is evidence about the migration and the service SQL it runs, not about the
 *     real database (roles, grants through `afldb_meta`, and every earlier migration remain
 *     "unexecuted on PostgreSQL").
 *
 * `@electric-sql/pglite` is imported lazily so loading `@afldb/testing` for the DSN policy or the
 * boundary checker never loads WebAssembly.
 */
import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';

/** The slice of a PGlite instance (or its transaction handle) this helper uses. */
interface PgliteQueryable {
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/** A PGlite database, typed structurally so this module needs no static import of the package. */
export interface InMemoryPglite extends PgliteQueryable {
  exec(text: string): Promise<unknown>;
  transaction<T>(work: (tx: PgliteQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Create an empty, in-memory PGlite database. Never persists; call `close()` when done. */
export async function createInMemoryPglite(): Promise<InMemoryPglite> {
  const { PGlite } = await import('@electric-sql/pglite');
  // No dataDir argument, on purpose: that selects the in-memory filesystem.
  return new PGlite() as unknown as InMemoryPglite;
}

function executorOver(queryable: PgliteQueryable): SqlExecutor {
  return {
    async query<R extends object>(text: string, params: readonly unknown[] = []): Promise<R[]> {
      const result = await queryable.query<R>(text, [...params]);
      return result.rows;
    },
  };
}

/**
 * A {@link TransactionalSqlExecutor} over PGlite. `transaction` uses PGlite's own transaction, which
 * commits when the work resolves and rolls back when it throws.
 */
export function pgliteExecutor(db: InMemoryPglite): TransactionalSqlExecutor {
  return {
    ...executorOver(db),
    transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) =>
      db.transaction((tx) => work(executorOver(tx))),
  };
}
