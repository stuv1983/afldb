import 'server-only';

import { createHash } from 'node:crypto';

import type postgres from 'postgres';
import { postgresTransactionExecutor, type SqlExecutor, type TransactionalSqlExecutor } from '@afldb/db';

import { recordDataEdit } from '@/db/queries/audit-log';
import {
  applyRoundVoteMatchBackfill,
  exportOf,
  parseBackfillExport,
  planRoundVoteMatchBackfill,
  reverseRoundVoteMatchBackfill,
  type BackfillExport,
} from '@/db/queries/brownlow-round-vote-match-backfill';

/**
 * Brownlow season ATTACHMENT: prepare a completed season's already-stored match votes for the
 * existing Super Admin publication (`publishBrownlowSeason`). Owner dispute 2026-11-21.
 *
 * WHY IT EXISTS. A completed season can hold its complete official 3/2/1 votes in
 * `brownlow_round_votes` in the legacy round grain — `(season, player, round)` with `match_id` NULL,
 * the shape the AFL Tables settle writes — while the per-match mirror
 * `player_match_stats.brownlow_votes` is still NULL. 2026 is in exactly that state (AFL Tables batch
 * 34, 2026-09-28: 9,522 rows, 621 positive, 1,242 votes). Publication refuses it, correctly: its gate
 * counts only match-attached sets and refuses unattached rows. Nothing in the application attaches
 * them: the reviewed backfill was approved for 1984–2025 only, and admin finalisation would re-own every
 * vote as manual provenance. So the season stayed `pending` on every public view although the medal had
 * been awarded and its votes stored.
 *
 * WHAT IT DOES, in ONE transaction, for ONE season, from a reviewed export:
 *   1. the reviewed round-vote backfill, UNCHANGED (`applyRoundVoteMatchBackfill`, rule migration-094
 *      §27.5, its own locks, drift refusal and column-preservation proof), nested in a savepoint;
 *   2. the per-match mirror, FILL ONLY: `player_match_stats.brownlow_votes` NULL -> the attached row's
 *      vote, for exactly the exported (match, player) cells. A recorded mirror value is never
 *      overwritten (the plan refuses a disagreement), a cell outside the export is never touched;
 *   3. one audit row (`data_edits`, table `brownlow_season_authority`, field group
 *      `attach_round_votes`) through `recordDataEdit`, so the season seal applies: a sealed season needs
 *      the human note, and a refusal rolls everything back.
 *
 * WHAT IT REFUSES (plan and apply both, before any write):
 *   - a season that is not `complete`, is declared no-medal (`not_applicable`), is already accepted
 *     (`complete` coverage or a published authority revision) or already has season totals;
 *   - any round row of the season the rule cannot attach (every exclusion class), any home-and-away
 *     participant cell without a round row, any match whose attached votes are not exactly one 3, one 2
 *     and one 1, any positive vote outside the home-and-away rounds, any recorded mirror value.
 *   So it can only make a season that is complete in fact publishable; it never decides acceptance,
 *   eligibility or a winner. PUBLICATION STAYS THE SUPER ADMIN'S ACT (`/admin/brownlow`).
 *
 * WHAT IT NEVER DOES. No vote value, `played`, provenance, round or player changes (the backfill proves
 * every non-`match_id` column unchanged; the mirror proof below covers `player_match_stats`). No row is
 * inserted or deleted. Coverage, `brownlow_season_votes`, authority, eligibility and derived totals are
 * untouched: publication recomputes them.
 *
 * REVERSAL. `reverseSeasonAttachment` is the exact inverse for the same export, and refuses once the
 * season has been published (reverse the publication first, through its own audited correction).
 */

export const ATTACHMENT_FORMAT = 'afldb.brownlow.season-attachment';
export const ATTACHMENT_FORMAT_VERSION = 1;
export const ATTACHMENT_FIELD_GROUP = 'attach_round_votes';

export type AttachmentRefusalCode =
  | 'invalid_export'
  | 'export_digest_mismatch'
  | 'season_not_eligible'
  | 'season_incomplete'
  | 'mirror_conflict'
  | 'drift'
  | 'already_published';

