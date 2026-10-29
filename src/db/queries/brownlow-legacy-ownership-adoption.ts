import 'server-only';

import { createHash } from 'node:crypto';

import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';

/**
 * The narrowest operator-run transition from LEGACY-owned to canonical-API-owned Brownlow round votes.
 *
 * WHY IT EXISTS. `canonical-apply.ts` `autoApplyOwnership` refuses a `brownlow_round_votes` row whose
 * `source_id IS NULL` (`ownership_indeterminate`): a source-less row cannot be proven unowned from
 * anything the settle role can read, so NULL means "provenance unknown", never "free to adopt". Every
 * archived round vote is source-less, so all 207 vote sets of 2025 refuse and the API can never
 * become the writer. The same file (section 19.1(e)) forbids any settle code path from setting
 * `source_id` on an UPDATE: "an ownership transfer, if ever wanted, is an explicit operator-run script
 * ... never a side effect of a settle". THIS IS THAT SCRIPT, as a separate module, and it is a
 * distinct decision of the data owner. It never runs on its own and nothing imports it from a settle.
 *
 * WHAT IT CHANGES, per vote set (one provider match, three positive rows) and nothing else:
 * on exactly the three legacy rows that carry the 3, 2 and 1 votes, `source_id` -> the API source,
 * `source_record_id` -> the provider match id, `import_batch_id` -> one dedicated adoption batch. The
 * votes, `played`, `imported_at` and `match_id` are NEVER touched (the match mapping is the separate
 * backfill's job), and every legacy zero-vote participation row stays legacy and unowned: the API
 * feed is sparse (positive votes only), so it holds no evidence about them.
 *
 * LEGACY PROVENANCE IS NOT ERASED. The previous `source_record_id` and `import_batch_id` of every
 * adopted row, and the fact that `source_id` was NULL, are written to the reviewed export (the
 * reversal map) and to a `canonical_applications` ledger row per adopted row (verb `update`,
 * `previous_values` / `new_values`, bound to the exact staged vote-set version). Reversal restores them.
 *
 * PRECONDITIONS, per set. Any failure refuses THAT SET with a named code and it is never in the
 * export; the apply refuses the whole transaction if an exported set no longer qualifies:
 *  - staged and current: exactly 3 staged positive rows (3, 2, 1), one canonical match, every player
 *    and the match resolved, on the head version of a not-absent spine record;
 *  - a legacy row exists for each (season, player, round), is unowned (`source_id IS NULL`), has
 *    `played = true` and the SAME vote value as the staged row;
 *  - the row's `match_id` is NULL or equals the staged match, and (when proven) the migration-094 rule
 *    (the player's own stats row in that round) names the same single match: two independent
 *    identities of the match must agree;
 *  - no OTHER legacy positive row belongs to that match, and no other row holds one of its vote slots.
 *
 * TWO KEYS, NO FORCE FLAG. The apply takes the reviewed export plus the digest the reviewer read, the
 * database name, and a written owner-decision reference. It takes the settle gate exclusively, the
 * Brownlow admin lock and a table lock, runs in ONE transaction (any failure rolls everything back),
 * proves afterwards that no stable column of any row moved and that no row outside the export changed
 * ownership, and finishes by closing its own `import_batches` row. A replay finds every set already
 * adopted (by ledger) and writes nothing. {@link reverseBrownlowOwnershipAdoption} restores the legacy
 * provenance exactly, refusing if an adopted row has since changed.
 */

export const ADOPTION_TOOL = 'brownlow-ownership-adoption.ts';
export const ADOPTION_REVERSAL_TOOL = 'brownlow-ownership-adoption-reversal.ts';
export const ADOPTION_FORMAT = 'afldb.v2.brownlow-ownership-adoption';
export const ADOPTION_FORMAT_VERSION = 1;
export const ADOPTION_SOURCE_KEY = 'afl_api';
export const ADOPTION_FAMILY = 'brownlow_match_votes';

const SETTLE_GATE = [717275, 4] as const;
const BROWNLOW_ADMIN_LOCK = [717275, 3] as const;
const LOCK_TIMEOUT_MS = 30_000;
const DECISION_MIN_LENGTH = 20;
const REFUSED_SAMPLE = 50;

export type AdoptionRefusalCode =
  | 'incomplete_staged_set'
  | 'legacy_row_missing'
  | 'legacy_row_owned'
  | 'legacy_value_disagrees'
  | 'legacy_match_conflict'
  | 'legacy_match_unproven'
  | 'legacy_extra_positive'
  | 'legacy_slot_taken';

export const ADOPTION_REFUSAL_CODES: readonly AdoptionRefusalCode[] = [
  'incomplete_staged_set', 'legacy_row_missing', 'legacy_row_owned', 'legacy_value_disagrees',
  'legacy_match_conflict', 'legacy_match_unproven', 'legacy_extra_positive', 'legacy_slot_taken',
];

