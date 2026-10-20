/**
 * The Brownlow round-vote match_id backfill (src/db/queries/brownlow-round-vote-match-backfill.ts):
 * the candidate mapping, its exclusions, the reviewed export, the all-or-nothing apply, the replay and
 * the exact reversal. In-memory PGlite over a STUB of the four tables it touches (their columns and the
 * two partial unique indexes mirror migrations 005, 094 and the stats table). EVERY ROW IS SYNTHETIC.
 * PGlite is not evidence for PostgreSQL: the same code runs against a clone of the authentic data in
 * docs/v2/brownlow-round-vote-match-backfill-2026-10-20.md.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryPglite, pgliteExecutor, type InMemoryPglite } from '@afldb/testing';

import {
  BACKFILL_EXCLUSIONS,
  BackfillRefusal,
  applyRoundVoteMatchBackfill,
  backfillDigest,
  exportOf,
  parseBackfillExport,
  planRoundVoteMatchBackfill,
  reverseRoundVoteMatchBackfill,
  type BackfillExport,
} from '@/db/queries/brownlow-round-vote-match-backfill';

const SCHEMA = `
  CREATE TYPE round_type AS ENUM ('home_and_away', 'elimination_final', 'grand_final');
  CREATE TABLE matches (id integer PRIMARY KEY, season smallint NOT NULL, round_type round_type NOT NULL, round_number smallint);
  CREATE TABLE player_match_stats (
    player_id integer NOT NULL, match_id integer NOT NULL REFERENCES matches(id), brownlow_votes smallint,
    PRIMARY KEY (player_id, match_id));
  CREATE TABLE brownlow_round_votes (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    season smallint NOT NULL, player_id integer NOT NULL, round_number smallint NOT NULL,
    played boolean NOT NULL, votes smallint, source_id smallint, source_record_id text, import_batch_id bigint,
    imported_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z',
    match_id integer REFERENCES matches(id) ON DELETE SET NULL,
    CONSTRAINT brownlow_round_uq UNIQUE (season, player_id, round_number),
    CONSTRAINT brownlow_round_ck CHECK (votes IS NULL OR votes BETWEEN 0 AND 3));
  CREATE UNIQUE INDEX ux_brownlow_round_votes_match_player ON brownlow_round_votes (match_id, player_id) WHERE match_id IS NOT NULL;
  CREATE UNIQUE INDEX ux_brownlow_round_votes_match_value ON brownlow_round_votes (match_id, votes) WHERE match_id IS NOT NULL AND votes > 0;
`;

let db: InMemoryPglite;
const executor = () => pgliteExecutor(db);
let DB_NAME = '';

beforeAll(async () => {
  db = await createInMemoryPglite();
  await db.exec(SCHEMA);
  DB_NAME = (await db.query<{ db: string }>('SELECT current_database() AS db')).rows[0].db;
});
afterAll(async () => { await db?.close(); });

async function sql(text: string, params: unknown[] = []) { return (await db.query<Record<string, unknown>>(text, params)).rows; }

async function reset(): Promise<void> {
  await db.exec('DROP TRIGGER IF EXISTS t_fail ON brownlow_round_votes; DROP TRIGGER IF EXISTS t_mutate ON brownlow_round_votes;');
  await db.exec('TRUNCATE brownlow_round_votes, player_match_stats, matches RESTART IDENTITY CASCADE');
  // Season 2000: matches 1 and 2 in round 1; match 3 in round 2. Season 2001: match 4 in round 1.
  await db.exec(`
    INSERT INTO matches VALUES (1, 2000, 'home_and_away', 1), (2, 2000, 'home_and_away', 1), (3, 2000, 'home_and_away', 2),
                               (4, 2001, 'home_and_away', 1), (5, 2000, 'elimination_final', NULL);
    -- players 11,12,13 in match 1; 21,22 in match 2; 11 in match 3; 31 in match 4
    INSERT INTO player_match_stats VALUES (11, 1, 3), (12, 1, 2), (13, 1, 0), (21, 2, 0), (22, 2, 0), (11, 3, 0), (31, 4, NULL);
  `);
}

async function vote(season: number, player: number, round: number, votes: number | null, matchId: number | null = null) {
  await db.query(
    `INSERT INTO brownlow_round_votes (season, player_id, round_number, played, votes, match_id) VALUES ($1, $2, $3, true, $4, $5)`,
    [season, player, round, votes, matchId]);
}

/** The ordinary population: every NULL row has one candidate and agrees with the mirror. */
async function seedClean(): Promise<void> {
  await vote(2000, 11, 1, 3); await vote(2000, 12, 1, 2); await vote(2000, 13, 1, 0);
  await vote(2000, 21, 1, 0); await vote(2000, 22, 1, 0);
  await vote(2000, 11, 2, 0);
  await vote(2001, 31, 1, 0); // mirror NULL = not recorded
}