export class AttachmentRefusal extends Error {
  readonly code: AttachmentRefusalCode;

  constructor(code: AttachmentRefusalCode, message: string) {
    super(message);
    this.name = 'AttachmentRefusal';
    this.code = code;
  }
}

const refuse = (code: AttachmentRefusalCode, message: string): never => {
  throw new AttachmentRefusal(code, message);
};

/** One mirror write: `player_match_stats(match, player).brownlow_votes` NULL -> `votes`. */
export interface MirrorCell {
  matchId: number;
  playerId: number;
  votes: number;
}

export interface SeasonAttachmentFacts {
  season: number;
  seasonStatus: string | null;
  coverage: string | null;
  publishedRevision: number | null;
  seasonTotalRows: number;
  roundRows: number;
  unattachedRows: number;
  positiveRows: number;
  votesTotal: number;
  homeAndAwayMatches: number;
  participantCells: number;
  participantCellsWithoutRow: number;
  mirrorRecorded: number;
  positiveOutsideHomeAndAway: number;
}

export interface SeasonAttachmentPlan {
  format: typeof ATTACHMENT_FORMAT;
  formatVersion: typeof ATTACHMENT_FORMAT_VERSION;
  season: number;
  facts: SeasonAttachmentFacts;
  /** Matches whose attached votes are exactly one 3, one 2 and one 1. Must equal `facts.homeAndAwayMatches`. */
  completeMatches: number;
  /** The reviewed backfill export for this season (unchanged format). */
  backfill: BackfillExport;
  /** Ascending by (matchId, playerId); every participant cell of every home-and-away match. */
  mirror: readonly MirrorCell[];
  /** sha256 over the backfill digest and the mirror lines. */
  digest: string;
}

export type SeasonAttachmentExport = Pick<
  SeasonAttachmentPlan,
  'format' | 'formatVersion' | 'season' | 'backfill' | 'mirror' | 'digest'
>;

export interface SeasonAttachmentResult {
  database: string;
  season: number;
  digest: string;
  committed: boolean;
  attached: number;
  mirrored: number;
  auditId: string | null;
  after: SeasonAttachmentFacts;
}

export function attachmentDigest(season: number, backfillDigest: string, mirror: readonly MirrorCell[]): string {
  const hash = createHash('sha256');
  hash.update(`${ATTACHMENT_FORMAT}/${ATTACHMENT_FORMAT_VERSION}\nseason=${season}\nbackfill=${backfillDigest}\n`);
  for (const cell of mirror) hash.update(`${cell.matchId}:${cell.playerId}:${cell.votes}\n`);
  return hash.digest('hex');
}

export function attachmentExportOf(plan: SeasonAttachmentPlan): SeasonAttachmentExport {
  return {
    format: plan.format, formatVersion: plan.formatVersion, season: plan.season,
    backfill: plan.backfill, mirror: plan.mirror, digest: plan.digest,
  };
}

/** Validate an export read from disk; its own digest must hold. */
export function parseAttachmentExport(value: unknown): SeasonAttachmentExport {
  const bad = (why: string): never => refuse('invalid_export', `The attachment export is not valid: ${why}.`);
  if (typeof value !== 'object' || value === null) return bad('not an object');
  const record = value as Record<string, unknown>;
  if (record.format !== ATTACHMENT_FORMAT || record.formatVersion !== ATTACHMENT_FORMAT_VERSION) return bad('format');
  const season = record.season;
  if (typeof season !== 'number' || !Number.isInteger(season)) return bad('season');
  if (typeof record.digest !== 'string' || !/^[0-9a-f]{64}$/.test(record.digest)) return bad('digest');
  const backfill = parseBackfillExport(record.backfill);
  if (backfill.seasons === null || backfill.seasons.length !== 1 || backfill.seasons[0] !== season) {
    return bad('the backfill export must be scoped to exactly this season');
  }
  if (!Array.isArray(record.mirror)) return bad('mirror');
  const mirror: MirrorCell[] = [];
  for (const cell of record.mirror as unknown[]) {
    const c = cell as Record<string, unknown>;
    if (![c.matchId, c.playerId, c.votes].every((n) => typeof n === 'number' && Number.isInteger(n))
      || (c.votes as number) < 0 || (c.votes as number) > 3) return bad('mirror cell');
    mirror.push({ matchId: c.matchId as number, playerId: c.playerId as number, votes: c.votes as number });
  }
  const parsed = { format: ATTACHMENT_FORMAT, formatVersion: ATTACHMENT_FORMAT_VERSION, season, backfill, mirror,
    digest: record.digest } as const;
  if (attachmentDigest(season, backfill.digest, mirror) !== parsed.digest) {
    refuse('export_digest_mismatch', 'The attachment export does not match its own digest; it was edited after it was produced.');
  }
  return parsed;
}

