/**
 * AFLDB-ISSUE-096 §5.H — the source observation spine against real PostgreSQL.
 *
 * Migration 074 is the shipped artefact under test. `src/lib/acquisition/`
 * carries no persistence layer at all — every module is pure and
 * `resolveSourceId` is the boundary nothing crosses — so these tests drive
 * the REAL decision functions (`decideObservation`, `sweepAbsences`) and
 * apply their decisions to `afldb_test` with the SQL a persistence layer
 * would issue. What is proved is therefore the schema half of §5.H: that
 * PostgreSQL actually admits the histories the model requires and actually
 * refuses the ones it forbids. What is NOT proved is any production
 * persistence path, because none exists yet, and no test here pretends
 * otherwise (see AFLDB-ISSUE-096.md §16.16).
 *
 * Every decision is taken from state READ BACK FROM POSTGRESQL — the open
 * head (its `version_seq`, `payload_hash`, `hash_recipe`, `raw_payload` and
 * `absent_since`) and the set of hashes `source_payloads` already holds —
 * rather than from a value carried forward in memory. A poll therefore sees
 * what the database stored, so a column that failed to round-trip, or a
 * head the writes left pointing at the wrong version, changes the outcome
 * instead of being papered over by the test's own bookkeeping.
 *
 * Everything runs inside one transaction that always rolls back, and every
 * row is scoped to a synthetic `sources` row created inside it, so the
 * fixtures collide with no real data and nothing is left behind even on a
 * failure.
 *
 * NOTHING HERE ACCEPTS A CANDIDATE. There is no canonical write, no
 * `'accept'` decision row and no override: those are outside S1–S4 by
 * design, and the constraint that makes an accepted refusal verb
 * unrepresentable is asserted rather than worked around.
 *
 * @see src/db/migrations/074_source_observation_spine.sql
 * @see tests/current-season-import.test.ts (the DB-free contract home)
 */
import './guard';

import { readFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  decideObservation,
  sweepAbsences,
  type JsonValue,
  type ObservationDecision,
  type ObservationHead,
} from '@/lib/acquisition/observations';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '@/lib/acquisition/source-families';
import { asImportBatchId, type ImportBatchId } from '@/lib/import-batch-id';

afterAll(async () => {
  await sql.end();
});

const registry = parseSourceFamilyRegistry(
  JSON.parse(readFileSync('data/reference/source-families.json', 'utf8')),
);
/** A declared family, so `decideObservation` will record against it at all. */
const contract = getSourceFamily(registry, 'squiggle_api', 'match');

const FAMILY = contract.family;
const EXTERNAL_ID = 'issue096-observation-spine';
const SCOPE = 'season=2099';
/** A scope this fixture never enumerates, so absence must not reach it. */
const OTHER_ID = 'issue096-other-scope';
const OTHER_SCOPE = 'season=2098';

/** Squiggle game state A, its score correction B, and A again. */
const A: JsonValue = {
  id: 990001, year: 2099, round: 0, date: '2099-03-05 19:30:00',
  hteam: 'Sydney', ateam: 'Carlton', hscore: 132, ascore: 69,
  complete: 100, updated: '2099-03-05 22:16:49',
};
const B: JsonValue = {
  ...(A as Record<string, JsonValue>), ascore: 70, updated: '2099-03-05 22:40:00',
};

const T = {
  first: '2099-03-05T22:20:00Z',
  second: '2099-03-05T22:45:00Z',
  third: '2099-03-06T01:00:00Z',
  sweep: '2099-03-07T01:00:00Z',
  back: '2099-03-08T01:00:00Z',
} as const;

type Tx = postgres.TransactionSql;

/**
 * A jsonb parameter. postgres.js's own JSON type is mutable where
 * `JsonValue` is readonly; the data is identical, so the cast is at the
 * driver boundary and nowhere else.
 */
function jsonb(value: JsonValue) {
  return sql.json(value as never);
}

/** Marker so a deliberate rollback is distinguishable from a real failure. */
class Rollback extends Error {}

type Fixtures = {
  sourceId: number;
  season: number;
  adminUserId: number;
  /** AFLDB-ISSUE-105: bigint, so the driver's decimal text, never a number. */
  batchId: ImportBatchId;
};