async function matchesOf(): Promise<Record<string, number | null>> {
  const rows = await sql('SELECT season, player_id, round_number, match_id FROM brownlow_round_votes ORDER BY id');
  return Object.fromEntries(rows.map((r) => [`${r.season}/${r.round_number}/${r.player_id}`, r.match_id as number | null]));
}

beforeEach(reset);

describe('planRoundVoteMatchBackfill (read-only)', () => {
  it('derives each NULL row to its one match, counts the classes exactly and writes nothing', async () => {
    await seedClean();
    const plan = await planRoundVoteMatchBackfill(executor());
    expect(plan).toMatchObject({ nullRows: 7, repairable: 7, positiveRepairable: 2, mirrorNotRecorded: 1 });
    expect(plan.excluded).toEqual({ no_candidate: 0, ambiguous_candidates: 0, mirror_votes_disagree: 0, target_pair_taken: 0, target_vote_slot_taken: 0 });
    expect(plan.perSeason.map((s) => [s.season, s.nullRows, s.repairable])).toEqual([[2000, 6, 6], [2001, 1, 1]]);
    expect(plan.repairs.map((r) => r.matchId)).toEqual([1, 1, 1, 2, 2, 3, 4]);
    expect(plan.digest).toBe(backfillDigest(null, plan.repairs));
    expect(plan.fingerprints).toMatchObject({ rows: 7, mapped: 0 });
    expect(Object.values(await matchesOf()).every((m) => m === null)).toBe(true);
    // Deterministic: the same data gives the same digest and fingerprints.
    expect(await planRoundVoteMatchBackfill(executor())).toEqual(plan);
  });

  it('never loosens the rule: no candidate, several candidates and a disagreeing mirror stay NULL and are named', async () => {
    await seedClean();
    await vote(2000, 99, 1, 0); // no player_match_stats row in any match: no candidate
    await db.exec(`INSERT INTO player_match_stats VALUES (21, 1, 0)`); // player 21 now in matches 1 and 2 of round 1: ambiguous
    await vote(2000, 12, 3, 1); // no round-3 match
    await db.exec(`UPDATE player_match_stats SET brownlow_votes = 1 WHERE player_id = 12 AND match_id = 1`); // mirror 1, row says 2
    const plan = await planRoundVoteMatchBackfill(executor());
    expect(plan.excluded).toEqual({ no_candidate: 2, ambiguous_candidates: 1, mirror_votes_disagree: 1, target_pair_taken: 0, target_vote_slot_taken: 0 });
    expect(plan.repairable).toBe(plan.nullRows - 4);
    expect(plan.unresolvedSample.map((u) => [u.playerId, u.exclusion]).sort()).toEqual(
      [[12, 'mirror_votes_disagree'], [12, 'no_candidate'], [21, 'ambiguous_candidates'], [99, 'no_candidate']].sort());
    expect(BACKFILL_EXCLUSIONS).toContain('target_vote_slot_taken');
  });

  it('a finals round is never a candidate', async () => {
    await db.exec(`INSERT INTO player_match_stats VALUES (41, 5, 0)`);
    await vote(2000, 41, 1, 0);
    expect((await planRoundVoteMatchBackfill(executor())).excluded.no_candidate).toBe(1);
  });

  it('excludes BOTH rows of a vote-slot clash and any row whose slot an existing mapping already holds', async () => {
    // Players 12 and 13 both polled 2 in match 1 (a data fault): neither may be preferred.
    await db.exec(`UPDATE player_match_stats SET brownlow_votes = 2 WHERE match_id = 1 AND player_id = 13`);
    await vote(2000, 12, 1, 2); await vote(2000, 13, 1, 2);
    // Player 11 holds 3 in match 1 through an existing mapping; a NULL row for player 22 also claims 3 in match 2: unrelated, fine.
    await vote(2000, 11, 1, 3, 1);
    const plan = await planRoundVoteMatchBackfill(executor());
    expect(plan.excluded.target_vote_slot_taken).toBe(2);
    expect(plan.repairs).toEqual([]);
    // A NULL row claiming a slot an existing mapped row holds is excluded as well.
    await reset();
    await vote(2000, 11, 1, 3, 1); // existing mapped, holds (match 1, 3)
    await db.exec(`INSERT INTO player_match_stats VALUES (14, 1, 3)`);
    await vote(2000, 14, 1, 3);
    const clash = await planRoundVoteMatchBackfill(executor());
    expect(clash.excluded.target_vote_slot_taken).toBe(1);
    expect(clash.repairs).toEqual([]);
  });

  it('is scoped by season and refuses a malformed season list', async () => {
    await seedClean();
    const only = await planRoundVoteMatchBackfill(executor(), { seasons: [2001] });
    expect(only).toMatchObject({ seasons: [2001], nullRows: 1, repairable: 1 });
    await expect(planRoundVoteMatchBackfill(executor(), { seasons: [] })).rejects.toBeInstanceOf(BackfillRefusal);
    await expect(planRoundVoteMatchBackfill(executor(), { seasons: [20001] })).rejects.toBeInstanceOf(BackfillRefusal);
  });
});

