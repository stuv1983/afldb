/**
 * AFLDB V2 Stage 4 (plan D6, ADR 0006) — the Coleman publisher on an in-memory PGlite database.
 *
 * What runs for real here: migration 112 (`src/db/migrations/112_derived_award_results.sql`) is
 * applied VERBATIM from disk, its constraints and indexes are exercised, its grants run against
 * labelled STUB roles under `SET ROLE`, and the REAL publisher SQL (`publishColemanResult`) runs
 * through the PGlite executor as the stub `afldb_import` role.
 *
 * What does NOT: everything the stub prerequisites below stand in for. `auth_users`, `players` and
 * `award_winners` are STUBS written for this test (plan D2, review R-017), not migrations 001-111;
 * the real roles, `afldb_meta` and `npm run db:privileges` are not available, so the migration's
 * grants are proved against stub roles only. Migration 112 is therefore UNEXECUTED ON POSTGRESQL.
 * Nothing here touches a real PostgreSQL instance: PGlite is in-memory (no dataDir).
 *
 * FIXTURES ARE SYNTHETIC (tests/v2-coleman-publication-fixtures.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { TransactionalSqlExecutor } from '@afldb/db';
import { publishColemanResult, serialiseColemanDerivation, type ColemanPublicationRequest } from '@afldb/derived';
import { createInMemoryPglite, pgliteExecutor, type InMemoryPglite } from '@afldb/testing';

import {
  ADMIN,
  CORRECTION_NOTE,
  SEASON,
  SUPER_ADMIN,
  correction,
  derive,
  makeInput,
  synthFacts,
  synthPath,
} from './v2-coleman-publication-fixtures';

const MIGRATION = join(process.cwd(), 'src', 'db', 'migrations', '112_derived_award_results.sql');
// Migration 114 adds derived_award_projections (references 112) and, in its section 2, widens three
// migration-111 constraints, so it only applies on top of 111 (which depends only on auth_users).
// Order: 111, 112, 114.
const MIGRATION_111 = join(process.cwd(), 'src', 'db', 'migrations', '111_curated_award_proposals.sql');
const MIGRATION_114 = join(process.cwd(), 'src', 'db', 'migrations', '114_award_projections_and_curated_revisions.sql');

/* STUB prerequisites: minimal stand-ins, NOT the real schema. */
const STUB_PREREQUISITES = `
  -- STUB roles: the real ones come from the repository's role setup, not from a migration.
  CREATE ROLE afldb_import NOLOGIN;
  CREATE ROLE afldb_auth NOLOGIN;
  CREATE ROLE afldb_app NOLOGIN;

  -- STUB auth_users (real: migration 023 and later).
  CREATE TABLE auth_users (id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, email text NOT NULL);
  -- STUB players / award_winners: they exist only to prove that a TRUNCATE ... CASCADE of the
  -- football tables does not reach the ledger (it has no foreign key into them).
  CREATE TABLE players (id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, display_name text NOT NULL);
  CREATE TABLE award_winners (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    player_id integer REFERENCES players(id), player_name_raw text NOT NULL, season smallint NOT NULL);

  -- STUB reads the real import-writable registry would give afldb_import; award_winners is
  -- SELECT-only so the "publisher never writes award_winners" proof is also a privilege proof.
  GRANT SELECT ON auth_users, players, award_winners TO afldb_import;

  -- STUB seed (SYNTHETIC).
  INSERT INTO auth_users (email) VALUES ('super@example.invalid'), ('other@example.invalid');
  INSERT INTO players (display_name) VALUES ('Synthetic Player One');
  INSERT INTO award_winners (player_id, player_name_raw, season) VALUES (1, 'Synthetic Player One', 2024);
`;

let db: InMemoryPglite;

async function one<T extends object>(text: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(text, params);
  return rows[0];
}
async function count(table = 'derived_award_results'): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).n;
}