/**
 * Seed the four parents migration 074's foreign keys require, all synthetic
 * and all created inside the caller's transaction: a `sources` row (so every
 * spine row in the test is reachable by `source_id` alone and can collide
 * with nothing real), a season outside any imported range, an administrator
 * for the decision ledger, and one import batch.
 */
async function seed(tx: Tx): Promise<Fixtures> {
  const [source] = await tx<{ id: number }[]>`
    INSERT INTO sources (key, name, kind)
    VALUES ('issue096_spine_probe', 'ISSUE-096 spine probe', 'scrape')
    RETURNING id::int AS id
  `;
  // `status` is the writable authority; `is_complete` has been a generated
  // mirror of `status = 'complete'` since migration 015 and cannot be
  // inserted into. 'in_progress' is also the honest state for a spine
  // fixture, since the pipeline only ever observes the current season.
  const [season] = await tx<{ year: number }[]>`
    INSERT INTO seasons (year, league, status)
    VALUES (2099, 'AFL', 'in_progress'::season_status)
    RETURNING year
  `;
  const [admin] = await tx<{ id: number }[]>`
    INSERT INTO auth_users (email, role)
    VALUES ('issue096-spine-probe@example.invalid', 'admin')
    RETURNING id::int AS id
  `;
  // `import_batches.id` is bigint. It is NOT cast to int here: the fixture
  // must hand back exactly what the production writers hand back, or the
  // suite would prove a representation nothing else uses (AFLDB-ISSUE-105).
  const [batch] = await tx<{ id: string }[]>`
    INSERT INTO import_batches (source_id, tool, target_table)
    VALUES (${source.id}, 'tests/integration/observation-spine', 'staging.source_records')
    RETURNING id
  `;
  return {
    sourceId: source.id,
    season: season.year,
    adminUserId: admin.id,
    batchId: asImportBatchId(batch.id),
  };
}

/**
 * Run `body` inside a transaction that always rolls back.
 *
 * Nothing these tests write is ever committed, which is what lets them
 * insert into `sources`, `seasons` and `auth_users` — append-only tables in
 * every other context — without leaving a trace.
 */
async function inRolledBackTransaction(
  body: (tx: Tx, f: Fixtures) => Promise<void>,
): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      const fixtures = await seed(tx as Tx);
      await body(tx as Tx, fixtures);
      throw new Rollback('intentional rollback');
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/**
 * Assert PostgreSQL refuses a statement, and return its error message so the
 * refusing constraint can be named. The statement runs inside a savepoint,
 * so a refusal does not abort the surrounding transaction and an acceptance
 * does not survive it.
 */
async function expectRefused(
  tx: Tx, label: string, statement: (sp: Tx) => Promise<unknown>,
): Promise<string> {
  let accepted = false;
  try {
    await tx.savepoint(async (sp) => {
      await statement(sp as Tx);
      accepted = true;
      throw new Rollback('statement was accepted');
    });
  } catch (error) {
    if (error instanceof Rollback) {
      throw new Error(`${label}: PostgreSQL accepted a statement the schema must refuse.`);
    }
    expect(accepted, label).toBe(false);
    return (error as Error).message;
  }
  throw new Error(`${label}: savepoint returned without refusing.`);
}

/* ------------------------------------------------------------------ *
 * The SQL a persistence layer would issue for one observation decision
 * ------------------------------------------------------------------ */

/** The open head as PostgreSQL holds it, in the shape the decider takes. */
async function readHead(
  tx: Tx, f: Fixtures, externalId = EXTERNAL_ID,
): Promise<ObservationHead | null> {
  const [row] = await tx<{
    versionSeq: number; payloadHash: string; hashRecipe: string;
    rawPayload: JsonValue; absentSince: Date | null;
  }[]>`
    SELECT r.current_version_seq  AS "versionSeq",
           r.current_payload_hash AS "payloadHash",
           p.hash_recipe          AS "hashRecipe",
           p.raw_payload          AS "rawPayload",
           r.absent_since         AS "absentSince"
      FROM staging.source_records r
      JOIN staging.source_payloads p
        ON p.source_id = r.source_id
       AND p.family    = r.family
       AND p.payload_hash = r.current_payload_hash
     WHERE r.source_id = ${f.sourceId}
       AND r.family = ${FAMILY}
       AND r.external_record_id = ${externalId}
  `;
  if (!row) return null;
  return {
    versionSeq: row.versionSeq,
    payloadHash: row.payloadHash,
    hashRecipe: row.hashRecipe,
    rawPayload: row.rawPayload,
    absentSince: row.absentSince === null ? null : row.absentSince.toISOString(),
  };
}