const FACTS_SQL = `
  SELECT $1::int AS season,
         (SELECT status::text FROM seasons WHERE year = $1) AS "seasonStatus",
         (SELECT coverage::text FROM stat_availability
           WHERE stat_key = 'brownlow_season_total' AND season = $1) AS coverage,
         (SELECT published_revision FROM brownlow_season_authority WHERE season = $1) AS "publishedRevision",
         (SELECT count(*) FROM brownlow_season_votes WHERE season = $1)::int AS "seasonTotalRows",
         (SELECT count(*) FROM brownlow_round_votes WHERE season = $1)::int AS "roundRows",
         (SELECT count(*) FROM brownlow_round_votes WHERE season = $1 AND match_id IS NULL)::int AS "unattachedRows",
         (SELECT count(*) FROM brownlow_round_votes WHERE season = $1 AND votes > 0)::int AS "positiveRows",
         (SELECT COALESCE(sum(votes), 0) FROM brownlow_round_votes WHERE season = $1)::int AS "votesTotal",
         (SELECT count(*) FROM matches WHERE season = $1 AND round_type = 'home_and_away')::int AS "homeAndAwayMatches",
         (SELECT count(*) FROM matches m JOIN player_match_stats p ON p.match_id = m.id
           WHERE m.season = $1 AND m.round_type = 'home_and_away')::int AS "participantCells",
         (SELECT count(*) FROM matches m JOIN player_match_stats p ON p.match_id = m.id
           WHERE m.season = $1 AND m.round_type = 'home_and_away'
             AND NOT EXISTS (SELECT 1 FROM brownlow_round_votes b
                              WHERE b.season = $1 AND b.player_id = p.player_id
                                AND b.round_number = m.round_number))::int AS "participantCellsWithoutRow",
         (SELECT count(*) FROM matches m JOIN player_match_stats p ON p.match_id = m.id
           WHERE m.season = $1 AND p.brownlow_votes IS NOT NULL)::int AS "mirrorRecorded",
         (SELECT count(*) FROM matches m JOIN player_match_stats p ON p.match_id = m.id
           WHERE m.season = $1 AND m.round_type <> 'home_and_away' AND p.brownlow_votes > 0)::int
           AS "positiveOutsideHomeAndAway"`;

export async function readAttachmentFacts(executor: SqlExecutor, season: number): Promise<SeasonAttachmentFacts> {
  const [row] = await executor.query<SeasonAttachmentFacts>(FACTS_SQL, [season]);
  return {
    ...row,
    season: Number(row.season),
    publishedRevision: row.publishedRevision === null ? null : Number(row.publishedRevision),
  };
}