export type AdoptionErrorCode =
  | 'invalid_export'
  | 'invalid_decision'
  | 'export_digest_mismatch'
  | 'wrong_database'
  | 'source_missing'
  | 'export_drift'
  | 'write_mismatch'
  | 'postcondition_failed'
  | 'reversal_drift';

export class AdoptionRefusal extends Error {
  readonly code: AdoptionErrorCode;

  constructor(code: AdoptionErrorCode, message: string) {
    super(message);
    this.name = 'AdoptionRefusal';
    this.code = code;
  }
}

export interface AdoptionRow {
  rowId: number;
  playerId: number;
  votes: number;
  /** The legacy provenance this adoption overwrites (and a reversal restores). */
  previousSourceRecordId: string | null;
  previousImportBatchId: number | null;
}

export interface AdoptionSet {
  providerMatchId: string;
  matchId: number;
  season: number;
  round: number;
  /** The exact staged version the ledger rows bind to. */
  sourceVersionSeq: number;
  rows: readonly AdoptionRow[];
}

export interface AdoptionRefusedSet {
  providerMatchId: string;
  season: number;
  codes: readonly AdoptionRefusalCode[];
}

export interface AdoptionPlan {
  format: typeof ADOPTION_FORMAT;
  formatVersion: typeof ADOPTION_FORMAT_VERSION;
  seasons: readonly number[] | null;
  stagedSets: number;
  adoptable: number;
  alreadyAdopted: number;
  refused: number;
  refusedByCode: Record<AdoptionRefusalCode, number>;
  refusedSample: readonly AdoptionRefusedSet[];
  /** Legacy positive rows no staged API set covers; informational, never touched. */
  legacyPositiveUncovered: number;
  /** Legacy zero-vote participation rows; stay legacy and unowned by design. */
  legacyZeroRowsLeftAlone: number;
  sets: readonly AdoptionSet[];
  digest: string;
  fingerprints: AdoptionFingerprints;
}

export interface AdoptionFingerprints {
  rows: number;
  /** id, season, player, round, played, votes, imported_at, match_id: nothing an adoption may move. */
  stable: string;
  /** (id, source_id, source_record_id, import_batch_id) of every row NOT in the export. */
  outsideOwnership: string;
}

export interface AdoptionExport {
  format: typeof ADOPTION_FORMAT;
  formatVersion: typeof ADOPTION_FORMAT_VERSION;
  seasons: readonly number[] | null;
  digest: string;
  sets: readonly AdoptionSet[];
}

export interface AdoptionResult {
  database: string;
  digest: string;
  batchId: number | null;
  setsExported: number;
  setsChanged: number;
  setsAlreadyInState: number;
  rowsChanged: number;
  ledgerRows: number;
  before: AdoptionFingerprints;
  after: AdoptionFingerprints;
}

/* ------------------------------------------------------------------ *
 * Digest and export
 * ------------------------------------------------------------------ */

export function adoptionDigest(seasons: readonly number[] | null, sets: readonly AdoptionSet[]): string {
  const hash = createHash('sha256');
  hash.update(`${ADOPTION_FORMAT}/${ADOPTION_FORMAT_VERSION}\nsource=${ADOPTION_SOURCE_KEY}/${ADOPTION_FAMILY}\nseasons=${seasons === null ? '*' : [...seasons].sort((a, b) => a - b).join(',')}\n`);
  for (const set of sets) {
    hash.update(`${set.providerMatchId}|${set.matchId}|${set.season}|${set.round}|${set.sourceVersionSeq}\n`);
    for (const row of set.rows) {
      hash.update(`  ${row.rowId}|${row.playerId}|${row.votes}|${row.previousSourceRecordId ?? '~'}|${row.previousImportBatchId ?? '~'}\n`);
    }
  }
  return hash.digest('hex');
}