beforeAll(async () => {
  db = await createInMemoryPglite();
  await db.exec(STUB_PREREQUISITES);
  // The migration under test, applied VERBATIM from disk (not edited to suit PGlite).
  await db.exec(readFileSync(MIGRATION_111, 'utf8'));
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(readFileSync(MIGRATION_114, 'utf8'));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.query('RESET ROLE');
  await db.exec('TRUNCATE derived_award_projections, derived_award_results RESTART IDENTITY');
});

async function asImport<T>(fn: () => Promise<T>): Promise<T> {
  await db.query('SET ROLE afldb_import');
  try {
    return await fn();
  } finally {
    await db.query('RESET ROLE');
  }
}

async function expectRejected(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}

/* ------------------------------------------------------------------ *
 * Raw row helpers (constraint tests insert directly, as the superuser)
 * ------------------------------------------------------------------ */

interface RowValues {
  award_slug: string; season: number; method_version: number; derivation_version: string;
  input_checksum: string; result: string; winners: string; derived_at: string; published_by: number;
  basis: string; correction: string; supersedes_id: number | null;
  /** Test-only: force an id (OVERRIDING SYSTEM VALUE) to stage a supersedes_id >= id. */
  id?: number;
}

function validRow(over: Partial<RowValues> = {}): RowValues {
  const d = derive();
  return {
    award_slug: 'coleman',
    season: d.season,
    method_version: d.methodVersion,
    derivation_version: d.derivationVersion,
    input_checksum: d.inputChecksum,
    result: serialiseColemanDerivation(d),
    winners: JSON.stringify(d.winners),
    derived_at: d.derivedAt,
    published_by: 1,
    basis: 'audited_correction',
    correction: JSON.stringify({
      season: d.season, workflow: 'derived_award_publication', actorUserId: 1, note: CORRECTION_NOTE, evidenceRef: 'SYNTHETIC-EVIDENCE-1',
    }),
    supersedes_id: null,
    ...over,
  };
}

async function insertRaw(over: Partial<RowValues> = {}): Promise<number> {
  const v = validRow(over);
  const forced = v.id !== undefined;
  const row = await one<{ id: number }>(
    `INSERT INTO derived_award_results
       (${forced ? 'id, ' : ''}award_slug, season, method_version, derivation_version, input_checksum, result, winners,
        derived_at, published_by, basis, correction, supersedes_id)
     ${forced ? 'OVERRIDING SYSTEM VALUE' : ''}
     VALUES (${forced ? '$13, ' : ''}$1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz, $9, $10, $11::jsonb, $12)
     RETURNING id::int AS id`,
    [v.award_slug, v.season, v.method_version, v.derivation_version, v.input_checksum, v.result, v.winners,
      v.derived_at, v.published_by, v.basis, v.correction, v.supersedes_id, ...(forced ? [v.id] : [])],
  );
  return row.id;
}

/** The result jsonb with fields overridden, as the string insertRaw takes. */
function resultWith(over: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(serialiseColemanDerivation(derive())), ...over });
}
function correctionWith(over: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(validRow().correction), ...over });
}
/** A row whose season is consistent everywhere (column, result and audit record), so only the season CHECK can fail. */
function forSeason(season: number): Partial<RowValues> {
  return { season, result: resultWith({ season }), correction: correctionWith({ season }) };
}

/* =============================================================================================
 * 1. Migration 112's constraints, on the real file
 * =========================================================================================== */