/** The preconditions shared by plan and apply. */
function requireAttachable(facts: SeasonAttachmentFacts): void {
  const s = facts.season;
  if (facts.seasonStatus !== 'complete') {
    refuse('season_not_eligible', `Season ${s} is '${facts.seasonStatus ?? 'absent'}', not complete; its Brownlow is not attachable.`);
  }
  if (facts.coverage !== 'pending') {
    refuse('season_not_eligible', `Season ${s} Brownlow coverage is '${facts.coverage ?? 'absent'}', not pending.`);
  }
  if (facts.publishedRevision !== null || facts.seasonTotalRows > 0) {
    refuse('already_published', `Season ${s} already has published Brownlow totals.`);
  }
  if (facts.mirrorRecorded > 0) {
    refuse('mirror_conflict', `Season ${s} already records ${facts.mirrorRecorded} per-match Brownlow value(s); attachment only fills an empty mirror.`);
  }
  if (facts.positiveOutsideHomeAndAway > 0) {
    refuse('season_incomplete', `Season ${s} has positive votes outside the home-and-away rounds.`);
  }
  if (facts.homeAndAwayMatches === 0 || facts.participantCellsWithoutRow > 0 || facts.roundRows !== facts.participantCells) {
    refuse('season_incomplete',
      `Season ${s}: ${facts.participantCellsWithoutRow} home-and-away participant cell(s) without a round row; `
      + `${facts.roundRows} round rows for ${facts.participantCells} participant cells.`);
  }
}

/**
 * The per-match result of attaching through the candidate rule, computed from the plan's repairs (not
 * from stored `match_id`, which is still NULL at plan time): one row per home-and-away match.
 */
async function completenessOf(executor: SqlExecutor, season: number, repairs: BackfillExport['repairs']): Promise<{
  complete: number; mirror: MirrorCell[];
}> {
  const ids = repairs.map((r) => r.id);
  const matchIds = repairs.map((r) => r.matchId);
  const cells = await executor.query<{ matchId: number | string; playerId: number | string; votes: number | string }>(`
    WITH rep AS (SELECT * FROM unnest($2::bigint[], $3::int[]) AS r(id, match_id))
    SELECT rep.match_id AS "matchId", b.player_id AS "playerId", b.votes
      FROM rep JOIN brownlow_round_votes b ON b.id = rep.id
     WHERE b.season = $1
     ORDER BY rep.match_id, b.player_id`, [season, ids, matchIds]);
  const mirror = cells.map((c) => ({ matchId: Number(c.matchId), playerId: Number(c.playerId), votes: Number(c.votes) }));
  if (mirror.some((c) => !Number.isInteger(c.votes))) refuse('season_incomplete', `Season ${season} has a round row without a vote value.`);
  const byMatch = new Map<number, number[]>();
  for (const cell of mirror) {
    const list = byMatch.get(cell.matchId) ?? [];
    list.push(cell.votes);
    byMatch.set(cell.matchId, list);
  }
  let complete = 0;
  for (const votes of byMatch.values()) {
    const positives = votes.filter((v) => v > 0).sort();
    if (positives.join(',') === '1,2,3') complete += 1;
  }
  return { complete, mirror };
}

/** READ-ONLY. Run it in a read-only transaction. */
export async function planSeasonAttachment(executor: SqlExecutor, season: number): Promise<SeasonAttachmentPlan> {
  const facts = await readAttachmentFacts(executor, season);
  requireAttachable(facts);
  const backfillPlan = await planRoundVoteMatchBackfill(executor, { seasons: [season] });
  const excluded = Object.values(backfillPlan.excluded).reduce((a, b) => a + b, 0);
  if (excluded > 0 || backfillPlan.repairable !== facts.unattachedRows || facts.unattachedRows !== facts.roundRows) {
    refuse('season_incomplete',
      `Season ${season}: ${backfillPlan.repairable} of ${facts.roundRows} round rows attach by the rule `
      + `(${facts.unattachedRows} unattached, ${excluded} excluded: ${JSON.stringify(backfillPlan.excluded)}).`);
  }
  const backfill = exportOf(backfillPlan);
  const { complete, mirror } = await completenessOf(executor, season, backfill.repairs);
  if (complete !== facts.homeAndAwayMatches || mirror.length !== facts.participantCells) {
    refuse('season_incomplete',
      `Season ${season}: ${complete} of ${facts.homeAndAwayMatches} home-and-away matches hold exactly one 3, one 2 and one 1 `
      + `(${mirror.length} cells for ${facts.participantCells} participants).`);
  }
  return {
    format: ATTACHMENT_FORMAT, formatVersion: ATTACHMENT_FORMAT_VERSION, season, facts, completeMatches: complete,
    backfill, mirror, digest: attachmentDigest(season, backfill.digest, mirror),
  };
}