export function adoptionExportOf(plan: AdoptionPlan): AdoptionExport {
  return { format: ADOPTION_FORMAT, formatVersion: ADOPTION_FORMAT_VERSION, seasons: plan.seasons, digest: plan.digest, sets: plan.sets };
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

/** Validate an export read from disk. Throws {@link AdoptionRefusal} `invalid_export`. */
export function parseAdoptionExport(value: unknown): AdoptionExport {
  const bad = (why: string): never => {
    throw new AdoptionRefusal('invalid_export', `The adoption export is not valid: ${why}.`);
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return bad('not an object');
  const record = value as Record<string, unknown>;
  if (record.format !== ADOPTION_FORMAT || record.formatVersion !== ADOPTION_FORMAT_VERSION) return bad('unknown format');
  const seasons = record.seasons;
  if (seasons !== null && !(Array.isArray(seasons) && seasons.every(isInt))) return bad('seasons');
  if (typeof record.digest !== 'string' || !/^[0-9a-f]{64}$/.test(record.digest)) return bad('digest');
  if (!Array.isArray(record.sets)) return bad('sets');
  const sets: AdoptionSet[] = [];
  const seenMatches = new Set<string>();
  const seenRows = new Set<number>();
  for (const raw of record.sets as unknown[]) {
    const set = raw as Record<string, unknown> | null;
    if (set === null || typeof set !== 'object' || typeof set.providerMatchId !== 'string' || !isInt(set.matchId)
      || !isInt(set.season) || !isInt(set.round) || !isInt(set.sourceVersionSeq) || !Array.isArray(set.rows)
      || set.rows.length !== 3 || seenMatches.has(set.providerMatchId)) return bad('a vote set is malformed or duplicated');
    seenMatches.add(set.providerMatchId);
    const rows: AdoptionRow[] = [];
    for (const rawRow of set.rows as unknown[]) {
      const row = rawRow as Record<string, unknown> | null;
      if (row === null || typeof row !== 'object' || !isInt(row.rowId) || !isInt(row.playerId) || !isInt(row.votes)
        || ![1, 2, 3].includes(row.votes) || seenRows.has(row.rowId)
        || !(row.previousSourceRecordId === null || typeof row.previousSourceRecordId === 'string')
        || !(row.previousImportBatchId === null || isInt(row.previousImportBatchId))) return bad('a row is malformed or duplicated');
      seenRows.add(row.rowId);
      rows.push({
        rowId: row.rowId, playerId: row.playerId, votes: row.votes,
        previousSourceRecordId: row.previousSourceRecordId as string | null,
        previousImportBatchId: row.previousImportBatchId as number | null,
      });
    }
    if (new Set(rows.map((r) => r.votes)).size !== 3) return bad('a set does not carry 3, 2 and 1');
    sets.push({
      providerMatchId: set.providerMatchId, matchId: set.matchId, season: set.season, round: set.round,
      sourceVersionSeq: set.sourceVersionSeq, rows,
    });
  }
  const parsed: AdoptionExport = {
    format: ADOPTION_FORMAT, formatVersion: ADOPTION_FORMAT_VERSION, seasons: seasons as readonly number[] | null,
    digest: record.digest, sets,
  };
  if (adoptionDigest(parsed.seasons, sets) !== parsed.digest) {
    throw new AdoptionRefusal('export_digest_mismatch', 'The export content does not match its own digest; it was edited after it was produced.');
  }
  return parsed;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

interface JoinedRow {
  providerMatchId: string;
  versionSeq: number | string;
  season: number | string;
  round: number | string;
  playerId: number | string | null;
  votes: number | string;
  matchId: number | string | null;
  rowId: number | string | null;
  rowPlayed: boolean | null;
  rowVotes: number | string | null;
  rowSourceId: number | string | null;
  rowSourceRecordId: string | null;
  rowImportBatchId: number | string | null;
  rowMatchId: number | string | null;
  ruleCandidates: number | string;
  ruleMatchId: number | string | null;
  adoptionLedger: boolean;
}

const JOINED_SQL = `
  SELECT v.external_record_id AS "providerMatchId", v.version_seq AS "versionSeq", v.season,
         v.canonical_round_number AS round, v.player_id AS "playerId", v.votes, v.match_id AS "matchId",
         rv.id AS "rowId", rv.played AS "rowPlayed", rv.votes AS "rowVotes", rv.source_id AS "rowSourceId",
         rv.source_record_id AS "rowSourceRecordId", rv.import_batch_id AS "rowImportBatchId", rv.match_id AS "rowMatchId",
         coalesce(rule.candidates, 0) AS "ruleCandidates", rule.match_id AS "ruleMatchId",
         EXISTS (
           SELECT 1 FROM canonical_applications ca JOIN import_batches b ON b.id = ca.import_batch_id
            WHERE b.tool = $2::text AND ca.target_table = 'brownlow_round_votes' AND ca.verb = 'update'
              AND ca.external_record_id = v.external_record_id
              AND ca.target_key = jsonb_build_object('season', v.season, 'player_id', v.player_id, 'round_number', v.canonical_round_number)
         ) AS "adoptionLedger"
    FROM staging.afl_api_brownlow_vote v
    JOIN sources s ON s.id = v.source_id AND s.key = $3::text
    JOIN staging.source_records r
      ON r.source_id = v.source_id AND r.family = v.family AND r.external_record_id = v.external_record_id
     AND r.current_version_seq = v.version_seq AND r.absent_since IS NULL
    LEFT JOIN brownlow_round_votes rv
      ON rv.season = v.season AND rv.player_id = v.player_id AND rv.round_number = v.canonical_round_number
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS candidates, min(m.id)::int AS match_id
        FROM matches m JOIN player_match_stats pms ON pms.match_id = m.id AND pms.player_id = v.player_id
       WHERE m.season = v.season AND m.round_type = 'home_and_away' AND m.round_number = v.canonical_round_number
    ) rule ON true
   WHERE v.family = $4::text AND v.votes > 0 AND ($1::text::int[] IS NULL OR v.season = ANY($1::text::int[]))
   ORDER BY v.external_record_id, v.votes DESC`;

const OTHER_POSITIVE_SQL = `
  SELECT DISTINCT x.match_id AS "matchId", x.id AS "rowId", x.player_id AS "playerId"
    FROM (
      SELECT pms.match_id, rv2.id, rv2.player_id
        FROM brownlow_round_votes rv2
        JOIN matches m ON m.season = rv2.season AND m.round_type = 'home_and_away' AND m.round_number = rv2.round_number
        JOIN player_match_stats pms ON pms.match_id = m.id AND pms.player_id = rv2.player_id
       WHERE rv2.votes > 0 AND ($1::text::int[] IS NULL OR rv2.season = ANY($1::text::int[]))
      UNION ALL
      SELECT rv3.match_id, rv3.id, rv3.player_id FROM brownlow_round_votes rv3
       WHERE rv3.votes > 0 AND rv3.match_id IS NOT NULL AND ($1::text::int[] IS NULL OR rv3.season = ANY($1::text::int[]))
    ) x`;

const SLOT_SQL = `
  SELECT match_id AS "matchId", votes, id AS "rowId" FROM brownlow_round_votes
   WHERE match_id IS NOT NULL AND votes > 0 AND ($1::text::int[] IS NULL OR season = ANY($1::text::int[]))`;

const FINGERPRINT_SQL = `
  WITH ex AS (SELECT x.id FROM jsonb_to_recordset($2::text::jsonb) AS x(id bigint))
  SELECT count(*)::int AS rows,
         encode(sha256(convert_to(coalesce(string_agg(
           concat_ws('|', r.id, r.season, r.player_id, r.round_number, r.played, coalesce(r.votes::text, '~'),
                     (r.imported_at AT TIME ZONE 'UTC')::text, coalesce(r.match_id::text, '~')), E'\n' ORDER BY r.id), ''), 'UTF8')), 'hex') AS stable,
         encode(sha256(convert_to(coalesce(string_agg(
           concat_ws('|', r.id, coalesce(r.source_id::text, '~'), coalesce(r.source_record_id, '~'), coalesce(r.import_batch_id::text, '~')),
           E'\n' ORDER BY r.id) FILTER (WHERE ex.id IS NULL), ''), 'UTF8')), 'hex') AS "outsideOwnership"
    FROM brownlow_round_votes r LEFT JOIN ex ON ex.id = r.id
   WHERE $1::text::int[] IS NULL OR r.season = ANY($1::text::int[])`;

function seasonsParam(seasons: readonly number[] | null): string | null {
  return seasons === null ? null : `{${[...seasons].join(',')}}`;
}

function normaliseSeasons(seasons?: readonly number[]): readonly number[] | null {
  if (seasons === undefined) return null;
  if (seasons.length === 0 || !seasons.every((s) => Number.isInteger(s) && s >= 1897 && s <= 2100)) {
    throw new AdoptionRefusal('invalid_export', 'The seasons must be a non-empty list of whole years from 1897 to 2100.');
  }
  return [...new Set(seasons)].sort((a, b) => a - b);
}

async function fingerprints(
  executor: SqlExecutor, seasons: readonly number[] | null, exportedRowIds: readonly number[],
): Promise<AdoptionFingerprints> {
  const [row] = await executor.query<{ rows: number | string; stable: string; outsideOwnership: string }>(
    FINGERPRINT_SQL, [seasonsParam(seasons), JSON.stringify(exportedRowIds.map((id) => ({ id })))],
  );
  return { rows: Number(row.rows), stable: row.stable, outsideOwnership: row.outsideOwnership };
}

const zeroCodes = (): Record<AdoptionRefusalCode, number> => ({
  incomplete_staged_set: 0, legacy_row_missing: 0, legacy_row_owned: 0, legacy_value_disagrees: 0,
  legacy_match_conflict: 0, legacy_match_unproven: 0, legacy_extra_positive: 0, legacy_slot_taken: 0,
});

/** READ-ONLY. */
export async function planBrownlowOwnershipAdoption(
  executor: SqlExecutor, options: { seasons?: readonly number[] } = {},
): Promise<AdoptionPlan> {
  const seasons = normaliseSeasons(options.seasons);
  const param = seasonsParam(seasons);
  const [sourceRow] = await executor.query<{ id: number | string }>('SELECT id FROM sources WHERE key = $1', [ADOPTION_SOURCE_KEY]);
  if (!sourceRow) throw new AdoptionRefusal('source_missing', `The source '${ADOPTION_SOURCE_KEY}' does not exist in this database.`);
  const apiSourceId = Number(sourceRow.id);

  const joined = await executor.query<JoinedRow>(JOINED_SQL, [param, ADOPTION_TOOL, ADOPTION_SOURCE_KEY, ADOPTION_FAMILY]);
  const others = await executor.query<{ matchId: number | string; rowId: number | string; playerId: number | string }>(OTHER_POSITIVE_SQL, [param]);
  const slots = await executor.query<{ matchId: number | string; votes: number | string; rowId: number | string }>(SLOT_SQL, [param]);

  const byMatchOthers = new Map<number, Array<{ rowId: number; playerId: number }>>();
  for (const o of others) {
    const list = byMatchOthers.get(Number(o.matchId)) ?? [];
    list.push({ rowId: Number(o.rowId), playerId: Number(o.playerId) });
    byMatchOthers.set(Number(o.matchId), list);
  }
  const slotHolders = new Map<string, number[]>();
  for (const s of slots) {
    const key = `${s.matchId}|${s.votes}`;
    slotHolders.set(key, [...(slotHolders.get(key) ?? []), Number(s.rowId)]);
  }

  const grouped = new Map<string, JoinedRow[]>();
  for (const row of joined) grouped.set(row.providerMatchId, [...(grouped.get(row.providerMatchId) ?? []), row]);

  const sets: AdoptionSet[] = [];
  const refusedSets: AdoptionRefusedSet[] = [];
  const refusedByCode = zeroCodes();
  let alreadyAdopted = 0;
  const coveredRowIds = new Set<number>();

  for (const [providerMatchId, rows] of grouped) {
    const codes = new Set<AdoptionRefusalCode>();
    const season = Number(rows[0].season);
    const values = rows.map((r) => Number(r.votes)).sort((a, b) => b - a);
    const matchIds = new Set(rows.map((r) => (r.matchId === null ? null : Number(r.matchId))));
    const versions = new Set(rows.map((r) => Number(r.versionSeq)));
    if (rows.length !== 3 || values.join() !== '3,2,1' || rows.some((r) => r.playerId === null || r.matchId === null)
      || matchIds.size !== 1 || versions.size !== 1 || new Set(rows.map((r) => r.playerId)).size !== 3) {
      codes.add('incomplete_staged_set');
    } else {
      const matchId = Number([...matchIds][0]);
      const owned = rows.filter((r) => r.rowSourceId !== null);
      const adoptedByLedger = rows.every((r) => r.rowSourceId !== null && Number(r.rowSourceId) === apiSourceId
        && r.rowSourceRecordId === providerMatchId && r.adoptionLedger);
      if (adoptedByLedger) {
        alreadyAdopted += 1;
        rows.forEach((r) => coveredRowIds.add(Number(r.rowId)));
        continue;
      }
      for (const r of rows) {
        if (r.rowId === null) { codes.add('legacy_row_missing'); continue; }
        if (r.rowSourceId !== null) { codes.add('legacy_row_owned'); continue; }
        if (r.rowPlayed !== true || r.rowVotes === null || Number(r.rowVotes) !== Number(r.votes)) codes.add('legacy_value_disagrees');
        if (r.rowMatchId !== null && Number(r.rowMatchId) !== matchId) codes.add('legacy_match_conflict');
        if (Number(r.ruleCandidates) !== 1 || r.ruleMatchId === null) codes.add('legacy_match_unproven');
        else if (Number(r.ruleMatchId) !== matchId) codes.add('legacy_match_conflict');
      }
      if (owned.length === 0 && codes.size === 0) {
        const targetPlayers = new Set(rows.map((r) => Number(r.playerId)));
        const targetRows = new Set(rows.map((r) => Number(r.rowId)));
        if ((byMatchOthers.get(matchId) ?? []).some((o) => !targetPlayers.has(o.playerId) && !targetRows.has(o.rowId))) {
          codes.add('legacy_extra_positive');
        }
        for (const r of rows) {
          if ((slotHolders.get(`${matchId}|${r.votes}`) ?? []).some((holder) => !targetRows.has(holder))) codes.add('legacy_slot_taken');
        }
      }
      if (codes.size === 0) {
        sets.push({
          providerMatchId, matchId, season, round: Number(rows[0].round), sourceVersionSeq: [...versions][0],
          rows: rows.map((r) => ({
            rowId: Number(r.rowId), playerId: Number(r.playerId), votes: Number(r.votes),
            previousSourceRecordId: r.rowSourceRecordId,
            previousImportBatchId: r.rowImportBatchId === null ? null : Number(r.rowImportBatchId),
          })),
        });
        rows.forEach((r) => coveredRowIds.add(Number(r.rowId)));
        continue;
      }
    }
    for (const code of codes) refusedByCode[code] += 1;
    refusedSets.push({ providerMatchId, season, codes: [...codes].sort() });
  }
  sets.sort((a, b) => (a.providerMatchId < b.providerMatchId ? -1 : 1));

  const [counts] = await executor.query<{ positive: number | string; zero: number | string }>(
    `SELECT count(*) FILTER (WHERE votes > 0)::int AS positive, count(*) FILTER (WHERE votes = 0)::int AS zero
       FROM brownlow_round_votes
      WHERE source_id IS NULL AND ($1::text::int[] IS NULL OR season = ANY($1::text::int[]))`, [param]);
  const exportedIds = sets.flatMap((set) => set.rows.map((row) => row.rowId));
  const stagedSets = grouped.size;
  return {
    format: ADOPTION_FORMAT, formatVersion: ADOPTION_FORMAT_VERSION, seasons, stagedSets,
    adoptable: sets.length, alreadyAdopted, refused: refusedSets.length, refusedByCode,
    refusedSample: refusedSets.slice(0, REFUSED_SAMPLE),
    legacyPositiveUncovered: Math.max(0, Number(counts.positive) - exportedIds.length),
    legacyZeroRowsLeftAlone: Number(counts.zero),
    sets, digest: adoptionDigest(seasons, sets), fingerprints: await fingerprints(executor, seasons, exportedIds),
  };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

async function lockForTransition(tx: SqlExecutor, expectedDatabase: string): Promise<string> {
  await tx.query(`SELECT set_config('lock_timeout', $1, true)`, [String(LOCK_TIMEOUT_MS)]);
  await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [SETTLE_GATE[0], SETTLE_GATE[1]]);
  await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [BROWNLOW_ADMIN_LOCK[0], BROWNLOW_ADMIN_LOCK[1]]);
  await tx.query('LOCK TABLE brownlow_round_votes IN SHARE ROW EXCLUSIVE MODE');
  await tx.query('ANALYZE brownlow_round_votes');
  const [row] = await tx.query<{ db: string }>('SELECT current_database() AS db');
  if (row.db !== expectedDatabase) {
    throw new AdoptionRefusal('wrong_database', `This run is pinned to database '${expectedDatabase}' but is connected to '${row.db}'. Nothing was written.`);
  }
  return row.db;
}

function checkedRequest(request: { export: AdoptionExport; expectedDigest: string; decision: string }): AdoptionExport {
  const decision = request.decision.trim();
  if (decision.length < DECISION_MIN_LENGTH) {
    throw new AdoptionRefusal('invalid_decision', `A written owner-decision reference of at least ${DECISION_MIN_LENGTH} characters is required.`);
  }
  if (request.export.digest !== request.expectedDigest) {
    throw new AdoptionRefusal('export_digest_mismatch', 'The export digest is not the digest this run was authorised for. Nothing was written.');
  }
  return parseAdoptionExport(request.export);
}

/** Canonical key order, so the ledger JSON is deterministic. */
const stringify = (value: Record<string, unknown>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))));

