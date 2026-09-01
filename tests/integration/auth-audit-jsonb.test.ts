/**
 * AFLDB-ISSUE-121 — auth_audit_log.detail is a jsonb OBJECT, not a jsonb string.
 *
 * Two things are proven here against a real PostgreSQL 16, because
 * neither can be proven without one:
 *
 *   1. Migration 082 repairs the rows the old write path left behind, and
 *      ONLY those rows. The migration file is read from disk and executed
 *      verbatim, so what is tested is the artefact that will be applied to
 *      afldb_dev and production — not a paraphrase of it.
 *   2. The write path in src/lib/auth/session.ts now stores an object.
 *      tests/auth.test.ts proves the binding is `sql.json()` without a
 *      database; only the database can prove what jsonb_typeof() then
 *      says about the stored value.
 *
 * The historical defect is reproduced exactly with `to_jsonb(text)`: a
 * jsonb string scalar whose contents are JSON text is precisely what
 * postgres.js produced when handed an already-stringified object, and it
 * is what dev row 632 held (`jsonb_typeof(detail) = 'string'`, with
 * `detail->>'deletedLogRows'` NULL on a clear that really did delete
 * 4,953 rows).
 *
 * Safety: every statement here runs inside a transaction that is always
 * rolled back (the database.test.ts / nl-search-telemetry-clear.test.ts
 * Rollback idiom), including the DDL — PostgreSQL rolls back ALTER TABLE
 * with everything else, so the constraint this suite drops to plant a
 * legacy fixture is restored by the rollback and never observed missing
 * by anything outside the transaction. No existing audit row is read
 * destructively, no row is committed, and the suite refuses to run
 * outside a _test database (tests/setup.ts, guard.ts).
 *
 * The pooled `audit()` form is exercised on a transaction handle rather
 * than on the real auth pool, so the suite commits no audit rows into an
 * append-only trail. That is not a gap in the proof: both forms funnel
 * through the one insertAuditRow(), and tests/auth.test.ts asserts their
 * emitted SQL and bound values are identical for exactly this reason.
 */
import './guard';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';

import { sql } from '@/db/client';

/**
 * The handle the mocked auth client delegates to: whichever rolled-back
 * transaction the running test has opened. session.ts binds its module at
 * import time, so the indirection has to live here rather than in a
 * per-test module reset.
 */
const active = vi.hoisted(() => ({ handle: null as unknown }));

vi.mock('@/db/authClient', () => {
  const current = () => {
    if (!active.handle) throw new Error('no active transaction handle for the audit writer');
    return active.handle as object;
  };
  // Same Proxy shape as src/db/authClient.ts: callable for the
  // tagged-template form, and forwarding `.json` to the real driver.
  const authSql = new Proxy((() => undefined) as unknown as object, {
    apply: (_target, _thisArg, args: unknown[]) =>
      Reflect.apply(current() as (...a: unknown[]) => unknown, undefined, args),
    get: (_target, property) => Reflect.get(current(), property),
  });
  return { authSql };
});

vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, delete: () => undefined }),
}));

// After the mocks, which vitest hoists above every import in this file.
import { audit, auditInTransaction } from '@/lib/auth/session';

const MIGRATION_082 = readFileSync(
  fileURLToPath(new URL(
    '../../src/db/migrations/082_auth_audit_log_jsonb_repair.sql',
    import.meta.url,
  )),
  'utf8',
);

const CONSTRAINT = 'auth_audit_log_detail_is_object_ck';

/** Thrown to force a rollback once every assertion has run. */
class Rollback extends Error {}

type Db = typeof sql;

/** Runs assertions inside a transaction that is always rolled back. */
async function rolledBack(run: (tx: Db) => Promise<void>): Promise<void> {
  await expect(
    sql.begin(async (tx) => {
      await run(tx as unknown as Db);
      throw new Rollback('rolled back on purpose');
    }),
  ).rejects.toThrow('rolled back on purpose');
}

/**
 * A row exactly as the defective write path left it: the payload
 * JSON-encoded twice, so the column holds a jsonb string scalar.
 */
