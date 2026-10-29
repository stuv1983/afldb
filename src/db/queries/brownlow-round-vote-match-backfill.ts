import 'server-only';

import { createHash } from 'node:crypto';

import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';

/**
 * Repairs `brownlow_round_votes.match_id` where it is NULL, by the one rule migration 094 (section 27.5)
 * and the importer (AFLDB-ISSUE-263, `tools/migration/import_fitzroy_core.py`) already use, and by
 * nothing else.
 *
 * WHY A SEPARATE REPAIR EXISTS. Migration 094 added the column and ran its backfill ONCE, over the rows
 * present when it was applied. In the production database it ran in the same sub-second batch as
 * migrations 090-105 on an EMPTY schema; the round votes were loaded three minutes later by an
 * importer that did not yet resolve `match_id`. Its migration-ledger row therefore proves only that the
 * statement ran, not that any row was resolved: every archived row is NULL. The ledger is not touched
 * here, and 094 is not re-run.
 *
 * THE RULE (unchanged, never loosened). A NULL row (season, round, player) takes the one match that is
 * (a) in that season's home-and-away rounds, (b) in that round, and (c) has a `player_match_stats` row
 * for that player. Exactly ONE distinct match qualifies, or the row is left NULL. No name, date, club
 * or ordering is ever consulted.
 *
 * EXTRA EVIDENCE THIS MODULE REQUIRES BEFORE IT WRITES (all must hold, per row):
 *  - the vote mirrored in `player_match_stats.brownlow_votes`, where one is recorded, equals the row's
 *    vote; a disagreement is excluded (`mirror_votes_disagree`), never repaired. A NULL mirror means
 *    "not recorded" (it is never read as 0) and is counted separately (`mirrorNotRecorded`);
 *  - the target `(match_id, player_id)` and, for a positive vote, `(match_id, votes)` are claimed by no
 *    existing row and by no other repair in the plan. Both members of a clash are excluded: neither is
 *    arbitrarily preferred. These are the partial unique indexes of migration 094, checked first so a
 *    clash is reported as a finding rather than discovered as a failed transaction.
 *
 * THREE ENTRY POINTS.
 *  - {@link planRoundVoteMatchBackfill}: READ-ONLY. The candidate mapping, exact counts per class and
 *    season, the unresolved cases, the content digest of the repairs, and the fingerprints a later
 *    check compares.
 *  - {@link applyRoundVoteMatchBackfill}: takes the REVIEWED EXPORT (the plan's repairs), not a flag.
 *    One transaction; refuses on the wrong database or a changed digest; writes only NULL -> match_id
 *    for rows the export names AND the current plan still derives identically; proves afterwards that
 *    every other column of every row is unchanged and that previously mapped rows are unchanged. Any
 *    surprise throws, and the transaction rolls back whole. A replay finds every row already mapped
 *    and writes nothing.
 *  - {@link reverseRoundVoteMatchBackfill}: the exact inverse for the same export (match_id back to
 *    NULL), refusing if any row has since drifted to a different value.
 *
 * LOCKING. The transaction takes the settle/legacy-promotion gate EXCLUSIVELY (717275, 4: every settle
 * holds it shared, `settle-core.ts` `SETTLE_PROMOTION_GATE`), the Brownlow admin advisory lock
 * (717275, 3) and `LOCK TABLE brownlow_round_votes IN SHARE ROW EXCLUSIVE MODE`, so no settle, admin
 * finalisation or import can interleave. `lock_timeout` is bounded so a busy system refuses rather
 * than queues.
 *
 * There is no force flag. Nothing here deletes anything.
 */

export const BACKFILL_RULE =
  'migration-094-s27.5: unique home_and_away match in the row season and round holding a player_match_stats row for the player';
export const BACKFILL_FORMAT = 'afldb.v2.brownlow-round-vote-match-backfill';
export const BACKFILL_FORMAT_VERSION = 1;