async function openBatch(tx: SqlExecutor, sourceId: number, tool: string, setsCount: number, decision: string, digest: string): Promise<number> {
  const [batch] = await tx.query<{ id: number | string }>(
    `INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
     VALUES ($1, $2, 'brownlow_round_votes', $3, $4) RETURNING id`,
    [sourceId, tool, setsCount, `Owner decision: ${decision.trim()}; export digest ${digest}`],
  );
  return Number(batch.id);
}

async function closeBatch(tx: SqlExecutor, batchId: number, rows: number, summary: Record<string, unknown>): Promise<void> {
  const closed = await tx.query(
    `UPDATE import_batches SET completed_at = clock_timestamp(), status = 'completed',
            records_updated = $2, validation_result = $3::text::jsonb
      WHERE id = $1 AND status = 'running' RETURNING id`,
    [batchId, rows, JSON.stringify(summary)],
  );
  if (closed.length !== 1) throw new AdoptionRefusal('postcondition_failed', 'The adoption batch could not be closed. Rolled back.');
}

async function currentRows(tx: SqlExecutor, ids: readonly number[]) {
  return tx.query<{ id: number | string; sourceId: number | string | null; sourceRecordId: string | null; importBatchId: number | string | null; votes: number | string | null; played: boolean }>(
    `SELECT r.id, r.source_id AS "sourceId", r.source_record_id AS "sourceRecordId", r.import_batch_id AS "importBatchId", r.votes, r.played
       FROM brownlow_round_votes r, jsonb_to_recordset($1::text::jsonb) AS x(id bigint) WHERE r.id = x.id ORDER BY r.id`,
    [JSON.stringify(ids.map((id) => ({ id })))],
  );
}