describe('migration 112 applied verbatim to PGlite: structure and constraints', () => {
  it('is additive and its ROLLBACK block is comments only', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const code = sql.split(/\r?\n/).filter((line) => !/^\s*--/.test(line)).join('\n')
      .replace(/'(?:[^']|'')*'/g, "''"); // a COMMENT ON string may say UPDATE; only code matters
    expect(code).not.toMatch(/\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b/i);
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect([...code.matchAll(/CREATE\s+TABLE\s+([a-z_]+)/gi)].map((m) => m[1])).toEqual(['derived_award_results']);
    const rollback = sql.split(/\r?\n/).filter((line) => /ROLLBACK/.test(line));
    expect(rollback.length).toBeGreaterThan(3);
    for (const line of rollback) expect(line).toMatch(/^--\s*ROLLBACK/);
    // 097-style deploy order is stated.
    expect(sql).toMatch(/apply this migration, THEN\s*--\s*run `npm run db:privileges`/);
  });

  it('has no foreign key into the football tables: only auth_users and itself', async () => {
    const targets = await db.query<{ target: string }>(
      `SELECT DISTINCT confrelid::regclass::text AS target FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'derived_award_results'::regclass ORDER BY 1`);
    expect(targets.rows.map((r) => r.target)).toEqual(['auth_users', 'derived_award_results']);
  });

  it('survives a TRUNCATE ... CASCADE of the football tables (the rebuild reason)', async () => {
    await insertRaw();
    await db.exec('TRUNCATE players, award_winners RESTART IDENTITY CASCADE');
    expect(await count()).toBe(1);
    expect(await count('players')).toBe(0);
    // restore the stub rows other tests may read
    await db.exec(`INSERT INTO players (display_name) VALUES ('Synthetic Player One');
                   INSERT INTO award_winners (player_id, player_name_raw, season) VALUES (1, 'Synthetic Player One', 2024)`);
  });

  it('indexes every foreign-key column (the supersedes column leads a unique index)', async () => {
    const unindexed = await db.query<{ col: string }>(
      `SELECT a.attname AS col
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.conrelid = 'derived_award_results'::regclass
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`);
    expect(unindexed.rows).toEqual([]);
    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'derived_award_results' ORDER BY 1`);
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'derived_award_results_pkey', 'derived_award_results_target_uq', 'ix_derived_award_results_published_by',
      'ix_derived_award_results_target', 'uq_derived_award_results_root', 'uq_derived_award_results_supersedes',
    ]);
  });

  it('accepts a valid first publication and defaults published_at', async () => {
    const id = await insertRaw();
    const row = await one<{ id: number; published_at: string | null; supersedes_id: number | null }>(
      'SELECT id::int AS id, published_at, supersedes_id::int AS supersedes_id FROM derived_award_results');
    expect(row.id).toBe(id);
    expect(row.published_at).not.toBeNull();
    expect(row.supersedes_id).toBeNull();
  });

  it('refuses a bad award slug, season, method version, derivation version, checksum and basis', async () => {
    await expectRejected(insertRaw({ award_slug: 'brownlow-medal' }), /derived_award_results_award_slug_ck/);
    await expectRejected(insertRaw(forSeason(1896)), /derived_award_results_season_ck/);
    await expectRejected(insertRaw(forSeason(2101)), /derived_award_results_season_ck/);
    await expectRejected(insertRaw({ method_version: 0 }), /derived_award_results_method_version_ck/);
    await expectRejected(insertRaw({ derivation_version: '   ' }), /derived_award_results_derivation_version_ck/);
    await expectRejected(insertRaw({ input_checksum: 'A'.repeat(64) }), /derived_award_results_input_checksum_ck/);
    await expectRejected(insertRaw({ input_checksum: 'a'.repeat(63) }), /derived_award_results_input_checksum_ck/);
    await expectRejected(insertRaw({ basis: 'open_season' }), /derived_award_results_basis_ck/);
    expect(await count()).toBe(0);
  });

  it('refuses a result that is not an object or winners that are not an array', async () => {
    await expectRejected(insertRaw({ result: '[]' }), /derived_award_results_result_ck/);
    // winners = result -> 'winners' also fails for a non-array, so either CHECK may report it.
    await expectRejected(insertRaw({ winners: '{}' }), /derived_award_results_(winners|self_consistent)_ck/);
    await expectRejected(insertRaw({ winners: 'null' }), /derived_award_results_(winners|self_consistent)_ck/);
  });

  it('refuses a row that disagrees with the result it summarises (and a result that omits a key)', async () => {
    await expectRejected(insertRaw({ input_checksum: 'f'.repeat(64) }), /derived_award_results_self_consistent_ck/);
    await expectRejected(insertRaw({ derivation_version: 'v2.coleman.other' }), /derived_award_results_self_consistent_ck/);
    await expectRejected(insertRaw({ season: 2023 }), /derived_award_results_self_consistent_ck|derived_award_results_correction_ck/);
    await expectRejected(insertRaw({ method_version: 2 }), /derived_award_results_self_consistent_ck/);
    await expectRejected(insertRaw({ winners: '[]' }), /derived_award_results_self_consistent_ck/);
    // A key missing from result yields NULL; the CHECK must FAIL on it, not pass.
    const withoutChecksum = JSON.parse(serialiseColemanDerivation(derive())) as Record<string, unknown>;
    delete withoutChecksum.inputChecksum;
    await expectRejected(insertRaw({ result: JSON.stringify(withoutChecksum) }), /derived_award_results_self_consistent_ck/);
    await expectRejected(insertRaw({ result: JSON.stringify({}), winners: '[]' }), /derived_award_results_self_consistent_ck/);
    expect(await count()).toBe(0);
  });

  it('refuses an audit record that is not the seal record for this workflow, season and actor', async () => {
    await expectRejected(insertRaw({ correction: correctionWith({ workflow: 'data_editor' }) }), /derived_award_results_correction_ck/);
    await expectRejected(insertRaw({ correction: correctionWith({ actorUserId: 2 }) }), /derived_award_results_correction_ck/);
    await expectRejected(insertRaw({ correction: correctionWith({ season: 2023 }) }), /derived_award_results_correction_ck/);
    await expectRejected(insertRaw({ correction: correctionWith({ note: 'too short' }) }), /derived_award_results_correction_ck/);
    await expectRejected(insertRaw({ correction: correctionWith({ evidenceRef: '  ' }) }), /derived_award_results_correction_ck/);
    await expectRejected(insertRaw({ correction: JSON.stringify({ workflow: 'derived_award_publication' }) }), /derived_award_results_correction_ck/);
    await expectRejected(insertRaw({ correction: '[]' }), /derived_award_results_correction_ck/);
    expect(await count()).toBe(0);
  });

  it('refuses an unknown publisher (foreign key to auth_users)', async () => {
    await expectRejected(insertRaw({ published_by: 999, correction: correctionWith({ actorUserId: 999 }) }), /foreign key|violates/i);
  });

  it('keeps ONE linear chain per (award, season): one root, one successor each, same season, no cycle', async () => {
    const rootId = await insertRaw();
    // A second first-publication of the same season is refused.
    await expectRejected(insertRaw(), /uq_derived_award_results_root/);
    // A successor is allowed once...
    const secondId = await insertRaw({ supersedes_id: rootId });
    expect(secondId).toBeGreaterThan(rootId);
    // ...never twice (no branching),
    await expectRejected(insertRaw({ supersedes_id: rootId }), /uq_derived_award_results_supersedes/);
    // a predecessor must exist and be the SAME season (composite foreign key),
    await expectRejected(insertRaw({ id: 50, supersedes_id: 40 }), /derived_award_results_supersedes_fk/);
    const otherSeason = await insertRaw({
      season: 2023,
      result: resultWith({ season: 2023 }),
      correction: correctionWith({ season: 2023 }),
    });
    await expectRejected(insertRaw({ supersedes_id: otherSeason }), /uq_derived_award_results_supersedes|derived_award_results_supersedes_fk/);
    // and a row cannot supersede a later id (no cycles).
    await db.exec('TRUNCATE derived_award_projections, derived_award_results RESTART IDENTITY');
    await insertRaw({ id: 5 });
    await expectRejected(insertRaw({ id: 3, season: 2024, supersedes_id: 5 }), /derived_award_results_supersedes_ck/);
  });
});

/* =============================================================================================
 * 2. Grants — executed against STUB roles
 * =========================================================================================== */
describe('migration 112 grants, executed against stub roles', () => {
  it('has_*_privilege matches the intended least-privilege model', async () => {
    const priv = async (role: string, privilege: string) =>
      (await one<{ p: boolean }>(`SELECT has_table_privilege($1::name, 'derived_award_results', $2::text) AS p`, [role, privilege])).p;
    expect(await priv('afldb_import', 'SELECT')).toBe(true);
    expect(await priv('afldb_import', 'INSERT')).toBe(true);
    for (const p of ['UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('afldb_import', p), `import ${p}`).toBe(false);
    const anyColumnUpdate = await one<{ p: boolean }>(
      `SELECT has_any_column_privilege('afldb_import'::name, 'derived_award_results', 'UPDATE') AS p`);
    expect(anyColumnUpdate.p).toBe(false);
    expect(await priv('afldb_auth', 'SELECT')).toBe(true);
    for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('afldb_auth', p), `auth ${p}`).toBe(false);
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('afldb_app', p), `app ${p}`).toBe(false);
    const seq = (await one<{ p: boolean }>(
      `SELECT has_sequence_privilege('afldb_import'::name, 'derived_award_results_id_seq', 'USAGE') AS p`)).p;
    expect(seq).toBe(true);
  });

  it('as afldb_import: can insert and read, can never update, delete or truncate', async () => {
    const id = await asImport(async () => {
      const inserted = await insertRaw();
      expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM derived_award_results')).n).toBe(1);
      await expectRejected(db.query(`UPDATE derived_award_results SET basis = 'x' WHERE id = $1`, [inserted]), /permission denied/);
      await expectRejected(db.query(`UPDATE derived_award_results SET published_by = 2 WHERE id = $1`, [inserted]), /permission denied/);
      await expectRejected(db.query('DELETE FROM derived_award_results'), /permission denied/);
      await expectRejected(db.query('TRUNCATE derived_award_results'), /permission denied/);
      return inserted;
    });
    expect(id).toBeGreaterThan(0);
  });

  it('as afldb_app: cannot read; as afldb_auth: can read, cannot write', async () => {
    await insertRaw();
    await db.query('SET ROLE afldb_app');
    await expectRejected(db.query('SELECT count(*) FROM derived_award_results'), /permission denied/);
    await db.query('RESET ROLE');
    await db.query('SET ROLE afldb_auth');
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM derived_award_results')).n).toBe(1);
    await expectRejected(insertRaw(), /permission denied/);
    await db.query('RESET ROLE');
  });
});

/* =============================================================================================
 * 3. The REAL publisher SQL, through the PGlite executor, as the stub afldb_import role
 * =========================================================================================== */
function request(over: Partial<ColemanPublicationRequest> = {}): ColemanPublicationRequest {
  return { derivation: makeInput(), correction: correction(), publishedBy: 1, viewer: SUPER_ADMIN, ...over };
}

async function publish(over: Partial<ColemanPublicationRequest> = {}, executor: TransactionalSqlExecutor = pgliteExecutor(db)) {
  return asImport(() => publishColemanResult(executor, request(over)));
}

async function rows() {
  return (await db.query<{
    id: number; supersedes_id: number | null; input_checksum: string; derivation_version: string; method_version: number;
    winners: { key: string; goals: number }[]; result: { leaderboard: unknown[]; counts: unknown; inputs: unknown };
    correction: { workflow: string; actorUserId: number }; published_by: number; basis: string;
  }>(`SELECT id::int AS id, supersedes_id::int AS supersedes_id, input_checksum, derivation_version, method_version,
             winners, result, correction, published_by, basis
        FROM derived_award_results ORDER BY id`)).rows;
}

describe('publishColemanResult on PGlite (real publisher SQL, stub role afldb_import)', () => {
  it('first publication: one row, the versions and checksum recorded, the full result and the audit record', async () => {
    const outcome = await publish();
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    expect(outcome).toMatchObject({ outcome: 'published', supersededId: null, season: SEASON });
    const [row] = await rows();
    const d = derive();
    expect(await count()).toBe(1);
    expect(row.id).toBe(outcome.id);
    expect(row.supersedes_id).toBeNull();
    expect(row.derivation_version).toBe(d.derivationVersion);
    expect(row.method_version).toBe(d.methodVersion);
    expect(row.input_checksum).toBe(d.inputChecksum);
    expect(row.basis).toBe('audited_correction');
    expect(row.published_by).toBe(1);
    expect(row.correction).toMatchObject({ workflow: 'derived_award_publication', actorUserId: 1 });
    expect(row.winners.map((w) => w.key)).toEqual([`coleman:${SEASON}:${synthPath('A')}`]);
    // The stored result is the complete derivation: leaderboard, counts and the exact inputs.
    expect(row.result).toEqual(JSON.parse(serialiseColemanDerivation(d)));
  });

  it('an identical recompute writes no new row: unchanged, and the existing id is returned', async () => {
    const first = await publish();
    if (!first.ok) throw new Error(first.refusal.message);
    const again = await publish({ derivation: makeInput({ derivedAt: '2027-05-06T07:08:09Z' }) });
    if (!again.ok) throw new Error(again.refusal.message);
    expect(again).toMatchObject({ outcome: 'unchanged', id: first.id, supersededId: null });
    expect(await count()).toBe(1);
    // Row order of the inputs is irrelevant to the recompute.
    const reordered = await publish({
      derivation: makeInput({ playerMatchGoals: [...synthFacts()].reverse() }),
    });
    expect(reordered).toMatchObject({ ok: true, outcome: 'unchanged' });
    expect(await count()).toBe(1);
  });

  it('corrected statistics supersede: a new row names the old, and the old row is untouched', async () => {
    const first = await publish();
    if (!first.ok) throw new Error(first.refusal.message);
    const before = (await rows())[0];
    // The leader loses two goals: A, C, E and G now tie on 3 and every one of them wins.
    const corrected = await publish({ derivation: makeInput({ playerMatchGoals: synthFacts({ '11:3': 0 }) }) });
    if (!corrected.ok) throw new Error(corrected.refusal.message);
    expect(corrected).toMatchObject({ outcome: 'superseded', supersededId: first.id });
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual(before);
    expect(all[1].supersedes_id).toBe(first.id);
    expect(all[1].winners.map((w) => w.key)).toEqual(
      ['A', 'C', 'E', 'G'].map((letter) => `coleman:${SEASON}:${synthPath(letter)}`),
    );
    expect(all[1].input_checksum).not.toBe(before.input_checksum);
    // The current row is now the newer one: recomputing the corrected facts is unchanged...
    const again = await publish({ derivation: makeInput({ playerMatchGoals: synthFacts({ '11:3': 0 }) }) });
    expect(again).toMatchObject({ ok: true, outcome: 'unchanged', id: corrected.id });
    // ...and putting the original facts back is a further supersession, extending the chain.
    const reverted = await publish();
    if (!reverted.ok) throw new Error(reverted.refusal.message);
    expect(reverted).toMatchObject({ outcome: 'superseded', supersededId: corrected.id });
    expect((await rows()).map((r) => r.supersedes_id)).toEqual([null, first.id, corrected.id]);
  });

  it('a tie publishes every joint winner; a finals-only haul changes nothing', async () => {
    const tie = await publish({ derivation: makeInput({ playerMatchGoals: synthFacts({ '12:1': 4 }) }) });
    if (!tie.ok) throw new Error(tie.refusal.message);
    expect((await rows())[0].winners.map((w) => [w.key, w.goals])).toEqual([
      [`coleman:${SEASON}:${synthPath('A')}`, 5], [`coleman:${SEASON}:${synthPath('B')}`, 5],
    ]);
    await db.exec('TRUNCATE derived_award_projections, derived_award_results RESTART IDENTITY');
    const finals = await publish({ derivation: makeInput({ playerMatchGoals: synthFacts({ '14:5': 9 }) }) });
    if (!finals.ok) throw new Error(finals.refusal.message);
    expect((await rows())[0].winners.map((w) => w.key)).toEqual([`coleman:${SEASON}:${synthPath('A')}`]);
  });

  it('a different season has its own chain', async () => {
    await publish();
    expect(await count()).toBe(1);
    // 2023 is also sealed; the SYNTHETIC matches carry the season label.
    const matches = makeInput().matches.map((m) => ({ ...m, season: 2023 }));
    const other = await publish({ derivation: makeInput({ season: 2023, matches }), correction: correction() });
    expect(other).toMatchObject({ ok: true, outcome: 'published', season: 2023 });
    expect((await rows()).map((r) => r.supersedes_id)).toEqual([null, null]);
  });

  it('never writes award_winners (and could not: the stub role only holds SELECT there)', async () => {
    const before = await one<{ n: number }>('SELECT count(*)::int AS n FROM award_winners');
    await publish();
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM award_winners')).n).toBe(before.n);
  });

  it('refused publications leave ZERO rows (refusal before any write)', async () => {
    const refusals = [
      await publish({ correction: null }),
      await publish({ correction: correction({ note: 'too short' }) }),
      await publish({ correction: correction({ workflow: 'data_editor' }) }),
      await publish({ viewer: ADMIN }),
      await publish({ publishedBy: 0 }),
      await publish({ publishedBy: 2 }),
      await publish({ derivation: makeInput({ seasonState: { registry: makeInput().seasonState.registry, settled: false } }) }),
      await publish({ derivation: makeInput({ playerMatchGoals: synthFacts().filter((f) => f.matchId !== 4) }) }),
    ];
    expect(refusals.map((r) => (r.ok ? 'published' : r.refusal.code))).toEqual([
      'season_sealed', 'correction_invalid', 'correction_invalid', 'capability_denied', 'invalid_actor',
      'actor_mismatch', 'derivation_refused', 'derivation_refused',
    ]);
    expect(await count()).toBe(0);
  });

  it('a forced SQL failure mid-transaction leaves zero rows (rollback)', async () => {
    const real = pgliteExecutor(db);
    // Fails AFTER the INSERT has executed, so only a real rollback can leave the table empty.
    const failing: TransactionalSqlExecutor = {
      query: (text, params) => real.query(text, params),
      transaction: (work) => real.transaction((tx) => work({
        query: async <R extends object>(text: string, params?: readonly unknown[]) => {
          const result = await tx.query<R>(text, params);
          if (/INSERT INTO derived_award_results/.test(text)) throw new Error('forced failure after the insert');
          return result;
        },
      })),
    };
    await expectRejected(asImport(() => publishColemanResult(failing, request())), /forced failure after the insert/);
    expect(await count()).toBe(0);
    // A failed supersession leaves the chain exactly as it was.
    const first = await publish();
    if (!first.ok) throw new Error(first.refusal.message);
    await expectRejected(
      asImport(() => publishColemanResult(failing, request({ derivation: makeInput({ playerMatchGoals: synthFacts({ '11:3': 0 }) }) }))),
      /forced failure after the insert/,
    );
    expect((await rows()).map((r) => r.id)).toEqual([first.id]);
    // And the database is healthy afterwards: the same request through the real executor succeeds.
    const after = await publish({ derivation: makeInput({ playerMatchGoals: synthFacts({ '11:3': 0 }) }) });
    expect(after).toMatchObject({ ok: true, outcome: 'superseded' });
  });

  it('takes only a transaction-scoped advisory lock, released at commit (the import role has no UPDATE for FOR UPDATE)', async () => {
    const outcome = await publish();
    expect(outcome.ok).toBe(true);
    // The lock is transaction-scoped: it is released at commit, so a second publication proceeds.
    const locks = await one<{ n: number }>(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`);
    expect(locks.n).toBe(0);
  });
});
