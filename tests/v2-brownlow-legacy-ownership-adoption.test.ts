/**
 * The Brownlow legacy-ownership adoption (src/db/queries/brownlow-legacy-ownership-adoption.ts): the
 * per-set preconditions, the reviewed export, the two-key all-or-nothing apply, legacy provenance
 * preserved in the export and the ledger, replay, exact reversal, and every refusal. In-memory PGlite
 * over a STUB of the tables it touches; EVERY ROW IS SYNTHETIC. PGlite is not evidence for PostgreSQL:
 * the same code runs against a clone of the authentic data in
 * docs/v2/brownlow-legacy-ownership-transition-2026-10-20.md.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryPglite, pgliteExecutor, type InMemoryPglite } from '@afldb/testing';

import {
  ADOPTION_REFUSAL_CODES,
  AdoptionRefusal,
  adoptionDigest,
  applyBrownlowOwnershipAdoption,
  parseAdoptionExport,
  planBrownlowOwnershipAdoption,
  reverseBrownlowOwnershipAdoption,
  adoptionExportOf,
  type AdoptionExport,
} from '@/db/queries/brownlow-legacy-ownership-adoption';

const SCHEMA = `
  CREATE SCHEMA staging;
  CREATE TYPE round_type AS ENUM ('home_and_away', 'elimination_final');
  CREATE TABLE sources (id smallint PRIMARY KEY, key text NOT NULL UNIQUE);
  CREATE TABLE matches (id integer PRIMARY KEY, season smallint NOT NULL, round_type round_type NOT NULL, round_number smallint);
  CREATE TABLE player_match_stats (player_id integer NOT NULL, match_id integer NOT NULL REFERENCES matches(id), PRIMARY KEY (player_id, match_id));
  CREATE TABLE import_batches (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, source_id smallint NOT NULL REFERENCES sources(id), tool text NOT NULL,
    target_table text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    status text NOT NULL DEFAULT 'running', records_read bigint NOT NULL DEFAULT 0, records_updated bigint NOT NULL DEFAULT 0,
    validation_result jsonb, notes text);
  CREATE TABLE brownlow_round_votes (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    season smallint NOT NULL, player_id integer NOT NULL, round_number smallint NOT NULL,
    played boolean NOT NULL, votes smallint, source_id smallint REFERENCES sources(id), source_record_id text,
    import_batch_id bigint, imported_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z',
    match_id integer REFERENCES matches(id) ON DELETE SET NULL,
    CONSTRAINT brownlow_round_uq UNIQUE (season, player_id, round_number),
    CONSTRAINT brownlow_round_ck CHECK (votes IS NULL OR votes BETWEEN 0 AND 3));
  CREATE UNIQUE INDEX ux_brv_match_player ON brownlow_round_votes (match_id, player_id) WHERE match_id IS NOT NULL;
  CREATE UNIQUE INDEX ux_brv_match_value ON brownlow_round_votes (match_id, votes) WHERE match_id IS NOT NULL AND votes > 0;
  CREATE TABLE canonical_applications (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, import_batch_id bigint NOT NULL REFERENCES import_batches(id),
    source_id smallint NOT NULL, family text NOT NULL, external_record_id text NOT NULL, source_version_seq integer NOT NULL,
    target_table text NOT NULL, target_key jsonb NOT NULL, verb text NOT NULL, previous_values jsonb, new_values jsonb NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ca_previous_ck CHECK ((previous_values IS NULL) = (verb = 'insert')));
  CREATE TABLE staging.source_records (
    source_id smallint NOT NULL, family text NOT NULL, external_record_id text NOT NULL, current_version_seq integer NOT NULL,
    absent_since timestamptz, PRIMARY KEY (source_id, family, external_record_id));
  CREATE TABLE staging.afl_api_brownlow_vote (
    source_id smallint NOT NULL, family text NOT NULL, external_record_id text NOT NULL, version_seq integer NOT NULL,
    provider_player_id text NOT NULL, season smallint NOT NULL, canonical_round_number smallint NOT NULL, votes smallint NOT NULL,
    match_id integer, player_id integer, PRIMARY KEY (source_id, family, external_record_id, provider_player_id));
`;

let db: InMemoryPglite;
const executor = () => pgliteExecutor(db);
let DB_NAME = '';
const DECISION = 'Owner decision OD-TEST-1, 2026-10-20';

beforeAll(async () => {
  db = await createInMemoryPglite();
  await db.exec(SCHEMA);
  DB_NAME = (await db.query<{ db: string }>('SELECT current_database() AS db')).rows[0].db;
});
afterAll(async () => { await db?.close(); });

async function sql(text: string, params: unknown[] = []) { return (await db.query<Record<string, unknown>>(text, params)).rows; }

async function reset(): Promise<void> {
  await db.exec('DROP TRIGGER IF EXISTS t_fail ON brownlow_round_votes; DROP TRIGGER IF EXISTS t_mutate ON brownlow_round_votes;');
  await db.exec(`TRUNCATE brownlow_round_votes, canonical_applications, import_batches, player_match_stats, matches, sources,
                          staging.source_records, staging.afl_api_brownlow_vote RESTART IDENTITY CASCADE`);
  await db.exec(`
    INSERT INTO sources VALUES (1, 'afl_api'), (2, 'afltables');
    INSERT INTO matches VALUES (1, 2000, 'home_and_away', 1), (2, 2000, 'home_and_away', 1), (3, 2000, 'home_and_away', 2);
    -- players 11,12,13 and a zero-vote 14 played match 1; 21,22,23 played match 2; 11,12,13 played match 3
    INSERT INTO player_match_stats VALUES (11,1),(12,1),(13,1),(14,1),(21,2),(22,2),(23,2),(11,3),(12,3),(13,3);
  `);
  // Legacy archive: positive 3-2-1 for matches 1 and 2 in round 1, plus zero-vote participation rows. Source-less.
  for (const [p, v] of [[11, 3], [12, 2], [13, 1], [14, 0], [21, 3], [22, 2], [23, 1]] as const) await legacy(2000, p, 1, v);
  await legacy(2000, 11, 2, 0);
  // The staged API feed: a head, not-absent version 1 of matches PM1 (match 1) and PM2 (match 2).
  await stage('PM1', 1, [[11, 3], [12, 2], [13, 1]]);
  await stage('PM2', 2, [[21, 3], [22, 2], [23, 1]]);
}

async function legacy(season: number, player: number, round: number, votes: number, extra: { match?: number; source?: number } = {}) {
  await db.query(
    `INSERT INTO brownlow_round_votes (season, player_id, round_number, played, votes, source_id, source_record_id, import_batch_id, match_id)
     VALUES ($1, $2::int, $3, true, $4, $5, 'legacy-' || ($2::int)::text, 900, $6)`, [season, player, round, votes, extra.source ?? null, extra.match ?? null]);
}

async function stage(provider: string, matchId: number, rows: Array<[number, number]>, round = 1) {
  await db.query(`INSERT INTO staging.source_records VALUES (1, 'brownlow_match_votes', $1, 1, NULL)`, [provider]);
  for (const [p, v] of rows) {
    await db.query(
      `INSERT INTO staging.afl_api_brownlow_vote VALUES (1, 'brownlow_match_votes', $1, 1, $2, 2000, $3, $4, $5, $6)`,
      [provider, `P${p}`, round, v, matchId, p]);
  }
}

const owners = async () => (await sql(
  `SELECT player_id, round_number, source_id, source_record_id, import_batch_id FROM brownlow_round_votes ORDER BY id`));
const request = (exported: AdoptionExport, over: Partial<{ expectedDigest: string; expectedDatabase: string; decision: string }> = {}) => ({
  export: exported, expectedDigest: exported.digest, expectedDatabase: DB_NAME, decision: DECISION, ...over,
});

beforeEach(reset);

describe('planBrownlowOwnershipAdoption (read-only)', () => {
  it('adopts only the three positive legacy rows of each complete staged set, exactly, and writes nothing', async () => {
    const before = await owners();
    const plan = await planBrownlowOwnershipAdoption(executor());
    expect(plan).toMatchObject({ stagedSets: 2, adoptable: 2, alreadyAdopted: 0, refused: 0, legacyZeroRowsLeftAlone: 2 });
    expect(plan.sets.map((s) => [s.providerMatchId, s.matchId, s.rows.map((r) => r.votes)])).toEqual([['PM1', 1, [3, 2, 1]], ['PM2', 2, [3, 2, 1]]]);
    // Legacy provenance is carried verbatim into the export.
    expect(plan.sets[0].rows.map((r) => [r.previousSourceRecordId, r.previousImportBatchId])).toEqual([['legacy-11', 900], ['legacy-12', 900], ['legacy-13', 900]]);
    expect(plan.digest).toBe(adoptionDigest(null, plan.sets));
    expect(await owners()).toEqual(before);
    expect(await planBrownlowOwnershipAdoption(executor())).toEqual(plan);
  });

  it.each<[string, () => Promise<void>, string, string?]>([
    ['a missing legacy row', async () => { await db.exec(`DELETE FROM brownlow_round_votes WHERE player_id = 13 AND round_number = 1`); }, 'legacy_row_missing'],
    ['an owned legacy row', async () => { await db.exec(`UPDATE brownlow_round_votes SET source_id = 2 WHERE player_id = 12 AND round_number = 1`); }, 'legacy_row_owned'],
    ['a vote value that disagrees', async () => { await db.exec(`UPDATE brownlow_round_votes SET votes = 1 WHERE player_id = 12 AND round_number = 1`); }, 'legacy_value_disagrees'],
    ['a legacy match_id naming another match', async () => { await db.exec(`UPDATE brownlow_round_votes SET match_id = 2 WHERE player_id = 11 AND round_number = 1`); }, 'legacy_match_conflict', 'slot'],
    ['a legacy row with no stats row to prove the match', async () => { await db.exec(`DELETE FROM player_match_stats WHERE player_id = 13 AND match_id = 1`); }, 'legacy_match_unproven'],
    ['a player whose stats row names a different match', async () => { await db.exec(`DELETE FROM player_match_stats WHERE player_id = 13 AND match_id = 1; INSERT INTO player_match_stats VALUES (13, 2)`); }, 'legacy_match_conflict', 'extra'],
    ['an extra positive legacy row in the match', async () => { await db.exec(`UPDATE brownlow_round_votes SET votes = 1 WHERE player_id = 14 AND round_number = 1`); }, 'legacy_extra_positive'],
  ])('refuses the set on %s and leaves the other set adoptable', async (_name, damage, code, side) => {
    await damage();
    const plan = await planBrownlowOwnershipAdoption(executor());
    expect(plan.refusedSample.find((r) => r.providerMatchId === 'PM1')?.codes).toContain(code);
    expect(plan.refusedByCode[code as keyof typeof plan.refusedByCode]).toBeGreaterThanOrEqual(1);
    // Two of the damages also touch match 2 (a mis-mapped legacy row claims one of its slots / players), which
    // is itself a correct refusal of PM2; every other damage leaves PM2 adoptable.
    expect(plan.sets.map((s) => s.providerMatchId)).toEqual(side ? [] : ['PM2']);
    expect(ADOPTION_REFUSAL_CODES).toContain(code);
  });

  it('refuses an incomplete staged set, a duplicated vote value and a set whose match the feed did not resolve', async () => {
    await db.exec(`DELETE FROM staging.afl_api_brownlow_vote WHERE external_record_id = 'PM1' AND votes = 1`);
    await db.exec(`UPDATE staging.afl_api_brownlow_vote SET match_id = NULL WHERE external_record_id = 'PM2' AND votes = 3`);
    const plan = await planBrownlowOwnershipAdoption(executor());
    expect(plan.adoptable).toBe(0);
    expect(plan.refusedByCode.incomplete_staged_set).toBe(2);
  });

  it('ignores an absent record and a superseded version', async () => {
    await db.exec(`UPDATE staging.source_records SET absent_since = now() WHERE external_record_id = 'PM1'`);
    await db.exec(`UPDATE staging.source_records SET current_version_seq = 2 WHERE external_record_id = 'PM2'`);
    expect((await planBrownlowOwnershipAdoption(executor())).stagedSets).toBe(0);
  });

  it('refuses a malformed season list', async () => {
    await expect(planBrownlowOwnershipAdoption(executor(), { seasons: [] })).rejects.toBeInstanceOf(AdoptionRefusal);
  });
});

describe('applyBrownlowOwnershipAdoption', () => {
  it('adopts exactly the reviewed rows, keeps zero-vote rows legacy, writes a provenance-preserving ledger and replays as a no-op', async () => {
    const plan = await planBrownlowOwnershipAdoption(executor());
    const exported = adoptionExportOf(plan);
    const stableBefore = await sql(`SELECT id, season, player_id, round_number, played, votes, imported_at, match_id FROM brownlow_round_votes ORDER BY id`);
    const result = await applyBrownlowOwnershipAdoption(executor(), request(exported));
    expect(result).toMatchObject({ database: DB_NAME, setsChanged: 2, setsAlreadyInState: 0, rowsChanged: 6, ledgerRows: 6 });
    expect(result.after.stable).toBe(result.before.stable);
    expect(result.after.outsideOwnership).toBe(result.before.outsideOwnership);
    expect(await sql(`SELECT id, season, player_id, round_number, played, votes, imported_at, match_id FROM brownlow_round_votes ORDER BY id`)).toEqual(stableBefore);

    const rows = await owners();
    expect(rows.filter((r) => r.source_id === 1).map((r) => r.player_id)).toEqual([11, 12, 13, 21, 22, 23]);
    expect(rows.filter((r) => r.source_id === null).map((r) => r.player_id)).toEqual([14, 11]);
    expect(rows.find((r) => r.player_id === 11 && r.round_number === 1)).toMatchObject({ source_record_id: 'PM1' });
    // Ledger: update rows, previous values preserve the legacy provenance, one adoption batch.
    const ledger = await sql(`SELECT verb, external_record_id, target_key, previous_values, new_values, import_batch_id FROM canonical_applications ORDER BY id`);
    expect(ledger).toHaveLength(6);
    expect(ledger[0]).toMatchObject({ verb: 'update', external_record_id: 'PM1' });
    expect(ledger[0].previous_values).toEqual({ import_batch_id: 900, source_id: null, source_record_id: 'legacy-11' });
    expect(ledger[0].target_key).toEqual({ player_id: 11, round_number: 1, season: 2000 });
    expect(new Set(ledger.map((l) => l.import_batch_id)).size).toBe(1);
    expect(await sql(`SELECT status, records_updated FROM import_batches WHERE id = $1`, [result.batchId])).toEqual([{ status: 'completed', records_updated: 6 }]);

    // Replay: nothing to do, nothing written, no second batch.
    const replay = await applyBrownlowOwnershipAdoption(executor(), request(exported));
    expect(replay).toMatchObject({ batchId: null, setsChanged: 0, setsAlreadyInState: 2, rowsChanged: 0 });
    expect(await sql(`SELECT count(*)::int AS n FROM canonical_applications`)).toEqual([{ n: 6 }]);
    // And a fresh plan sees them as adopted, not adoptable.
    expect(await planBrownlowOwnershipAdoption(executor())).toMatchObject({ adoptable: 0, alreadyAdopted: 2, refused: 0 });
  });

  it('can adopt a scoped subset and leaves every other set untouched', async () => {
    const plan = await planBrownlowOwnershipAdoption(executor());
    const only = { ...adoptionExportOf(plan), sets: [plan.sets[0]] };
    const exported = { ...only, digest: adoptionDigest(only.seasons, only.sets) };
    const result = await applyBrownlowOwnershipAdoption(executor(), request(exported));
    expect(result.rowsChanged).toBe(3);
    expect((await owners()).filter((r) => r.source_id === 1)).toHaveLength(3);
  });

  it('refuses without the second key: wrong digest, wrong database, missing decision, tampered export', async () => {
    const exported = adoptionExportOf(await planBrownlowOwnershipAdoption(executor()));
    const before = await owners();
    await expect(applyBrownlowOwnershipAdoption(executor(), request(exported, { expectedDigest: 'a'.repeat(64) }))).rejects.toMatchObject({ code: 'export_digest_mismatch' });
    await expect(applyBrownlowOwnershipAdoption(executor(), request(exported, { expectedDatabase: 'afldb_production' }))).rejects.toMatchObject({ code: 'wrong_database' });
    await expect(applyBrownlowOwnershipAdoption(executor(), request(exported, { decision: 'ok' }))).rejects.toMatchObject({ code: 'invalid_decision' });
    const tampered = { ...exported, sets: [{ ...exported.sets[0], matchId: 2 }, exported.sets[1]] };
    await expect(applyBrownlowOwnershipAdoption(executor(), request(tampered, { expectedDigest: exported.digest }))).rejects.toMatchObject({ code: 'export_digest_mismatch' });
    expect(await owners()).toEqual(before);
    expect(await sql(`SELECT count(*)::int AS n FROM import_batches`)).toEqual([{ n: 0 }]);
  });

  it('refuses the WHOLE export, writing nothing, when one set no longer qualifies', async () => {
    const exported = adoptionExportOf(await planBrownlowOwnershipAdoption(executor()));
    const before = await owners();
    // Between review and apply the afltables importer claims one of PM2's rows.
    await db.exec(`UPDATE brownlow_round_votes SET source_id = 2 WHERE player_id = 22 AND round_number = 1`);
    await expect(applyBrownlowOwnershipAdoption(executor(), request(exported))).rejects.toMatchObject({ code: 'export_drift' });
    expect((await owners()).filter((r) => r.source_id === 1)).toHaveLength(0);
    expect((await owners()).length).toBe(before.length);
    expect(await sql(`SELECT count(*)::int AS n FROM import_batches`)).toEqual([{ n: 0 }]);
  });

  it('rolls everything back on a mid-transaction write failure', async () => {
    const exported = adoptionExportOf(await planBrownlowOwnershipAdoption(executor()));
    const before = await owners();
    await db.exec(`
      CREATE OR REPLACE FUNCTION fail_on_p22() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.player_id = 22 AND NEW.source_id IS NOT NULL THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER t_fail BEFORE UPDATE ON brownlow_round_votes FOR EACH ROW EXECUTE FUNCTION fail_on_p22();`);
    await expect(applyBrownlowOwnershipAdoption(executor(), request(exported))).rejects.toThrow(/injected failure/);
    expect(await owners()).toEqual(before);
    expect(await sql(`SELECT count(*)::int AS n FROM canonical_applications`)).toEqual([{ n: 0 }]);
    expect(await sql(`SELECT count(*)::int AS n FROM import_batches`)).toEqual([{ n: 0 }]);
  });

  it('rolls back when a stable column moves during the write (postcondition)', async () => {
    const exported = adoptionExportOf(await planBrownlowOwnershipAdoption(executor()));
    const before = await owners();
    await db.exec(`
      CREATE OR REPLACE FUNCTION bump_votes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.player_id = 13 AND NEW.source_id IS NOT NULL THEN NEW.imported_at = now(); END IF; RETURN NEW; END $$;
      CREATE TRIGGER t_mutate BEFORE UPDATE ON brownlow_round_votes FOR EACH ROW EXECUTE FUNCTION bump_votes();`);
    await expect(applyBrownlowOwnershipAdoption(executor(), request(exported))).rejects.toMatchObject({ code: 'postcondition_failed' });
    expect(await owners()).toEqual(before);
    expect(await sql(`SELECT count(*)::int AS n FROM canonical_applications`)).toEqual([{ n: 0 }]);
  });
});

describe('reverseBrownlowOwnershipAdoption', () => {
  it('restores the legacy provenance exactly, ledgers the reversal, and replays as a no-op', async () => {
    const exported = adoptionExportOf(await planBrownlowOwnershipAdoption(executor()));
    const original = await sql(`SELECT * FROM brownlow_round_votes ORDER BY id`);
    await applyBrownlowOwnershipAdoption(executor(), request(exported));
    const reversal = await reverseBrownlowOwnershipAdoption(executor(), request(exported));
    expect(reversal).toMatchObject({ setsChanged: 2, rowsChanged: 6, ledgerRows: 6 });
    expect(await sql(`SELECT * FROM brownlow_round_votes ORDER BY id`)).toEqual(original);
    expect(await sql(`SELECT count(*)::int AS n FROM canonical_applications`)).toEqual([{ n: 12 }]);
    const replay = await reverseBrownlowOwnershipAdoption(executor(), request(exported));
    expect(replay).toMatchObject({ batchId: null, setsChanged: 0, setsAlreadyInState: 2 });
    // Re-adoption after reversal works from a fresh plan.
    const again = await planBrownlowOwnershipAdoption(executor());
    expect(again.adoptable).toBe(2);
  });

  it('refuses when an adopted row has changed since, and writes nothing', async () => {
    const exported = adoptionExportOf(await planBrownlowOwnershipAdoption(executor()));
    await applyBrownlowOwnershipAdoption(executor(), request(exported));
    await db.exec(`UPDATE brownlow_round_votes SET votes = 2, source_record_id = 'edited' WHERE player_id = 11 AND round_number = 1`);
    const before = await owners();
    await expect(reverseBrownlowOwnershipAdoption(executor(), request(exported))).rejects.toMatchObject({ code: 'reversal_drift' });
    expect(await owners()).toEqual(before);
  });

  it('refuses to reverse an adoption that never happened', async () => {
    const exported = adoptionExportOf(await planBrownlowOwnershipAdoption(executor()));
    await db.exec(`UPDATE brownlow_round_votes SET source_id = 1, source_record_id = 'PM1' WHERE player_id IN (11,12,13) AND round_number = 1`);
    await expect(reverseBrownlowOwnershipAdoption(executor(), request(exported))).rejects.toMatchObject({ code: 'reversal_drift' });
  });
});

describe('parseAdoptionExport', () => {
  it('rejects malformed and edited exports', async () => {
    const exported = adoptionExportOf(await planBrownlowOwnershipAdoption(executor()));
    expect(parseAdoptionExport(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
    expect(() => parseAdoptionExport(null)).toThrow(AdoptionRefusal);
    expect(() => parseAdoptionExport({ ...exported, format: 'x' })).toThrow(/not valid/);
    expect(() => parseAdoptionExport({ ...exported, sets: [{ ...exported.sets[0], rows: exported.sets[0].rows.slice(0, 2) }] })).toThrow(/malformed/);
    const edited = JSON.parse(JSON.stringify(exported));
    edited.sets[0].rows[0].previousSourceRecordId = 'forged';
    expect(() => parseAdoptionExport(edited)).toThrow(/edited after/);
  });
});