async function writeLedger(
  tx: SqlExecutor, batchId: number, sourceId: number, set: AdoptionSet, row: AdoptionRow,
  previous: Record<string, unknown>, next: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `INSERT INTO canonical_applications (import_batch_id, source_id, family, external_record_id, source_version_seq,
                                         target_table, target_key, verb, previous_values, new_values)
     VALUES ($1, $2, $3, $4, $5, 'brownlow_round_votes', $6::text::jsonb, 'update', $7::text::jsonb, $8::text::jsonb)`,
    [batchId, sourceId, ADOPTION_FAMILY, set.providerMatchId, set.sourceVersionSeq,
      stringify({ season: set.season, player_id: row.playerId, round_number: set.round }), stringify(previous), stringify(next)],
  );
}

/** Apply the reviewed export. See the module comment. */
export async function applyBrownlowOwnershipAdoption(
  executor: TransactionalSqlExecutor,
  request: { export: AdoptionExport; expectedDigest: string; expectedDatabase: string; decision: string },
): Promise<AdoptionResult> {
  const reviewed = checkedRequest(request);
  return executor.transaction(async (tx) => {
    const database = await lockForTransition(tx, request.expectedDatabase);
    const seasons = reviewed.seasons;
    const rowIds = reviewed.sets.flatMap((set) => set.rows.map((row) => row.rowId));
    const before = await fingerprints(tx, seasons, rowIds);
    const plan = await planBrownlowOwnershipAdoption(tx, { seasons: seasons ?? undefined });
    const [source] = await tx.query<{ id: number | string }>('SELECT id FROM sources WHERE key = $1', [ADOPTION_SOURCE_KEY]);
    const sourceId = Number(source.id);

    const planByMatch = new Map(plan.sets.map((set) => [set.providerMatchId, set]));
    const toAdopt: AdoptionSet[] = [];
    let alreadyInState = 0;
    for (const set of reviewed.sets) {
      const live = planByMatch.get(set.providerMatchId);
      if (live !== undefined && adoptionDigest(null, [live]) === adoptionDigest(null, [set])) { toAdopt.push(set); continue; }
      // Not adoptable now: acceptable ONLY if every row already carries exactly this adoption.
      const now = await currentRows(tx, set.rows.map((row) => row.rowId));
      const adopted = now.length === 3 && now.every((r) => r.sourceId !== null && Number(r.sourceId) === sourceId && r.sourceRecordId === set.providerMatchId);
      const ledger = adopted ? await tx.query<{ n: number | string }>(
        `SELECT count(*)::int AS n FROM canonical_applications ca JOIN import_batches b ON b.id = ca.import_batch_id
          WHERE b.tool = $1 AND ca.external_record_id = $2 AND ca.target_table = 'brownlow_round_votes'`,
        [ADOPTION_TOOL, set.providerMatchId]) : [];
      if (adopted && Number(ledger[0]?.n ?? 0) >= 3) { alreadyInState += 1; continue; }
      throw new AdoptionRefusal('export_drift', `Vote set ${set.providerMatchId} no longer qualifies exactly as reviewed. Nothing was written.`);
    }

    let batchId: number | null = null;
    let rowsChanged = 0;
    let ledgerRows = 0;
    if (toAdopt.length > 0) {
      batchId = await openBatch(tx, sourceId, ADOPTION_TOOL, toAdopt.length, request.decision, reviewed.digest);
      for (const set of toAdopt) {
        for (const row of set.rows) {
          const written = await tx.query<{ id: number | string }>(
            `UPDATE brownlow_round_votes SET source_id = $2, source_record_id = $3, import_batch_id = $4
              WHERE id = $1 AND source_id IS NULL AND played AND votes = $5
                AND (match_id IS NULL OR match_id = $6)
          RETURNING id`,
            [row.rowId, sourceId, set.providerMatchId, batchId, row.votes, set.matchId],
          );
          if (written.length !== 1) throw new AdoptionRefusal('write_mismatch', `Row ${row.rowId} could not be adopted exactly as reviewed. Rolled back.`);
          rowsChanged += 1;
          await writeLedger(tx, batchId, sourceId, set, row,
            { source_id: null, source_record_id: row.previousSourceRecordId, import_batch_id: row.previousImportBatchId },
            { source_id: sourceId, source_record_id: set.providerMatchId, import_batch_id: batchId });
          ledgerRows += 1;
        }
      }
    }

    const after = await fingerprints(tx, seasons, rowIds);
    if (after.rows !== before.rows || after.stable !== before.stable) {
      throw new AdoptionRefusal('postcondition_failed', 'A stable column (votes, played, imported_at, match_id or identity) changed. Rolled back.');
    }
    if (after.outsideOwnership !== before.outsideOwnership) {
      throw new AdoptionRefusal('postcondition_failed', 'A row outside the export changed ownership. Rolled back.');
    }
    const owned = await tx.query<{ n: number | string }>(
      `SELECT count(*)::int AS n FROM brownlow_round_votes r, jsonb_to_recordset($2::text::jsonb) AS x(id bigint)
        WHERE r.id = x.id AND r.source_id = $1`, [sourceId, JSON.stringify(rowIds.map((id) => ({ id })))]);
    if (Number(owned[0].n) !== rowIds.length) {
      throw new AdoptionRefusal('postcondition_failed', 'Not every exported row is owned by the API source after the write. Rolled back.');
    }
    if (batchId !== null) {
      await closeBatch(tx, batchId, rowsChanged, { setsChanged: toAdopt.length, rowsChanged, ledgerRows, digest: reviewed.digest });
    }
    return {
      database, digest: reviewed.digest, batchId, setsExported: reviewed.sets.length, setsChanged: toAdopt.length,
      setsAlreadyInState: alreadyInState, rowsChanged, ledgerRows, before, after,
    };
  });
}