describe('the reviewed export', () => {
  it('round-trips and refuses an edited, reordered or foreign export', async () => {
    await seedClean();
    const exported = exportOf(await planRoundVoteMatchBackfill(executor()));
    const copy = JSON.parse(JSON.stringify(exported)) as BackfillExport;
    expect(parseBackfillExport(copy).repairs).toHaveLength(7);
    const edited = JSON.parse(JSON.stringify(exported)); edited.repairs[0].matchId = 2;
    expect(() => parseBackfillExport(edited)).toThrow(/digest/);
    const reordered = JSON.parse(JSON.stringify(exported)); reordered.repairs.reverse();
    expect(() => parseBackfillExport(reordered)).toThrow(/out of id order/);
    const foreign = JSON.parse(JSON.stringify(exported)); foreign.rule = 'something else';
    expect(() => parseBackfillExport(foreign)).toThrow(/different rule/);
    for (const junk of [null, 'x', [], { format: 'nope' }]) expect(() => parseBackfillExport(junk)).toThrow(BackfillRefusal);
  });
});

describe('applyRoundVoteMatchBackfill', () => {
  async function reviewed() {
    const plan = await planRoundVoteMatchBackfill(executor());
    return { exported: exportOf(plan), plan };
  }

  it('writes only NULL -> match_id, preserves every other column, and a replay writes nothing', async () => {
    await seedClean();
    const { exported, plan } = await reviewed();
    const columnsBefore = plan.fingerprints.columns;
    const result = await applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME });
    expect(result).toMatchObject({ applied: 7, alreadyApplied: 0, exported: 7 });
    expect(result.before.columns).toBe(columnsBefore);
    expect(result.after.columns).toBe(columnsBefore); // nothing but match_id moved
    expect(result.after.mapped).toBe(7);
    expect(await matchesOf()).toEqual({
      '2000/1/11': 1, '2000/1/12': 1, '2000/1/13': 1, '2000/1/21': 2, '2000/1/22': 2, '2000/2/11': 3, '2001/1/31': 4,
    });
    const replay = await applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME });
    expect(replay).toMatchObject({ applied: 0, alreadyApplied: 7 });
    expect(replay.after).toEqual(result.after);
    // And a fresh plan now has nothing left to do.
    expect((await planRoundVoteMatchBackfill(executor())).repairable).toBe(0);
  });

  it('leaves existing non-NULL mappings and excluded rows exactly as they were', async () => {
    await seedClean();
    await vote(2000, 99, 1, 0); // excluded: no candidate
    await db.exec(`UPDATE brownlow_round_votes SET match_id = 1 WHERE player_id = 11 AND round_number = 1`);
    const { exported } = await reviewed();
    expect(exported.repairs).toHaveLength(6);
    await applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME });
    const after = await matchesOf();
    expect(after['2000/1/11']).toBe(1);
    expect(after['2000/1/99']).toBeNull();
  });

  it('refuses the wrong database, a digest it was not authorised for, and an unreviewed edit - writing nothing', async () => {
    await seedClean();
    const { exported } = await reviewed();
    await expect(applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: 'production' }))
      .rejects.toMatchObject({ code: 'wrong_database' });
    await expect(applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: 'f'.repeat(64), expectedDatabase: DB_NAME }))
      .rejects.toMatchObject({ code: 'export_digest_mismatch' });
    const tampered = { ...exported, repairs: exported.repairs.map((r, i) => (i === 0 ? { ...r, matchId: 2 } : r)) };
    await expect(applyRoundVoteMatchBackfill(executor(), { export: tampered, expectedDigest: tampered.digest, expectedDatabase: DB_NAME }))
      .rejects.toMatchObject({ code: 'export_digest_mismatch' });
    expect(Object.values(await matchesOf()).every((m) => m === null)).toBe(true);
  });

  it('refuses when the evidence moved after the review: one drifted row means NO row is written', async () => {
    await seedClean();
    const { exported } = await reviewed();
    await db.exec(`DELETE FROM player_match_stats WHERE player_id = 22`); // row 5 no longer derives to match 2
    await expect(applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME }))
      .rejects.toMatchObject({ code: 'export_drift' });
    expect(Object.values(await matchesOf()).every((m) => m === null)).toBe(true);
  });

  it('a row mapped elsewhere since the review is drift, not overwritten', async () => {
    await seedClean();
    const { exported } = await reviewed();
    await db.exec(`UPDATE brownlow_round_votes SET match_id = 2 WHERE player_id = 12`);
    await expect(applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME }))
      .rejects.toMatchObject({ code: 'export_drift' });
    expect((await matchesOf())['2000/1/12']).toBe(2);
    expect((await matchesOf())['2000/1/11']).toBeNull();
  });

  it('PARTIAL FAILURE: a database-side failure on the last row rolls every earlier row back', async () => {
    await seedClean();
    const { exported } = await reviewed();
    await db.exec(`
      CREATE FUNCTION fail_on_match_4() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.match_id = 4 THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER t_fail BEFORE UPDATE ON brownlow_round_votes FOR EACH ROW EXECUTE FUNCTION fail_on_match_4();`);
    await expect(applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME }))
      .rejects.toThrow(/injected failure/);
    expect(Object.values(await matchesOf()).every((m) => m === null)).toBe(true);
  });

  it('POSTCONDITION: a write that also altered another column is detected and rolled back', async () => {
    await seedClean();
    const { exported } = await reviewed();
    await db.exec(`
      CREATE FUNCTION touch_votes() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.played := false; RETURN NEW; END $$;
      CREATE TRIGGER t_mutate BEFORE UPDATE ON brownlow_round_votes FOR EACH ROW EXECUTE FUNCTION touch_votes();`);
    await expect(applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME }))
      .rejects.toMatchObject({ code: 'postcondition_failed' });
    expect(Object.values(await matchesOf()).every((m) => m === null)).toBe(true);
    expect((await sql(`SELECT count(*)::int AS n FROM brownlow_round_votes WHERE played`))[0].n).toBe(7);
  });

  it('a season-scoped export touches only that season', async () => {
    await seedClean();
    const plan = await planRoundVoteMatchBackfill(executor(), { seasons: [2001] });
    const exported = exportOf(plan);
    await applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME });
    const after = await matchesOf();
    expect(after['2001/1/31']).toBe(4);
    expect(after['2000/1/11']).toBeNull();
  });
});