/**
 * Persist exactly what the decision says and nothing more.
 *
 * `unchanged` touches the record row only — no payload row, no version row —
 * which is invariant I1 expressed as SQL. `append_version` stores the
 * payload only when it is new content, closes the previous interval at the
 * same instant the next one opens, and appends a version whose identity is
 * `version_seq`, never the hash — invariant I2.
 */
async function apply(
  tx: Tx, f: Fixtures, decision: ObservationDecision,
  payload: JsonValue, observedAt: string, externalId = EXTERNAL_ID,
): Promise<void> {
  if (decision.action === 'unchanged') {
    await tx`
      UPDATE staging.source_records
         SET last_seen_at  = ${observedAt},
             last_batch_id = ${f.batchId},
             absent_since  = CASE WHEN ${decision.reappeared}::boolean
                                  THEN NULL ELSE absent_since END
       WHERE source_id = ${f.sourceId}
         AND family = ${FAMILY}
         AND external_record_id = ${externalId}
    `;
    return;
  }

  if (!decision.payloadAlreadyStored) {
    await tx`
      INSERT INTO staging.source_payloads
        (source_id, family, payload_hash, hash_recipe, raw_payload)
      VALUES (${f.sourceId}, ${FAMILY}, ${decision.payloadHash},
              ${decision.recipe}, ${jsonb(payload)})
    `;
  }

  if (decision.closesPreviousVersion) {
    await tx`
      UPDATE staging.source_record_versions
         SET observed_to = ${observedAt}, closed_by_batch_id = ${f.batchId}
       WHERE source_id = ${f.sourceId}
         AND family = ${FAMILY}
         AND external_record_id = ${externalId}
         AND observed_to IS NULL
    `;
  }

  await tx`
    INSERT INTO staging.source_record_versions
      (source_id, family, external_record_id, version_seq, payload_hash,
       source_updated_at, observed_from, opened_by_batch_id)
    VALUES (${f.sourceId}, ${FAMILY}, ${externalId}, ${decision.versionSeq},
            ${decision.payloadHash}, ${decision.sourceUpdatedAt},
            ${observedAt}, ${f.batchId})
  `;

  await tx`
    INSERT INTO staging.source_records
      (source_id, family, external_record_id, scope_key, current_version_seq,
       current_payload_hash, first_seen_at, last_seen_at, last_batch_id)
    VALUES (${f.sourceId}, ${FAMILY}, ${externalId},
            ${externalId === EXTERNAL_ID ? SCOPE : OTHER_SCOPE},
            ${decision.versionSeq}, ${decision.payloadHash},
            ${observedAt}, ${observedAt}, ${f.batchId})
    ON CONFLICT (source_id, family, external_record_id) DO UPDATE
      SET current_version_seq  = EXCLUDED.current_version_seq,
          current_payload_hash = EXCLUDED.current_payload_hash,
          last_seen_at         = EXCLUDED.last_seen_at,
          last_batch_id        = EXCLUDED.last_batch_id,
          absent_since         = NULL
  `;
}

/** One poll: read the stored head, decide from it, persist the decision. */
async function poll(
  tx: Tx, f: Fixtures, payload: JsonValue, observedAt: string,
  externalId = EXTERNAL_ID,
): Promise<ObservationDecision> {
  const head = await readHead(tx, f, externalId);
  const [known] = await tx<{ hashes: string[] }[]>`
    SELECT coalesce(array_agg(payload_hash), '{}') AS hashes
      FROM staging.source_payloads
     WHERE source_id = ${f.sourceId} AND family = ${FAMILY}
  `;
  const decision = decideObservation({
    contract,
    head,
    payload,
    observedAt,
    knownPayloadHashes: new Set(known.hashes),
  });
  await apply(tx, f, decision, payload, observedAt, externalId);
  return decision;
}