const SETTLE_GATE = [717275, 4] as const;
const BROWNLOW_ADMIN_LOCK = [717275, 3] as const;
const LOCK_TIMEOUT_MS = 30_000;
const UPDATE_CHUNK = 5_000;
const UNRESOLVED_SAMPLE = 50;

export type BackfillExclusion =
  | 'no_candidate'
  | 'ambiguous_candidates'
  | 'mirror_votes_disagree'
  | 'target_pair_taken'
  | 'target_vote_slot_taken';

export const BACKFILL_EXCLUSIONS: readonly BackfillExclusion[] = [
  'no_candidate', 'ambiguous_candidates', 'mirror_votes_disagree', 'target_pair_taken', 'target_vote_slot_taken',
];

export type BackfillRefusalCode =
  | 'invalid_export'
  | 'wrong_database'
  | 'export_digest_mismatch'
  | 'export_drift'
  | 'partial_update'
  | 'postcondition_failed'
  | 'reversal_drift';

export class BackfillRefusal extends Error {
  readonly code: BackfillRefusalCode;

  constructor(code: BackfillRefusalCode, message: string) {
    super(message);
    this.name = 'BackfillRefusal';
    this.code = code;
  }
}

export interface BackfillRepair {
  id: number;
  matchId: number;
}

export interface BackfillUnresolved {
  id: number;
  season: number;
  roundNumber: number;
  playerId: number;
  votes: number | null;
  exclusion: BackfillExclusion;
  candidates: number;
}

export interface BackfillSeasonCounts {
  season: number;
  nullRows: number;
  repairable: number;
  positiveRepairable: number;
  mirrorNotRecorded: number;
  excluded: Record<BackfillExclusion, number>;
}

export interface BackfillFingerprints {
  /** Rows in scope. */
  rows: number;
  /** Rows in scope that already hold a match_id. */
  mapped: number;
  /** Every column except match_id, in id order (timestamps in UTC). */
  columns: string;
  /** (id, match_id) of the rows that already hold a match_id. */
  mapping: string;
}

export interface BackfillPlan {
  format: typeof BACKFILL_FORMAT;
  formatVersion: typeof BACKFILL_FORMAT_VERSION;
  rule: string;
  seasons: readonly number[] | null;
  nullRows: number;
  repairable: number;
  positiveRepairable: number;
  mirrorNotRecorded: number;
  excluded: Record<BackfillExclusion, number>;
  perSeason: readonly BackfillSeasonCounts[];
  /** The first rows left unresolved (all of them are counted in `excluded`). */
  unresolvedSample: readonly BackfillUnresolved[];
  /** The repairs, ascending by id. This list IS the reviewed export. */
  repairs: readonly BackfillRepair[];
  /** sha256 over the rule, the scope and the ascending `id:matchId` lines. */
  digest: string;
  fingerprints: BackfillFingerprints;
}

export interface BackfillExport {
  format: typeof BACKFILL_FORMAT;
  formatVersion: typeof BACKFILL_FORMAT_VERSION;
  rule: string;
  seasons: readonly number[] | null;
  digest: string;
  repairs: readonly BackfillRepair[];
}

export interface BackfillApplyResult {
  database: string;
  digest: string;
  exported: number;
  applied: number;
  alreadyApplied: number;
  before: BackfillFingerprints;
  after: BackfillFingerprints;
}

export interface BackfillReverseResult {
  database: string;
  digest: string;
  exported: number;
  reverted: number;
  alreadyReverted: number;
  before: BackfillFingerprints;
  after: BackfillFingerprints;
}

/* ------------------------------------------------------------------ *
 * Digest and export
 * ------------------------------------------------------------------ */

export function backfillDigest(seasons: readonly number[] | null, repairs: readonly BackfillRepair[]): string {
  const hash = createHash('sha256');
  hash.update(`${BACKFILL_FORMAT}/${BACKFILL_FORMAT_VERSION}\n${BACKFILL_RULE}\nseasons=${seasons === null ? '*' : [...seasons].sort((a, b) => a - b).join(',')}\n`);
  for (const repair of repairs) hash.update(`${repair.id}:${repair.matchId}\n`);
  return hash.digest('hex');
}