async function insertLegacyDoubleEncoded(
  tx: Db, action: string, payload: Record<string, unknown>,
): Promise<number> {
  // id::int — postgres.js returns int8 as a string.
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO auth_audit_log (action, detail)
    VALUES (${action}, to_jsonb(${JSON.stringify(payload)}::text))
    RETURNING id::int AS id
  `;
  return row.id;
}

async function insertRaw(tx: Db, action: string, detail: unknown): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO auth_audit_log (action, detail)
    VALUES (${action}, ${detail as never})
    RETURNING id::int AS id
  `;
  return row.id;
}

type DetailRow = { typeof: string | null; detail: unknown; xmin: string };

async function readDetail(tx: Db, id: number): Promise<DetailRow> {
  const [row] = await tx<DetailRow[]>`
    SELECT jsonb_typeof(detail) AS "typeof", detail, xmin::text AS xmin
      FROM auth_audit_log WHERE id = ${id}
  `;
  return row;
}

/** Drops the guard so a pre-082 row can be planted, as it could be before 082. */
async function dropConstraint(tx: Db): Promise<void> {
  await tx.unsafe(`ALTER TABLE auth_audit_log DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
}

async function constraintExists(tx: Db): Promise<boolean> {
  const [row] = await tx<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = ${CONSTRAINT}
         AND conrelid = 'public.auth_audit_log'::regclass
    ) AS present
  `;
  return row.present;
}

describe('migration 082 — auth_audit_log.detail jsonb repair (AFLDB-ISSUE-121)', () => {
  it('repairs a double-encoded object, leaves a correct object and a NULL alone', async () => {
    await rolledBack(async (tx) => {
      await dropConstraint(tx);

      const payload = { deletedLogRows: 4953, retainedLogRows: 0, detachedAppHealthLinks: 14 };
      const legacyId = await insertLegacyDoubleEncoded(tx, 'issue121.legacy', payload);
      const correctId = await insertRaw(tx, 'issue121.correct', tx.json({ searchLogId: 5 }));
      const nullId = await insertRaw(tx, 'issue121.null', null);

      // The defect, reproduced: opaque to SQL before the repair.
      const before = await readDetail(tx, legacyId);
      expect(before.typeof).toBe('string');
      const [beforeProbe] = await tx<{ v: string | null }[]>`
        SELECT detail->>'deletedLogRows' AS v FROM auth_audit_log WHERE id = ${legacyId}
      `;
      expect(beforeProbe.v).toBeNull();

      const correctBefore = await readDetail(tx, correctId);

      await tx.unsafe(MIGRATION_082);

      // 1. The double-encoded row is now the object it always meant to be.
      const after = await readDetail(tx, legacyId);
      expect(after.typeof).toBe('object');
      expect(after.detail).toEqual(payload);
      const [afterProbe] = await tx<{ v: string | null }[]>`
        SELECT detail->>'deletedLogRows' AS v FROM auth_audit_log WHERE id = ${legacyId}
      `;
      expect(afterProbe.v).toBe('4953');

      // 2. The already-correct row is untouched -- same value, and the same
      //    row version, so the repair did not rewrite what did not need it.
      const correctAfter = await readDetail(tx, correctId);
      expect(correctAfter.typeof).toBe('object');
      expect(correctAfter.detail).toEqual({ searchLogId: 5 });
      expect(correctAfter.xmin).toBe(correctBefore.xmin);

      // 3. NULL survives as NULL: an event with no payload is not a defect.
      const nullAfter = await readDetail(tx, nullId);
      expect(nullAfter.typeof).toBeNull();
      expect(nullAfter.detail).toBeNull();

      // 4. The guard is in place afterwards.
      expect(await constraintExists(tx)).toBe(true);
    });
  });

  it('is self-limiting: a second run repairs nothing and re-adds nothing', async () => {
    await rolledBack(async (tx) => {
      await dropConstraint(tx);
      const legacyId = await insertLegacyDoubleEncoded(tx, 'issue121.twice', { a: 1 });

      await tx.unsafe(MIGRATION_082);
      const first = await readDetail(tx, legacyId);

      // Re-running must be a no-op, not an error: the WHERE clause stops
      // matching and the constraint add is guarded by its own existence check.
      await tx.unsafe(MIGRATION_082);
      const second = await readDetail(tx, legacyId);

      expect(second.typeof).toBe('object');
      expect(second.xmin).toBe(first.xmin);
      expect(await constraintExists(tx)).toBe(true);
    });
  });

  it('refuses to guess at a string that is not a JSON object, and changes nothing', async () => {
    // The tightening over migration 048: a blind `(detail #>> '{}')::jsonb`
    // would fail on this row mid-migration, or silently reinterpret a
    // legitimate scalar as structure it never had.
    let plantedId = 0;
    await expect(
      sql.begin(async (tx) => {
        const db = tx as unknown as Db;
        await dropConstraint(db);
        plantedId = await insertRaw(db, 'issue121.scalar', db.json('a plain sentence'));
        const legacyId = await insertLegacyDoubleEncoded(db, 'issue121.alongside', { a: 1 });
        expect(legacyId).toBeGreaterThan(0);
        await db.unsafe(MIGRATION_082);
      }),
    ).rejects.toThrow(/AFLDB-ISSUE-121/);

    expect(plantedId).toBeGreaterThan(0);

    // The migration's own transaction took the repair down with it, so the
    // scalar row does not exist and nothing alongside it was rewritten.
    const [row] = await sql<{ id: number }[]>`
      SELECT id::int AS id FROM auth_audit_log WHERE id = ${plantedId}
    `;
    expect(row).toBeUndefined();
  });
});

describe('auth_audit_log_detail_is_object_ck (AFLDB-ISSUE-121)', () => {
  it('rejects a future double-encoded string payload', async () => {
    await expect(
      sql.begin(async (tx) => {
        await insertLegacyDoubleEncoded(tx as unknown as Db, 'issue121.rejected', { a: 1 });
      }),
    ).rejects.toThrow(new RegExp(CONSTRAINT));
  });

  it('rejects any other scalar payload', async () => {
    await expect(
      sql.begin(async (tx) => {
        await insertRaw(tx as unknown as Db, 'issue121.rejected', (tx as unknown as Db).json(7));
      }),
    ).rejects.toThrow(new RegExp(CONSTRAINT));
  });

  it('accepts an object and a NULL', async () => {
    await rolledBack(async (tx) => {
      const objectId = await insertRaw(tx, 'issue121.accepted', tx.json({ ok: true }));
      const nullId = await insertRaw(tx, 'issue121.accepted', null);
      expect((await readDetail(tx, objectId)).typeof).toBe('object');
      expect((await readDetail(tx, nullId)).typeof).toBeNull();
    });
  });
});

describe('the audit writer stores object-shaped jsonb (AFLDB-ISSUE-121)', () => {
  const admin = { userId: undefined, label: 'super@example.test' };
  const payload = { deletedLogRows: 4953, retainedLogRows: 0 };

  it('auditInTransaction() writes an object the database can read structurally', async () => {
    await rolledBack(async (tx) => {
      await auditInTransaction(
        tx as unknown as postgres.TransactionSql, 'nl_search.telemetry_cleared', payload, admin,
      );

      const [row] = await tx<{ typeof: string; deleted: string | null }[]>`
        SELECT jsonb_typeof(detail) AS "typeof", detail->>'deletedLogRows' AS deleted
          FROM auth_audit_log
         WHERE action = 'nl_search.telemetry_cleared'
         ORDER BY id DESC LIMIT 1
      `;
      expect(row.typeof).toBe('object');
      expect(row.deleted).toBe('4953');
    });
  });

  it('audit() writes the same object shape on the handle it is given', async () => {
    await rolledBack(async (tx) => {
      active.handle = tx;
      try {
        await audit('nl_search.reviewed', { searchLogId: 5 }, admin);

        const [row] = await tx<{ typeof: string; searchLogId: string | null }[]>`
          SELECT jsonb_typeof(detail) AS "typeof", detail->>'searchLogId' AS "searchLogId"
            FROM auth_audit_log
           WHERE action = 'nl_search.reviewed'
           ORDER BY id DESC LIMIT 1
        `;
        expect(row.typeof).toBe('object');
        expect(row.searchLogId).toBe('5');
      } finally {
        active.handle = null;
      }
    });
  });
});