/** Row counts for this fixture's source only. */
async function counts(tx: Tx, f: Fixtures) {
  const [row] = await tx<{
    payloads: number; versions: number; open: number; records: number;
  }[]>`
    SELECT (SELECT count(*) FROM staging.source_payloads
             WHERE source_id = ${f.sourceId})::int AS payloads,
           (SELECT count(*) FROM staging.source_record_versions
             WHERE source_id = ${f.sourceId})::int AS versions,
           (SELECT count(*) FROM staging.source_record_versions
             WHERE source_id = ${f.sourceId} AND observed_to IS NULL)::int AS open,
           (SELECT count(*) FROM staging.source_records
             WHERE source_id = ${f.sourceId})::int AS records
  `;
  return row;
}

/* ------------------------------------------------------------------ *
 * Fail-closed sentinel
 * ------------------------------------------------------------------ */

describe('ISSUE-096 spine — the database is actually migrated through 074', () => {
  it('has all five relations migration 074 creates', async () => {
    // Without this the suites below would fail with a relation-does-not-exist
    // error on a database that never ran 074, which reads as a broken test
    // rather than an unmigrated database.
    const rows = await sql<{ schema: string; name: string }[]>`
      SELECT n.nspname AS schema, c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND (n.nspname, c.relname) IN (
               ('staging', 'source_payloads'),
               ('staging', 'source_record_versions'),
               ('staging', 'source_records'),
               ('public',  'promotion_candidates'),
               ('public',  'promotion_decisions'))
       ORDER BY 1, 2
    `;
    expect(
      rows.map((r) => `${r.schema}.${r.name}`),
      'migration 074 is not applied to this database; run npm run db:migrate:test',
    ).toEqual([
      'public.promotion_candidates',
      'public.promotion_decisions',
      'staging.source_payloads',
      'staging.source_record_versions',
      'staging.source_records',
    ]);
  });

  it('gives the spine no way to reach canonical data on its own', async () => {
    // The §5.H "0 canonical writes" clause, proved from the catalogue rather
    // than from the migration's text: no trigger and no rule exists on any
    // of the five relations, so storing an observation cannot fan out into
    // anything else whatever a future caller does.
    const automation = await sql<{ name: string; kind: string }[]>`
      SELECT c.relname AS name, 'trigger' AS kind
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal
         AND n.nspname IN ('staging', 'public')
         AND c.relname = ANY(${[
    'source_payloads', 'source_record_versions', 'source_records',
    'promotion_candidates', 'promotion_decisions',
  ]})
      UNION ALL
      SELECT c.relname, 'rule'
        FROM pg_rewrite r
        JOIN pg_class c ON c.oid = r.ev_class
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE r.rulename <> '_RETURN'
         AND n.nspname IN ('staging', 'public')
         AND c.relname = ANY(${[
    'source_payloads', 'source_record_versions', 'source_records',
    'promotion_candidates', 'promotion_decisions',
  ]})
    `;
    expect(automation).toEqual([]);
  });

  it('lets no foreign key erase observation history by cascade', async () => {
    // Every foreign key on the five relations must be NO ACTION on delete
    // and on update (confdeltype/confupdtype 'a'). A cascade anywhere here
    // would let a parent-side delete silently remove recorded history, which
    // is the one thing this model exists to prevent.
    const rows = await sql<{ child: string; name: string; del: string; upd: string }[]>`
      SELECT rel.relname AS child, con.conname AS name,
             con.confdeltype AS del, con.confupdtype AS upd
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
       WHERE con.contype = 'f'
         AND n.nspname IN ('staging', 'public')
         AND rel.relname = ANY(${[
    'source_payloads', 'source_record_versions', 'source_records',
    'promotion_candidates', 'promotion_decisions',
  ]})
         AND (con.confdeltype <> 'a' OR con.confupdtype <> 'a')
       ORDER BY 1, 2
    `;
    expect(rows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * §5.H idempotence (the observation half)
 * ------------------------------------------------------------------ */

describe('ISSUE-096 §5.H — an unchanged poll writes no history', () => {
  it('touches the record row only, leaving payloads and versions untouched', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      const first = await poll(tx, f, A, T.first);
      expect(first).toMatchObject({ action: 'append_version', versionSeq: 1 });
      expect(await counts(tx, f)).toEqual({
        payloads: 1, versions: 1, open: 1, records: 1,
      });

      // The identical payload again: I1. The head this decision is taken
      // from is the one PostgreSQL stored, so a write that left the record
      // pointing at the wrong version would append here rather than pass.
      const again = await poll(tx, f, A, T.second);
      expect(again).toMatchObject({ action: 'unchanged', versionSeq: 1 });

      expect(
        await counts(tx, f),
        'an unchanged poll created history it must not create',
      ).toEqual({ payloads: 1, versions: 1, open: 1, records: 1 });

      const [record] = await tx<{
        seq: number; lastSeen: Date; firstSeen: Date; absent: Date | null;
      }[]>`
        SELECT current_version_seq AS seq, last_seen_at AS "lastSeen",
               first_seen_at AS "firstSeen", absent_since AS absent
          FROM staging.source_records
         WHERE source_id = ${f.sourceId} AND external_record_id = ${EXTERNAL_ID}
      `;
      expect(record.seq).toBe(1);
      expect(record.absent).toBeNull();
      // last_seen_at advanced; first_seen_at did not move.
      expect(record.lastSeen.toISOString()).toBe(new Date(T.second).toISOString());
      expect(record.firstSeen.toISOString()).toBe(new Date(T.first).toISOString());

      // The open version's interval is untouched by an unchanged poll.
      const [version] = await tx<{ from: Date; to: Date | null }[]>`
        SELECT observed_from AS "from", observed_to AS "to"
          FROM staging.source_record_versions
         WHERE source_id = ${f.sourceId} AND version_seq = 1
      `;
      expect(version.from.toISOString()).toBe(new Date(T.first).toISOString());
      expect(version.to).toBeNull();
    });
  });
});

/* ------------------------------------------------------------------ *
 * §5.H correction replay
 * ------------------------------------------------------------------ */

describe('ISSUE-096 §5.H — A -> B -> A is three states over two payloads', () => {
  it('keeps three ordered versions, chained with no gap and no overlap', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);
      await poll(tx, f, B, T.second);
      // The returning A: content PostgreSQL already stores. The payload row
      // is reused and the version row is still appended -- the transition
      // that a UNIQUE on (record, payload_hash) would have destroyed.
      const back = await poll(tx, f, A, T.third);
      expect(back).toMatchObject({
        action: 'append_version', versionSeq: 3, payloadAlreadyStored: true,
      });

      expect(
        await counts(tx, f),
        'A -> B -> A must be THREE version rows over TWO payload rows',
      ).toEqual({ payloads: 2, versions: 3, open: 1, records: 1 });

      const versions = await tx<{
        seq: number; hash: string; from: Date; to: Date | null;
        openedBy: ImportBatchId; closedBy: ImportBatchId | null;
      }[]>`
        SELECT version_seq AS seq, payload_hash AS hash,
               observed_from AS "from", observed_to AS "to",
               opened_by_batch_id AS "openedBy",
               closed_by_batch_id AS "closedBy"
          FROM staging.source_record_versions
         WHERE source_id = ${f.sourceId} AND external_record_id = ${EXTERNAL_ID}
         ORDER BY version_seq
      `;
      expect(versions.map((v) => v.seq)).toEqual([1, 2, 3]);
      // The third state is the first state's content, stored once.
      expect(versions[2].hash).toBe(versions[0].hash);
      expect(versions[1].hash).not.toBe(versions[0].hash);
      // The chain: each closed interval ends exactly where the next opens,
      // and only the last is open.
      expect(versions[0].to?.toISOString()).toBe(versions[1].from.toISOString());
      expect(versions[1].to?.toISOString()).toBe(versions[2].from.toISOString());
      expect(versions[2].to).toBeNull();
      expect(versions[2].closedBy).toBeNull();
      expect(versions.slice(0, 2).every((v) => v.closedBy === f.batchId)).toBe(true);
      expect(versions.every((v) => v.openedBy === f.batchId)).toBe(true);

      // The head names the last version, and that version's payload is the
      // one stored under the head's hash.
      const head = await readHead(tx, f);
      expect(head?.versionSeq).toBe(3);
      expect(head?.payloadHash).toBe(versions[2].hash);
    });
  });

  it('refuses a second open version for the same external record', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);
      // ux_source_record_versions_open is what makes the interval chain
      // gapless and overlap-free: opening version 2 without closing 1 is
      // not a bug to be found by reading, it is unrepresentable.
      const message = await expectRefused(tx, 'second open version', (sp) => sp`
        INSERT INTO staging.source_record_versions
          (source_id, family, external_record_id, version_seq, payload_hash,
           observed_from, opened_by_batch_id)
        SELECT source_id, family, external_record_id, 2, payload_hash,
               ${T.second}, ${f.batchId}
          FROM staging.source_record_versions
         WHERE source_id = ${f.sourceId} AND version_seq = 1
      `);
      expect(message).toContain('ux_source_record_versions_open');
    });
  });

  it('refuses a closed version that names no closing batch', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);
      const message = await expectRefused(tx, 'closed without a batch', (sp) => sp`
        UPDATE staging.source_record_versions
           SET observed_to = ${T.second}
         WHERE source_id = ${f.sourceId} AND version_seq = 1
      `);
      expect(message).toContain('source_record_versions_close_ck');
    });
  });
});