describe('reverseRoundVoteMatchBackfill', () => {
  it('restores NULL for exactly the exported rows, leaves earlier mappings, and a replay writes nothing', async () => {
    await seedClean();
    await db.exec(`UPDATE brownlow_round_votes SET match_id = 4 WHERE player_id = 31`); // mapped BEFORE the backfill
    const plan = await planRoundVoteMatchBackfill(executor());
    const exported = exportOf(plan);
    const applied = await applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME });
    const reversed = await reverseRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME });
    expect(reversed).toMatchObject({ reverted: 6, alreadyReverted: 0 });
    expect(reversed.after.columns).toBe(applied.before.columns);
    expect(reversed.after.mapping).toBe(applied.before.mapping); // byte-identical to the state before the backfill
    expect((await matchesOf())['2001/1/31']).toBe(4);
    const replay = await reverseRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME });
    expect(replay).toMatchObject({ reverted: 0, alreadyReverted: 6 });
  });

  it('refuses a row that changed after the backfill, writing nothing', async () => {
    await seedClean();
    const exported = exportOf(await planRoundVoteMatchBackfill(executor()));
    await applyRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME });
    await db.exec(`UPDATE brownlow_round_votes SET match_id = 2 WHERE player_id = 12`);
    await expect(reverseRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME }))
      .rejects.toMatchObject({ code: 'reversal_drift' });
    expect((await matchesOf())['2000/1/11']).toBe(1);
    await expect(reverseRoundVoteMatchBackfill(executor(), { export: exported, expectedDigest: exported.digest, expectedDatabase: 'other' }))
      .rejects.toMatchObject({ code: 'wrong_database' });
  });
});