/** The inverse of {@link applyBrownlowOwnershipAdoption}: legacy provenance restored from the export. */
export async function reverseBrownlowOwnershipAdoption(
  executor: TransactionalSqlExecutor,
  request: { export: AdoptionExport; expectedDigest: string; expectedDatabase: string; decision: string },
): Promise<AdoptionResult> {
  const reviewed = checkedRequest(request);
  return executor.transaction(async (tx) => {
    const database = await lockForTransition(tx, request.expectedDatabase);
    const seasons = reviewed.seasons;
    const rowIds = reviewed.sets.flatMap((set) => set.rows.map((row) => row.rowId));
    const before = await fingerprints(tx, seasons, rowIds);
    const [source] = await tx.query<{ id: number | string }>('SELECT id FROM sources WHERE key = $1', [ADOPTION_SOURCE_KEY]);
    if (!source) throw new AdoptionRefusal('source_missing', `The source '${ADOPTION_SOURCE_KEY}' does not exist in this database.`);
    const sourceId = Number(source.id);

    const toRevert: Array<{ set: AdoptionSet; adoptionBatch: number }> = [];
    let alreadyReverted = 0;
    for (const set of reviewed.sets) {
      const now = await currentRows(tx, set.rows.map((row) => row.rowId));
      const reverted = now.length === 3 && now.every((r) => r.sourceId === null);
      if (reverted) { alreadyReverted += 1; continue; }
      const ledger = await tx.query<{ batch: number | string; n: number | string }>(
        `SELECT ca.import_batch_id AS batch, count(*)::int AS n FROM canonical_applications ca JOIN import_batches b ON b.id = ca.import_batch_id
          WHERE b.tool = $1 AND ca.external_record_id = $2 AND ca.target_table = 'brownlow_round_votes'
          GROUP BY ca.import_batch_id`, [ADOPTION_TOOL, set.providerMatchId]);
      const adoptionBatch = ledger.length === 1 && Number(ledger[0].n) === 3 ? Number(ledger[0].batch) : null;
      const byId = new Map(now.map((r) => [Number(r.id), r]));
      const intact = adoptionBatch !== null && set.rows.every((row) => {
        const r = byId.get(row.rowId);
        return r !== undefined && r.sourceId !== null && Number(r.sourceId) === sourceId && r.sourceRecordId === set.providerMatchId
          && Number(r.importBatchId) === adoptionBatch && r.played && Number(r.votes) === row.votes;
      });
      if (!intact) throw new AdoptionRefusal('reversal_drift', `Vote set ${set.providerMatchId} is not in the exact state the adoption left it (changed since, or never adopted). Nothing was written.`);
      toRevert.push({ set, adoptionBatch: adoptionBatch as number });
    }

    let batchId: number | null = null;
    let rowsChanged = 0;
    let ledgerRows = 0;
    if (toRevert.length > 0) {
      batchId = await openBatch(tx, sourceId, ADOPTION_REVERSAL_TOOL, toRevert.length, request.decision, reviewed.digest);
      for (const { set, adoptionBatch } of toRevert) {
        for (const row of set.rows) {
          const written = await tx.query<{ id: number | string }>(
            `UPDATE brownlow_round_votes SET source_id = NULL, source_record_id = $2, import_batch_id = $3
              WHERE id = $1 AND source_id = $4 AND source_record_id = $5 AND import_batch_id = $6
          RETURNING id`,
            [row.rowId, row.previousSourceRecordId, row.previousImportBatchId, sourceId, set.providerMatchId, adoptionBatch],
          );
          if (written.length !== 1) throw new AdoptionRefusal('write_mismatch', `Row ${row.rowId} could not be restored exactly. Rolled back.`);
          rowsChanged += 1;
          await writeLedger(tx, batchId, sourceId, set, row,
            { source_id: sourceId, source_record_id: set.providerMatchId, import_batch_id: adoptionBatch },
            { source_id: null, source_record_id: row.previousSourceRecordId, import_batch_id: row.previousImportBatchId });
          ledgerRows += 1;
        }
      }
    }
    const after = await fingerprints(tx, seasons, rowIds);
    if (after.rows !== before.rows || after.stable !== before.stable || after.outsideOwnership !== before.outsideOwnership) {
      throw new AdoptionRefusal('postcondition_failed', 'A stable column, or a row outside the export, changed. Rolled back.');
    }
    if (batchId !== null) await closeBatch(tx, batchId, rowsChanged, { setsReverted: toRevert.length, rowsChanged, ledgerRows, digest: reviewed.digest });
    return {
      database, digest: reviewed.digest, batchId, setsExported: reviewed.sets.length, setsChanged: toRevert.length,
      setsAlreadyInState: alreadyReverted, rowsChanged, ledgerRows, before, after,
    };
  });
}