/* ------------------------------------------------------------------ *
 * §5.H absence is not deletion
 * ------------------------------------------------------------------ */

describe('ISSUE-096 §5.H — absence is a record-grain signal, never a deletion', () => {
  it('stamps only the record row, inside the enumerated scope, losing no history', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);
      await poll(tx, f, B, T.second);
      // A second record in a scope this sweep does NOT enumerate.
      await poll(tx, f, A, T.first, OTHER_ID);
      const before = await counts(tx, f);

      const candidates = await tx<{
        externalRecordId: string; scopeKey: string; lastSeenAt: Date;
        absentSince: Date | null;
      }[]>`
        SELECT external_record_id AS "externalRecordId", scope_key AS "scopeKey",
               last_seen_at AS "lastSeenAt", absent_since AS "absentSince"
          FROM staging.source_records
         WHERE source_id = ${f.sourceId}
      `;
      const absent = sweepAbsences({
        enumeratedScopeKeys: [SCOPE],
        batchStartedAt: T.sweep,
        records: candidates.map((row) => ({
          externalRecordId: row.externalRecordId,
          scopeKey: row.scopeKey,
          lastSeenAt: row.lastSeenAt.toISOString(),
          absentSince: row.absentSince === null ? null : row.absentSince.toISOString(),
        })),
      });
      // The un-enumerated scope is not a candidate: a fetch that never
      // looked cannot assert absence.
      expect(absent).toEqual([EXTERNAL_ID]);

      await tx`
        UPDATE staging.source_records
           SET absent_since = ${T.sweep}
         WHERE source_id = ${f.sourceId}
           AND external_record_id = ANY(${absent})
      `;

      // Absence deleted nothing: every payload, version and record row the
      // source ever produced is still there.
      expect(await counts(tx, f)).toEqual(before);

      const rows = await tx<{ id: string; absent: Date | null }[]>`
        SELECT external_record_id AS id, absent_since AS absent
          FROM staging.source_records
         WHERE source_id = ${f.sourceId}
         ORDER BY external_record_id
      `;
      expect(rows.find((r) => r.id === EXTERNAL_ID)?.absent).not.toBeNull();
      expect(rows.find((r) => r.id === OTHER_ID)?.absent).toBeNull();

      // The grain itself: absent_since exists on the record table and on
      // neither of the history tables, so no past payload can be said to
      // have disappeared.
      const columns = await sql<{ table: string }[]>`
        SELECT table_name AS "table"
          FROM information_schema.columns
         WHERE table_schema = 'staging'
           AND column_name = 'absent_since'
           AND table_name IN ('source_payloads', 'source_record_versions', 'source_records')
      `;
      expect(columns.map((c) => c.table)).toEqual(['source_records']);
    });
  });

  it('clears absence on reappearance without appending a version', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);
      await tx`
        UPDATE staging.source_records SET absent_since = ${T.sweep}
         WHERE source_id = ${f.sourceId} AND external_record_id = ${EXTERNAL_ID}
      `;
      const before = await counts(tx, f);

      // Unchanged content returns: absence clears, history does not move.
      const back = await poll(tx, f, A, T.back);
      expect(back).toMatchObject({ action: 'unchanged', versionSeq: 1, reappeared: true });
      expect(await counts(tx, f)).toEqual(before);

      const [record] = await tx<{ absent: Date | null; seq: number }[]>`
        SELECT absent_since AS absent, current_version_seq AS seq
          FROM staging.source_records
         WHERE source_id = ${f.sourceId} AND external_record_id = ${EXTERNAL_ID}
      `;
      expect(record.absent).toBeNull();
      expect(record.seq).toBe(1);
    });
  });

  it('refuses an absence candidate that proposes a canonical target', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);
      // Absence is a review signal, never a write. The baseline hash is
      // supplied so promotion_candidates_target_ck is satisfied and the
      // absent rule is the only one this row breaks.
      const message = await expectRefused(tx, 'absent candidate with a target', (sp) => sp`
        INSERT INTO promotion_candidates
          (source_id, family, external_record_id, source_version_seq, verb, season,
           target_table, target_id, baseline_canonical_hash, proposed_fields,
           created_by_batch_id)
        VALUES (${f.sourceId}, ${FAMILY}, ${EXTERNAL_ID}, 1, 'absent', ${f.season},
                'matches', 1, ${'a'.repeat(64)}, ${jsonb({})}, ${f.batchId})
      `);
      expect(message).toContain('promotion_candidates_absent_ck');
    });
  });
});