/** A TransactionalSqlExecutor whose nested `transaction` is a SAVEPOINT of `tx`, so a reviewed
 * module that opens its own transaction runs inside ours and commits or rolls back with it. */
function nested(tx: postgres.TransactionSql): TransactionalSqlExecutor {
  const base = postgresTransactionExecutor(tx);
  return {
    query: base.query,
    transaction: <T>(work: (inner: SqlExecutor) => Promise<T>) =>
      tx.savepoint((sp) => work(postgresTransactionExecutor(sp))) as Promise<T>,
  };
}

const MIRROR_FINGERPRINT_SQL = `
  SELECT md5(COALESCE(string_agg(concat_ws('|', p.match_id, p.player_id, p.brownlow_votes), E'\\n'
                      ORDER BY p.match_id, p.player_id), '')) AS fp, count(*)::int AS n
    FROM player_match_stats p JOIN matches m ON m.id = p.match_id
   WHERE m.season = $1`;

/** Everything in player_match_stats except brownlow_votes, for the season's matches. */
const PMS_OTHER_COLUMNS_SQL = `
  SELECT md5(COALESCE(string_agg((to_jsonb(p) - 'brownlow_votes')::text, E'\\n' ORDER BY p.match_id, p.player_id), '')) AS fp
    FROM player_match_stats p JOIN matches m ON m.id = p.match_id
   WHERE m.season = $1`;

class DryRunRollback extends Error {
  constructor(readonly result: SeasonAttachmentResult) {
    super('dry run: rolled back');
  }
}

/**
 * Apply a reviewed export. Without `commit: true` the whole transaction is rolled back after every
 * check has run (the dry run). `actorId` is the approving Super Admin's `auth_users.id` (named in the
 * approval; the import role cannot read `auth_users`, exactly like the admin writers, and the
 * `data_edits` foreign key refuses an unknown id); `note` is the human reason the season seal evaluates.
 */