export function exportOf(plan: BackfillPlan): BackfillExport {
  return {
    format: BACKFILL_FORMAT, formatVersion: BACKFILL_FORMAT_VERSION, rule: plan.rule,
    seasons: plan.seasons, digest: plan.digest, repairs: plan.repairs,
  };
}

/** Validate an export read from disk. Throws {@link BackfillRefusal} `invalid_export`. */
export function parseBackfillExport(value: unknown): BackfillExport {
  const bad = (why: string): never => {
    throw new BackfillRefusal('invalid_export', `The backfill export is not valid: ${why}.`);
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return bad('not an object');
  const record = value as Record<string, unknown>;
  if (record.format !== BACKFILL_FORMAT || record.formatVersion !== BACKFILL_FORMAT_VERSION) return bad('unknown format');
  if (record.rule !== BACKFILL_RULE) return bad('it was derived under a different rule');
  const seasons = record.seasons;
  if (seasons !== null && !(Array.isArray(seasons) && seasons.every((s) => Number.isInteger(s)))) return bad('seasons');
  if (typeof record.digest !== 'string' || !/^[0-9a-f]{64}$/.test(record.digest)) return bad('digest');
  if (!Array.isArray(record.repairs)) return bad('repairs');
  const repairs: BackfillRepair[] = [];
  let previous = 0;
  for (const raw of record.repairs as unknown[]) {
    const item = raw as Record<string, unknown> | null;
    if (item === null || typeof item !== 'object'
      || !Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.matchId)
      || (item.id as number) <= previous || (item.matchId as number) <= 0) {
      return bad('a repair is malformed, duplicated or out of id order');
    }
    previous = item.id as number;
    repairs.push({ id: item.id as number, matchId: item.matchId as number });
  }
  const parsed: BackfillExport = {
    format: BACKFILL_FORMAT, formatVersion: BACKFILL_FORMAT_VERSION, rule: BACKFILL_RULE,
    seasons: seasons as readonly number[] | null, digest: record.digest, repairs,
  };
  if (backfillDigest(parsed.seasons, repairs) !== parsed.digest) {
    throw new BackfillRefusal('export_digest_mismatch', 'The export content does not match its own digest; it was edited after it was produced.');
  }
  return parsed;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

interface ClassifiedRow {
  id: number | string;
  season: number | string;
  roundNumber: number | string;
  playerId: number | string;
  votes: number | string | null;
  candidates: number | string;
  matchId: number | string | null;
  mirrorRecorded: boolean;
  exclusion: BackfillExclusion | null;
}

const CLASSIFY_SQL = `
  WITH scope AS (
    SELECT id, season, round_number, player_id, votes
      FROM brownlow_round_votes
     WHERE match_id IS NULL AND ($1::text::int[] IS NULL OR season = ANY($1::text::int[]))
  ), cand AS (
    SELECT s.id, s.season, s.round_number, s.player_id, s.votes,
           count(c.match_id)::int AS candidates,
           min(c.match_id)::int AS match_id,
           min(c.brownlow_votes) AS mirror_votes
      FROM scope s
      LEFT JOIN (
        SELECT m.season, m.round_number, pms.player_id, m.id AS match_id, pms.brownlow_votes
          FROM matches m
          JOIN player_match_stats pms ON pms.match_id = m.id
         WHERE m.round_type = 'home_and_away'
      ) c ON c.season = s.season AND c.round_number = s.round_number AND c.player_id = s.player_id
     GROUP BY s.id, s.season, s.round_number, s.player_id, s.votes
  ), typed AS (
    SELECT cand.*,
           CASE WHEN candidates = 0 THEN 'no_candidate'
                WHEN candidates > 1 THEN 'ambiguous_candidates'
                WHEN mirror_votes IS NOT NULL AND votes IS DISTINCT FROM mirror_votes THEN 'mirror_votes_disagree'
           END AS exclusion
      FROM cand
  ), clash AS (
    SELECT t.id,
           (count(*) OVER (PARTITION BY t.match_id, t.player_id) > 1 OR tp.match_id IS NOT NULL) AS pair_taken,
           (t.votes > 0
            AND (count(*) FILTER (WHERE t.votes > 0) OVER (PARTITION BY t.match_id, t.votes) > 1
                 OR ts.match_id IS NOT NULL)) AS slot_taken
      FROM typed t
      LEFT JOIN (SELECT match_id, player_id FROM brownlow_round_votes WHERE match_id IS NOT NULL) tp
        ON tp.match_id = t.match_id AND tp.player_id = t.player_id
      LEFT JOIN (SELECT match_id, votes FROM brownlow_round_votes WHERE match_id IS NOT NULL AND votes > 0) ts
        ON ts.match_id = t.match_id AND ts.votes = t.votes
     WHERE t.exclusion IS NULL
  )
  SELECT t.id, t.season, t.round_number AS "roundNumber", t.player_id AS "playerId", t.votes, t.candidates,
         t.match_id AS "matchId", (t.mirror_votes IS NOT NULL) AS "mirrorRecorded",
         coalesce(t.exclusion,
                  CASE WHEN c.pair_taken THEN 'target_pair_taken'
                       WHEN c.slot_taken THEN 'target_vote_slot_taken' END) AS exclusion
    FROM typed t
    LEFT JOIN clash c ON c.id = t.id
   ORDER BY t.id`;

const FINGERPRINT_SQL = `
  SELECT count(*)::int AS rows, count(match_id)::int AS mapped,
         encode(sha256(convert_to(coalesce(string_agg(
           concat_ws('|', id, season, player_id, round_number, played, coalesce(votes::text, '~'),
                     coalesce(source_id::text, '~'), coalesce(source_record_id, '~'),
                     coalesce(import_batch_id::text, '~'), (imported_at AT TIME ZONE 'UTC')::text),
           E'\\n' ORDER BY id), ''), 'UTF8')), 'hex') AS columns,
         encode(sha256(convert_to(coalesce(string_agg(id::text || ':' || match_id::text, E'\\n' ORDER BY id)
                                           FILTER (WHERE match_id IS NOT NULL), ''), 'UTF8')), 'hex') AS mapping
    FROM brownlow_round_votes
   WHERE $1::text::int[] IS NULL OR season = ANY($1::text::int[])`;

const MAPPED_SQL = `
  SELECT id, match_id AS "matchId" FROM brownlow_round_votes
   WHERE match_id IS NOT NULL AND ($1::text::int[] IS NULL OR season = ANY($1::text::int[]))
   ORDER BY id`;

function seasonsParam(seasons: readonly number[] | null): string | null {
  // A Postgres array literal, passed as text and cast, so both drivers send it the same way.
  return seasons === null ? null : `{${[...seasons].join(',')}}`;
}

function normaliseSeasons(seasons?: readonly number[]): readonly number[] | null {
  if (seasons === undefined) return null;
  if (seasons.length === 0 || !seasons.every((s) => Number.isInteger(s) && s >= 1897 && s <= 2100)) {
    throw new BackfillRefusal('invalid_export', 'The seasons must be a non-empty list of whole years from 1897 to 2100.');
  }
  return [...new Set(seasons)].sort((a, b) => a - b);
}

async function fingerprints(executor: SqlExecutor, seasons: readonly number[] | null): Promise<BackfillFingerprints> {
  const [row] = await executor.query<{ rows: number | string; mapped: number | string; columns: string; mapping: string }>(
    FINGERPRINT_SQL, [seasonsParam(seasons)],
  );
  return { rows: Number(row.rows), mapped: Number(row.mapped), columns: row.columns, mapping: row.mapping };
}

async function mappedPairs(executor: SqlExecutor, seasons: readonly number[] | null): Promise<BackfillRepair[]> {
  const rows = await executor.query<{ id: number | string; matchId: number | string }>(MAPPED_SQL, [seasonsParam(seasons)]);
  return rows.map((row) => ({ id: Number(row.id), matchId: Number(row.matchId) }));
}

const zeroExclusions = (): Record<BackfillExclusion, number> => ({
  no_candidate: 0, ambiguous_candidates: 0, mirror_votes_disagree: 0, target_pair_taken: 0, target_vote_slot_taken: 0,
});

/**
 * Refreshes the planner statistics of `brownlow_round_votes`. A bulk NULL <-> match_id change (this
 * module's own apply or reverse, or any import) leaves the statistics describing the OPPOSITE
 * population until autovacuum catches up, and the classification join then picks a plan that is
 * correct but takes minutes instead of seconds (observed on the authentic clone after a reversal).
 * ANALYZE changes no table data. {@link applyRoundVoteMatchBackfill} and
 * {@link reverseRoundVoteMatchBackfill} run it themselves; a caller that plans on a table changed
 * recently by something else should run it first, on a writable connection.
 */
export async function refreshBackfillStatistics(executor: SqlExecutor): Promise<void> {
  await executor.query('ANALYZE brownlow_round_votes');
}

/** READ-ONLY. Safe on any executor, including one inside a read-only transaction. */
export async function planRoundVoteMatchBackfill(
  executor: SqlExecutor,
  options: { seasons?: readonly number[] } = {},
): Promise<BackfillPlan> {
  const seasons = normaliseSeasons(options.seasons);
  const rows = await executor.query<ClassifiedRow>(CLASSIFY_SQL, [seasonsParam(seasons)]);
  const fp = await fingerprints(executor, seasons);

  const perSeason = new Map<number, BackfillSeasonCounts>();
  const excluded = zeroExclusions();
  const repairs: BackfillRepair[] = [];
  const unresolved: BackfillUnresolved[] = [];
  let positiveRepairable = 0;
  let mirrorNotRecorded = 0;
  for (const row of rows) {
    const season = Number(row.season);
    const counts = perSeason.get(season) ?? {
      season, nullRows: 0, repairable: 0, positiveRepairable: 0, mirrorNotRecorded: 0, excluded: zeroExclusions(),
    };
    perSeason.set(season, counts);
    counts.nullRows += 1;
    const votes = row.votes === null ? null : Number(row.votes);
    if (row.exclusion === null) {
      repairs.push({ id: Number(row.id), matchId: Number(row.matchId) });
      counts.repairable += 1;
      if (votes !== null && votes > 0) { counts.positiveRepairable += 1; positiveRepairable += 1; }
      if (!row.mirrorRecorded) { counts.mirrorNotRecorded += 1; mirrorNotRecorded += 1; }
    } else {
      excluded[row.exclusion] += 1;
      counts.excluded[row.exclusion] += 1;
      if (unresolved.length < UNRESOLVED_SAMPLE) {
        unresolved.push({
          id: Number(row.id), season, roundNumber: Number(row.roundNumber), playerId: Number(row.playerId),
          votes, exclusion: row.exclusion, candidates: Number(row.candidates),
        });
      }
    }
  }
  return {
    format: BACKFILL_FORMAT, formatVersion: BACKFILL_FORMAT_VERSION, rule: BACKFILL_RULE, seasons,
    nullRows: rows.length, repairable: repairs.length, positiveRepairable, mirrorNotRecorded, excluded,
    perSeason: [...perSeason.values()].sort((a, b) => a.season - b.season),
    unresolvedSample: unresolved, repairs, digest: backfillDigest(seasons, repairs), fingerprints: fp,
  };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

async function lockForMaintenance(tx: SqlExecutor, expectedDatabase: string): Promise<string> {
  await tx.query(`SELECT set_config('lock_timeout', $1, true)`, [String(LOCK_TIMEOUT_MS)]);
  await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [SETTLE_GATE[0], SETTLE_GATE[1]]);
  await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [BROWNLOW_ADMIN_LOCK[0], BROWNLOW_ADMIN_LOCK[1]]);
  await tx.query('LOCK TABLE brownlow_round_votes IN SHARE ROW EXCLUSIVE MODE');
  const [row] = await tx.query<{ db: string }>('SELECT current_database() AS db');
  if (row.db !== expectedDatabase) {
    throw new BackfillRefusal('wrong_database', `This run is pinned to database '${expectedDatabase}' but is connected to '${row.db}'. Nothing was written.`);
  }
  return row.db;
}