/* ------------------------------------------------------------------ *
 * §5.H foreign ownership and the stale-review race -- schema halves only
 * ------------------------------------------------------------------ */

describe('ISSUE-096 §5.H — the promotion queue refuses in the schema', () => {
  /**
   * A pending candidate for this fixture's observation version 1.
   *
   * `absent` proposes nothing by rule, so it carries an empty field set;
   * every other verb carries a real proposal. Neither writes canonical data:
   * a candidate is a queue row and the queue has no write path.
   */
  async function candidate(
    tx: Tx, f: Fixtures, verb: string, targetTable = 'matches',
  ): Promise<number> {
    const fields: JsonValue = verb === 'absent' ? {} : { home_score: 132 };
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO promotion_candidates
        (source_id, family, external_record_id, source_version_seq, verb, season,
         target_table, proposed_fields, created_by_batch_id)
      VALUES (${f.sourceId}, ${FAMILY}, ${EXTERNAL_ID}, 1, ${verb}, ${f.season},
              ${targetTable}, ${jsonb(fields)}, ${f.batchId})
      RETURNING id::int AS id
    `;
    return row.id;
  }

  /**
   * A real refusal decision. `decision` is never `'accept'` here: no accept
   * path exists in S1-S4 and none is created to make a test runnable.
   */
  async function refusalDecision(
    tx: Tx, f: Fixtures, candidateId: number,
    decision: 'reject' | 'requeue', reason: string | null,
  ): Promise<number> {
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO promotion_decisions
        (candidate_id, decision, refusal_reason, admin_user_id, note)
      VALUES (${candidateId}, ${decision}, ${reason}, ${f.adminUserId},
              'ISSUE-096 §5.H schema probe')
      RETURNING id::int AS id
    `;
    return row.id;
  }

  it('cannot represent an accepted refusal verb', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);

      // Every verb migration 074 bars from acceptance, one at a time. A
      // distinct target_table per verb keeps them out of each other's
      // pending slot; the rule under test is the verb, not the slot.
      for (const verb of ['absent', 'unresolved_identity', 'source_disagreement',
        'foreign_owned_collision', 'manual_authority_conflict', 'stale_review']) {
        const id = await candidate(tx, f, verb, `t_${verb}`);
        const decisionId = await refusalDecision(tx, f, id, 'reject', null);

        const message = await expectRefused(tx, `accepted ${verb}`, (sp) => sp`
          UPDATE promotion_candidates
             SET status = 'accepted', resolved_at = now(), resolved_decision_id = ${decisionId}
           WHERE id = ${id}
        `);
        expect(message).toContain('promotion_candidates_acceptable_ck');

        // Control: the same transition to a refusal status is accepted, so
        // the refusal above is the verb rule and not the workflow columns.
        await tx`
          UPDATE promotion_candidates
             SET status = 'rejected', resolved_at = now(), resolved_decision_id = ${decisionId}
           WHERE id = ${id}
        `;
      }

      const [row] = await tx<{ accepted: number }[]>`
        SELECT count(*)::int AS accepted
          FROM promotion_candidates
         WHERE source_id = ${f.sourceId} AND status = 'accepted'
      `;
      expect(row.accepted).toBe(0);
    });
  });

  it('holds exactly one live proposal per record and target, and frees it on supersession', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);
      const first = await candidate(tx, f, 'corrected');

      // A second pending proposal for the same record and target is the
      // duplicate a re-run must not stack.
      const message = await expectRefused(tx, 'second pending candidate',
        (sp) => sp`
          INSERT INTO promotion_candidates
            (source_id, family, external_record_id, source_version_seq, verb, season,
             target_table, proposed_fields, created_by_batch_id)
          VALUES (${f.sourceId}, ${FAMILY}, ${EXTERNAL_ID}, 1, 'corrected', ${f.season},
                  'matches', ${jsonb({ home_score: 133 })}, ${f.batchId})
        `);
      expect(message).toContain('ux_promotion_candidates_pending');

      // stale_review -> supersede: the S4 distinction with a real schema
      // consequence. Superseding frees the slot for the replacement.
      const decisionId = await refusalDecision(tx, f, first, 'requeue', 'stale_review');
      await tx`
        UPDATE promotion_candidates
           SET status = 'superseded', resolved_at = now(), resolved_decision_id = ${decisionId}
         WHERE id = ${first}
      `;
      const replacement = await candidate(tx, f, 'corrected');
      expect(replacement).not.toBe(first);

      const rows = await tx<{ status: string; n: number }[]>`
        SELECT status, count(*)::int AS n
          FROM promotion_candidates
         WHERE source_id = ${f.sourceId}
         GROUP BY status ORDER BY status
      `;
      expect(rows).toEqual([
        { status: 'pending', n: 1 },
        { status: 'superseded', n: 1 },
      ]);
    });
  });

  it('refuses a resolved candidate that names no decision, and a requeue with no reason', async () => {
    await inRolledBackTransaction(async (tx, f) => {
      await poll(tx, f, A, T.first);
      const id = await candidate(tx, f, 'corrected');

      // A resolution must name the decision that caused it: the audit trail
      // cannot be broken by moving the status alone.
      const orphan = await expectRefused(tx, 'resolved with no decision', (sp) => sp`
        UPDATE promotion_candidates
           SET status = 'rejected', resolved_at = now()
         WHERE id = ${id}
      `);
      expect(orphan).toContain('promotion_candidates_decision_ck');

      // A requeue is a refusal and must say why -- both stale reasons in the
      // S4 vocabulary are storable, and no reason at all is not.
      const noReason = await expectRefused(tx, 'requeue with no reason', (sp) => sp`
        INSERT INTO promotion_decisions (candidate_id, decision, admin_user_id)
        VALUES (${id}, 'requeue', ${f.adminUserId})
      `);
      expect(noReason).toContain('promotion_decisions_requeue_ck');

      for (const reason of ['stale_review', 'stale_canonical_target']) {
        const decisionId = await refusalDecision(tx, f, id, 'requeue', reason);
        expect(decisionId).toBeGreaterThan(0);
      }

      // A reason outside the recorded vocabulary is not storable at all.
      const unknown = await expectRefused(tx, 'unknown refusal reason', (sp) => sp`
        INSERT INTO promotion_decisions
          (candidate_id, decision, refusal_reason, admin_user_id)
        VALUES (${id}, 'requeue', 'because_i_said_so', ${f.adminUserId})
      `);
      expect(unknown).toContain('promotion_decisions_reason_ck');
    });
  });
});