export async function applySeasonAttachment(
  sql: postgres.Sql,
  request: {
    export: SeasonAttachmentExport;
    expectedDigest: string;
    expectedDatabase: string;
    actorId: number;
    note: string;
    commit: boolean;
    /** Optional target-identity proof, run first inside the write transaction (production CLI). */
    prove?: (executor: SqlExecutor) => Promise<void>;
  },
): Promise<SeasonAttachmentResult> {
  const reviewed = parseAttachmentExport(request.export);
  if (reviewed.digest !== request.expectedDigest) {
    refuse('export_digest_mismatch', 'The export digest is not the reviewed digest. Nothing was written.');
  }
  const season = reviewed.season;
  try {
    return await sql.begin(async (tx) => {
      const ex = postgresTransactionExecutor(tx);
      if (request.prove) await request.prove(ex);
      // Lock order as the reviewed backfill (settle gate, Brownlow admin lock, round votes), then the mirror.
      await ex.query(`SELECT set_config('lock_timeout', '30000', true)`);
      await ex.query('SELECT pg_advisory_xact_lock(717275, 4)');
      await ex.query('SELECT pg_advisory_xact_lock(717275, 3)');
      await ex.query('LOCK TABLE brownlow_round_votes IN SHARE ROW EXCLUSIVE MODE');
      await ex.query('LOCK TABLE player_match_stats, brownlow_season_votes, brownlow_season_authority, stat_availability IN SHARE ROW EXCLUSIVE MODE');


      const before = await readAttachmentFacts(ex, season);
      requireAttachable(before);
      // The plan must still derive exactly the reviewed export (no drift since review).
      const fresh = await planSeasonAttachment(ex, season);
      if (fresh.digest !== reviewed.digest) {
        refuse('drift', `Season ${season} changed since the export was reviewed (plan ${fresh.digest}, reviewed ${reviewed.digest}). Nothing was written.`);
      }
      const [otherBefore] = await ex.query<{ fp: string }>(PMS_OTHER_COLUMNS_SQL, [season]);

      const backfill = await applyRoundVoteMatchBackfill(nested(tx), {
        export: reviewed.backfill, expectedDigest: reviewed.backfill.digest, expectedDatabase: request.expectedDatabase,
      });

      const mirrored = await ex.query<{ n: number }>(`
        WITH cell AS (SELECT * FROM unnest($2::int[], $3::int[], $4::int[]) AS c(match_id, player_id, votes))
        UPDATE player_match_stats p
           SET brownlow_votes = cell.votes
          FROM cell, brownlow_round_votes b
         WHERE p.match_id = cell.match_id AND p.player_id = cell.player_id AND p.brownlow_votes IS NULL
           AND b.season = $1 AND b.match_id = cell.match_id AND b.player_id = cell.player_id AND b.votes = cell.votes
        RETURNING 1 AS n`,
      [season, reviewed.mirror.map((c) => c.matchId), reviewed.mirror.map((c) => c.playerId), reviewed.mirror.map((c) => c.votes)]);
      if (mirrored.length !== reviewed.mirror.length) {
        refuse('drift', `Mirror wrote ${mirrored.length} of ${reviewed.mirror.length} reviewed cells; rolled back.`);
      }

      // Proofs: every reviewed cell now mirrors its attached round row; nothing else in
      // player_match_stats moved; no unattached row remains; each match is exactly 3/2/1.
      const after = await readAttachmentFacts(ex, season);
      const [agree] = await ex.query<{ diff: number; complete: number }>(`
        SELECT (SELECT count(*) FROM matches m JOIN player_match_stats p ON p.match_id = m.id
                  LEFT JOIN brownlow_round_votes b ON b.match_id = m.id AND b.player_id = p.player_id
                 WHERE m.season = $1 AND m.round_type = 'home_and_away'
                   AND p.brownlow_votes IS DISTINCT FROM b.votes)::int AS diff,
               (SELECT count(*) FROM (
                  SELECT m.id FROM matches m JOIN brownlow_round_votes b ON b.match_id = m.id
                   WHERE m.season = $1 AND m.round_type = 'home_and_away'
                   GROUP BY m.id
                  HAVING sum(b.votes) = 6 AND count(*) FILTER (WHERE b.votes > 0) = 3
                     AND count(DISTINCT b.votes) FILTER (WHERE b.votes > 0) = 3) x)::int AS complete`, [season]);
      const [otherAfter] = await ex.query<{ fp: string }>(PMS_OTHER_COLUMNS_SQL, [season]);
      if (after.unattachedRows !== 0 || agree.diff !== 0 || agree.complete !== before.homeAndAwayMatches
        || after.mirrorRecorded !== reviewed.mirror.length || otherAfter.fp !== otherBefore.fp
        || after.votesTotal !== before.votesTotal || after.positiveRows !== before.positiveRows) {
        refuse('drift', `Post-write proof failed for ${season}: ${JSON.stringify({ after, agree })}; rolled back.`);
      }
      const [mirrorFp] = await ex.query<{ fp: string }>(MIRROR_FINGERPRINT_SQL, [season]);

      const audit = await recordDataEdit(tx, {
        tableName: 'brownlow_season_authority',
        rowId: season,
        fieldGroup: ATTACHMENT_FIELD_GROUP,
        oldValues: { unattachedRows: before.unattachedRows, mirrorRecorded: before.mirrorRecorded },
        newValues: {
          attached: backfill.applied, mirrored: mirrored.length, digest: reviewed.digest,
          backfillDigest: reviewed.backfill.digest, mirrorFingerprint: mirrorFp.fp,
          positiveRows: after.positiveRows, votesTotal: after.votesTotal, rule: reviewed.backfill.rule,
        },
        adminUserId: request.actorId,
        note: request.note,
        seal: { kind: 'seasons', seasons: [season] },
      });

      const result: SeasonAttachmentResult = {
        database: backfill.database, season, digest: reviewed.digest, committed: request.commit,
        attached: backfill.applied, mirrored: mirrored.length, auditId: request.commit ? audit.id : null, after,
      };
      if (!request.commit) throw new DryRunRollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
}

/**
 * The exact inverse for the same reviewed export: mirror cells back to NULL (only where they still hold
 * the exported value), then the reviewed backfill reversal. Refuses once the season is published.
 */
export async function reverseSeasonAttachment(
  sql: postgres.Sql,
  request: {
    export: SeasonAttachmentExport; expectedDigest: string; expectedDatabase: string; actorId: number; note: string; commit: boolean;
    prove?: (executor: SqlExecutor) => Promise<void>;
  },
): Promise<SeasonAttachmentResult> {
  const reviewed = parseAttachmentExport(request.export);
  if (reviewed.digest !== request.expectedDigest) refuse('export_digest_mismatch', 'Not the reviewed digest. Nothing was written.');
  const season = reviewed.season;
  try {
    return await sql.begin(async (tx) => {
      const ex = postgresTransactionExecutor(tx);
      if (request.prove) await request.prove(ex);
      await ex.query(`SELECT set_config('lock_timeout', '30000', true)`);
      await ex.query('SELECT pg_advisory_xact_lock(717275, 4)');
      await ex.query('SELECT pg_advisory_xact_lock(717275, 3)');
      await ex.query('LOCK TABLE brownlow_round_votes IN SHARE ROW EXCLUSIVE MODE');
      await ex.query('LOCK TABLE player_match_stats, brownlow_season_votes, brownlow_season_authority, stat_availability IN SHARE ROW EXCLUSIVE MODE');
      const before = await readAttachmentFacts(ex, season);
      if (before.publishedRevision !== null || before.seasonTotalRows > 0) {
        refuse('already_published', `Season ${season} has been published since the attachment; reverse the publication first.`);
      }
      const cleared = await ex.query<{ n: number }>(`
        WITH cell AS (SELECT * FROM unnest($1::int[], $2::int[], $3::int[]) AS c(match_id, player_id, votes))
        UPDATE player_match_stats p SET brownlow_votes = NULL
          FROM cell
         WHERE p.match_id = cell.match_id AND p.player_id = cell.player_id AND p.brownlow_votes = cell.votes
        RETURNING 1 AS n`,
      [reviewed.mirror.map((c) => c.matchId), reviewed.mirror.map((c) => c.playerId), reviewed.mirror.map((c) => c.votes)]);
      if (cleared.length !== reviewed.mirror.length) {
        refuse('drift', `Only ${cleared.length} of ${reviewed.mirror.length} mirror cells still hold the attached value; rolled back.`);
      }
      const backfill = await reverseRoundVoteMatchBackfill(nested(tx), {
        export: reviewed.backfill, expectedDigest: reviewed.backfill.digest, expectedDatabase: request.expectedDatabase,
      });
      const after = await readAttachmentFacts(ex, season);
      if (after.mirrorRecorded !== 0 || after.unattachedRows !== after.roundRows) {
        refuse('drift', `Reversal proof failed for ${season}: ${JSON.stringify(after)}; rolled back.`);
      }
      const audit = await recordDataEdit(tx, {
        tableName: 'brownlow_season_authority',
        rowId: season,
        fieldGroup: `${ATTACHMENT_FIELD_GROUP}_reverse`,
        oldValues: { attached: backfill.reverted, mirrored: cleared.length },
        newValues: { unattachedRows: after.unattachedRows, mirrorRecorded: 0, digest: reviewed.digest },
        adminUserId: request.actorId,
        note: request.note,
        seal: { kind: 'seasons', seasons: [season] },
      });
      const result: SeasonAttachmentResult = {
        database: backfill.database, season, digest: reviewed.digest, committed: request.commit,
        attached: -backfill.reverted, mirrored: -cleared.length, auditId: request.commit ? audit.id : null, after,
      };
      if (!request.commit) throw new DryRunRollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
}