function checkedExport(exported: BackfillExport, expectedDigest: string): BackfillExport {
  if (exported.digest !== expectedDigest) {
    throw new BackfillRefusal('export_digest_mismatch', 'The export digest is not the digest this run was authorised for. Nothing was written.');
  }
  return parseBackfillExport(exported);
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const mappingFingerprintOf = (pairs: readonly BackfillRepair[]) => sha(pairs.map((pair) => `${pair.id}:${pair.matchId}`).join('\n'));
const mergeMapping = (base: readonly BackfillRepair[], add: readonly BackfillRepair[]) =>
  mappingFingerprintOf([...base, ...add].sort((a, b) => a.id - b.id));

async function setMatch(tx: SqlExecutor, rows: readonly BackfillRepair[], clear: boolean): Promise<number> {
  let changed = 0;
  for (let at = 0; at < rows.length; at += UPDATE_CHUNK) {
    const chunk = rows.slice(at, at + UPDATE_CHUNK);
    const written = await tx.query<{ id: number | string }>(
      clear
        ? `UPDATE brownlow_round_votes rv SET match_id = NULL
             FROM jsonb_to_recordset($1::text::jsonb) AS v(id bigint, "matchId" int)
            WHERE rv.id = v.id AND rv.match_id = v."matchId"
        RETURNING rv.id`
        : `UPDATE brownlow_round_votes rv SET match_id = v."matchId"
             FROM jsonb_to_recordset($1::text::jsonb) AS v(id bigint, "matchId" int)
            WHERE rv.id = v.id AND rv.match_id IS NULL
        RETURNING rv.id`,
      [JSON.stringify(chunk)],
    );
    if (written.length !== chunk.length) {
      throw new BackfillRefusal('partial_update', `A chunk of ${chunk.length} rows changed ${written.length}; the whole transaction is rolled back.`);
    }
    changed += written.length;
  }
  return changed;
}

/**
 * Apply the reviewed export. See the module comment. `expectedDigest` must equal the export's own
 * digest, which the reviewer read from the plan; `expectedDatabase` pins the target by name.
 */
export async function applyRoundVoteMatchBackfill(
  executor: TransactionalSqlExecutor,
  request: { export: BackfillExport; expectedDigest: string; expectedDatabase: string },
): Promise<BackfillApplyResult> {
  const reviewed = checkedExport(request.export, request.expectedDigest);
  return executor.transaction(async (tx) => {
    const database = await lockForMaintenance(tx, request.expectedDatabase);
    await refreshBackfillStatistics(tx);
    const seasons = reviewed.seasons;
    const before = await fingerprints(tx, seasons);
    const priorMapped = await mappedPairs(tx, seasons);
    const priorById = new Map(priorMapped.map((pair) => [pair.id, pair.matchId]));
    const plan = await planRoundVoteMatchBackfill(tx, { seasons: seasons ?? undefined });
    const planById = new Map(plan.repairs.map((repair) => [repair.id, repair.matchId]));

    const toWrite: BackfillRepair[] = [];
    let alreadyApplied = 0;
    for (const repair of reviewed.repairs) {
      if (priorById.get(repair.id) === repair.matchId) { alreadyApplied += 1; continue; }
      if (priorById.has(repair.id) || planById.get(repair.id) !== repair.matchId) {
        throw new BackfillRefusal('export_drift', `Row ${repair.id} is no longer a repair the reviewed rule derives to match ${repair.matchId} (it is mapped elsewhere, or its evidence changed). Nothing was written.`);
      }
      toWrite.push(repair);
    }
    const applied = await setMatch(tx, toWrite, false);

    const after = await fingerprints(tx, seasons);
    if (after.rows !== before.rows || after.columns !== before.columns) {
      throw new BackfillRefusal('postcondition_failed', 'A column other than match_id, or the row count, changed. Rolled back.');
    }
    if (after.mapped !== before.mapped + applied) {
      throw new BackfillRefusal('postcondition_failed', `Expected ${before.mapped + applied} mapped rows after the write and found ${after.mapped}. Rolled back.`);
    }
    const expectedMapping = mergeMapping(priorMapped, toWrite);
    const nowMapped = await mappedPairs(tx, seasons);
    if (mappingFingerprintOf(nowMapped) !== expectedMapping) {
      throw new BackfillRefusal('postcondition_failed', 'A previously mapped row changed, or a row outside the export was mapped. Rolled back.');
    }
    const orphans = await tx.query<{ n: number | string }>(
      `SELECT count(*)::int AS n FROM brownlow_round_votes rv LEFT JOIN matches m ON m.id = rv.match_id
        WHERE rv.match_id IS NOT NULL AND m.id IS NULL`,
    );
    if (Number(orphans[0].n) !== 0) {
      throw new BackfillRefusal('postcondition_failed', 'A round vote now points at a match that does not exist. Rolled back.');
    }
    return { database, digest: reviewed.digest, exported: reviewed.repairs.length, applied, alreadyApplied, before, after };
  });
}

/** The exact inverse of {@link applyRoundVoteMatchBackfill} for the same export. */
export async function reverseRoundVoteMatchBackfill(
  executor: TransactionalSqlExecutor,
  request: { export: BackfillExport; expectedDigest: string; expectedDatabase: string },
): Promise<BackfillReverseResult> {
  const reviewed = checkedExport(request.export, request.expectedDigest);
  return executor.transaction(async (tx) => {
    const database = await lockForMaintenance(tx, request.expectedDatabase);
    await refreshBackfillStatistics(tx);
    const seasons = reviewed.seasons;
    const before = await fingerprints(tx, seasons);
    const priorMapped = await mappedPairs(tx, seasons);
    const priorById = new Map(priorMapped.map((pair) => [pair.id, pair.matchId]));

    const toClear: BackfillRepair[] = [];
    let alreadyReverted = 0;
    for (const repair of reviewed.repairs) {
      const current = priorById.get(repair.id);
      if (current === undefined) { alreadyReverted += 1; continue; }
      if (current !== repair.matchId) {
        throw new BackfillRefusal('reversal_drift', `Row ${repair.id} now maps to match ${current}, not the exported ${repair.matchId}; it was changed after the backfill. Nothing was written.`);
      }
      toClear.push(repair);
    }
    const reverted = await setMatch(tx, toClear, true);

    const after = await fingerprints(tx, seasons);
    if (after.rows !== before.rows || after.columns !== before.columns) {
      throw new BackfillRefusal('postcondition_failed', 'A column other than match_id, or the row count, changed. Rolled back.');
    }
    const cleared = new Set(toClear.map((repair) => repair.id));
    const expectedMapping = mappingFingerprintOf(priorMapped.filter((pair) => !cleared.has(pair.id)));
    if (mappingFingerprintOf(await mappedPairs(tx, seasons)) !== expectedMapping) {
      throw new BackfillRefusal('postcondition_failed', 'A row outside the export changed its mapping. Rolled back.');
    }
    return { database, digest: reviewed.digest, exported: reviewed.repairs.length, reverted, alreadyReverted, before, after };
  });
}
