import 'server-only';

import { join } from 'node:path';

import type { Sql, TransactionSql } from 'postgres';

import { CONTINUITY_CONTRACT_SEGMENTS } from '@/db/queries/match-sheet';

import {
  loadPlayerMatchStatsAuthority,
  playerMatchStatsPairKey,
  type PlayerMatchStatsAuthority,
} from '../acquisition/manual-authority';
import {
  loadContinuityRulesFailClosed,
  seasonOfMatchKeyForAuthority,
} from '../acquisition/match-sheet-authority';
import { SETTLE_PROMOTION_GATE } from '../acquisition/settle-core';
import type { ImportBatchId } from '../import-batch-id';

/**
 * AFLDB-ISSUE-249: the two read-only resolvers accept a transaction handle as
 * well as a pool, so the first-kick-goal rehearsal can resolve inside the
 * transaction it rolls back. Type-only; the queries are unchanged.
 */
type ReadSql = Sql | TransactionSql;

/**
 * The dataset registry: what an administrator may upload, what it must
 * look like, and how a vetted file becomes rows in the statistical
 * tables.
 *
 * The pipeline is staged -> validated -> approved -> promoted.
 *
 *   staged     The file is stored byte-for-byte and parsed into rows.
 *   validated  Every row gets a verdict. Errors block approval;
 *              warnings (an unmatched player, a non-AFL club) do not,
 *              because "unlinked but preserved" is AFLDB's normal state
 *              for source names it cannot confidently identify.
 *   approved   A human read the report and said yes.
 *   promoted   Applied under the IMPORT role, in one transaction, as a
 *              tracked import batch — the same machinery as the bulk
 *              migration, so an upload is not a second, laxer path into
 *              the database.
 *
 * Adding a dataset means adding one spec here; the admin UI and the
 * pipeline are generic.
 */

export type RowVerdict = {
  verdict: 'ok' | 'warning' | 'error';
  reasons: string[];
  /** Enrichment carried to promotion (resolved ids), never shown as fact. */
  resolved?: Record<string, number | string | null>;
};

export type ValidationContext = {
  /** Read-only queries against reference data (players, clubs, seasons). */
  sql: Sql;
  /**
   * AFLDB-ISSUE-264: a season's active Match Sheet authority. afldb_auth cannot
   * read `data_overrides`, so the pipeline supplies this from a read-only
   * import-role transaction. Only `player_match_stats` asks for it, and fails
   * closed when it is absent.
   */
  matchSheetAuthority?: MatchSheetAuthorityReader;
};

export type MatchSheetAuthorityRead =
  | { ok: true; authority: PlayerMatchStatsAuthority }
  | { ok: false; reason: string };

export type MatchSheetAuthorityReader = (season: number) => Promise<MatchSheetAuthorityRead>;

/** One validated row as promotion hands it to `preparePromotion`. */
export type PromotionRow = {
  rowNo: number;
  payload: Record<string, string | null>;
  resolved: Record<string, number | string | null>;
};

export type DatasetSpec = {
  key: string;
  title: string;
  description: string;
  /** Columns that must exist in the header. Extra columns are ignored. */
  requiredColumns: string[];
  /** Duplicate keys within one file are an error. */
  fileKey: (row: Record<string, string | null>) => string;
  validateRow: (
    row: Record<string, string | null>,
    context: ValidationContext,
  ) => Promise<RowVerdict>;
  /**
   * Apply one validated row. Runs inside the promotion transaction under
   * the import role. Upserts by a natural/source key, so re-promoting a
   * corrected file updates rather than duplicates.
   */
  promoteRow: (
    row: Record<string, string | null>,
    resolved: Record<string, number | string | null>,
    context: { sql: Sql; awardId: number | null; sourceId: number; batchId: ImportBatchId },
  ) => Promise<void>;
  /**
   * Optional whole-submission check, run inside the promotion transaction
   * before anything is written and before the first `promoteRow`. Throwing
   * refuses the whole submission (it is rolled back and marked failed). Locks
   * it takes are held until the promotion commits, so a hook that takes any
   * bounds its wait with `withLegacyLockTimeout` and takes them in ascending
   * match id (AFLDB-ISSUE-264 F-002). `withLegacyLockTimeout` also takes the
   * exclusive settle/promotion gate before `work()`, so every hook that writes
   * matches goes through it (AFLDB-ISSUE-265).
   */
  preparePromotion?: (rows: readonly PromotionRow[], context: { sql: Sql }) => Promise<void>;
  /**
   * The award this dataset feeds, resolved once per promotion, for
   * award-shaped datasets only. Match/player-stat datasets feed the fact
   * tables directly and leave this unset; `awardId` is then null.
   */
  awardSlug?: string;
};

// --- Shared resolution helpers ---

function toIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** Upper bounds of the smallint and integer columns the readers below feed. */
const SMALLINT_MAX = 32_767;
const INTEGER_MAX = 2_147_483_647;

/**
 * AFLDB-ISSUE-258 (D-258-2): an optional count column has four states that
 * toIntOrNull() collapses into one. A column the file does not carry
 * (`undefined`) and a blank cell (`null`; toObjects() trims and nulls empty
 * cells) both read as null, and promotion treats null as "keep the stored
 * value" (D-258-3: blank never clears). Anything else must be a plain
 * non-negative whole number within the column's range; otherwise the column
 * is named in `reasons` and the row becomes an error, so a typing slip such
 * as `1O` or `12.5` blocks approval instead of erasing a stored figure.
 */
function optionalCountReader(row: Record<string, string | null>) {
  const reasons: string[] = [];
  const read = (column: string, max: number = SMALLINT_MAX): number | null => {
    const raw = row[column] as string | null | undefined;
    if (raw === undefined || raw === null || raw.trim() === '') return null;
    const text = raw.trim();
    if (/^\d+$/.test(text) && Number(text) <= max) return Number(text);
    reasons.push(`${column} "${raw}" must be a whole number from 0 to ${max}; `
      + 'leave the cell blank to keep the stored value');
    return null;
  };
  return { read, reasons };
}

export async function resolveSeason(sql: Sql, value: string | null): Promise<number | null> {
  const year = toIntOrNull(value);
  if (year === null) return null;
  const [row] = await sql<{ year: number }[]>`
    SELECT year FROM seasons WHERE year = ${year}
  `;
  return row?.year ?? null;
}

/** Club by any recorded alias, resolved to the identity of the season. */
export async function resolveClub(
  sql: ReadSql,
  name: string | null,
  season: number | null,
): Promise<{ id: number; name: string } | null> {
  if (!name) return null;
  const [row] = await sql<{ id: number; name: string }[]>`
    WITH candidate AS (
      SELECT c.id, c.organization_id
        FROM clubs c
       WHERE afldb_normalise_name(c.name) = afldb_normalise_name(${name})
      UNION
      SELECT c.id, c.organization_id
        FROM club_aliases a JOIN clubs c ON c.id = a.club_id
       WHERE afldb_normalise_name(a.alias) = afldb_normalise_name(${name})
    )
    SELECT c.id, c.name
      FROM candidate cand
      JOIN clubs c ON c.organization_id = cand.organization_id
     WHERE (${season}::int IS NULL)
        OR (c.first_season <= ${season} AND (c.last_season IS NULL OR c.last_season >= ${season}))
     ORDER BY c.first_season DESC NULLS LAST
     LIMIT 1
  `;
  return row ?? null;
}

/**
 * Player by name, season and club — the honest version.
 *
 * unique    exactly one player of that name played that season, or only
 *           one of them played for that club
 * ambiguous more than one candidate survives every filter
 * unmatched nobody of that name played that season
 *
 * The caller records the verdict; nothing here guesses.
 */
export async function resolvePlayer(
  sql: ReadSql,
  name: string | null,
  season: number | null,
  clubId: number | null,
): Promise<{ status: 'unique' | 'ambiguous' | 'unmatched'; playerId: number | null; count: number }> {
  if (!name) return { status: 'unmatched', playerId: null, count: 0 };

  const candidates = await sql<{ id: number; forClub: boolean }[]>`
    SELECT p.id,
           EXISTS (
             SELECT 1 FROM player_clubs pc
              WHERE pc.player_id = p.id
                AND (${clubId}::int IS NULL OR pc.club_id = ${clubId})
                AND (${season}::int IS NULL
                     OR (pc.first_season <= ${season} AND pc.last_season >= ${season}))
           ) AS "forClub"
      FROM players p
     WHERE p.search_name = afldb_normalise_name(${name})
       AND (${season}::int IS NULL
            OR (p.debut_season <= ${season}
                AND COALESCE(p.final_season, 9999) >= ${season}))
  `;

  if (candidates.length === 0) return { status: 'unmatched', playerId: null, count: 0 };
  if (candidates.length === 1) {
    return { status: 'unique', playerId: candidates[0].id, count: 1 };
  }
  const forClub = candidates.filter((c) => c.forClub);
  if (forClub.length === 1) {
    return { status: 'unique', playerId: forClub[0].id, count: candidates.length };
  }
  return { status: 'ambiguous', playerId: null, count: candidates.length };
}

/** Venue by any recorded alias, same shape as resolveClub. */
async function resolveVenue(
  sql: Sql,
  name: string | null,
  season: number | null,
): Promise<{ id: number; name: string } | null> {
  if (!name) return null;
  const [row] = await sql<{ id: number; name: string }[]>`
    WITH candidate AS (
      SELECT v.id
        FROM venues v
       WHERE afldb_normalise_name(v.canonical_name) = afldb_normalise_name(${name})
          OR afldb_normalise_name(v.legacy_name) = afldb_normalise_name(${name})
      UNION
      SELECT a.venue_id
        FROM venue_aliases a
       WHERE afldb_normalise_name(a.alias) = afldb_normalise_name(${name})
    )
    SELECT v.id, v.canonical_name AS name
      FROM candidate cand
      JOIN venues v ON v.id = cand.id
     WHERE (${season}::int IS NULL)
        OR ((v.first_season IS NULL OR v.first_season <= ${season})
            AND (v.last_season IS NULL OR v.last_season >= ${season}))
     LIMIT 1
  `;
  return row ?? null;
}

/**
 * An existing match by its natural key — season, round and the two
 * clubs, order-independent (a CSV row might list either side first).
 *
 * unique     exactly one match fits
 * ambiguous  more than one match shares this season/round/pairing
 *            (a rare, genuinely re-played round is possible historically)
 * unmatched  no such match exists — the caller's standard advice is to
 *            upload the match-results file first
 */
async function resolveMatch(
  sql: Sql,
  season: number | null,
  roundCode: string | null,
  homeClubId: number | null,
  awayClubId: number | null,
): Promise<{ status: 'unique' | 'ambiguous' | 'unmatched'; matchId: number | null; count: number }> {
  if (season === null || !roundCode || homeClubId === null || awayClubId === null) {
    return { status: 'unmatched', matchId: null, count: 0 };
  }
  const candidates = await sql<{ id: number }[]>`
    SELECT id FROM matches
     WHERE season = ${season} AND round_code = ${roundCode}
       AND ((home_club_id = ${homeClubId} AND away_club_id = ${awayClubId})
         OR (home_club_id = ${awayClubId} AND away_club_id = ${homeClubId}))
  `;
  if (candidates.length === 0) return { status: 'unmatched', matchId: null, count: 0 };
  if (candidates.length === 1) return { status: 'unique', matchId: candidates[0].id, count: 1 };
  return { status: 'ambiguous', matchId: null, count: candidates.length };
}

// --- Dataset: Rising Star nominations ---

const risingStar: DatasetSpec = {
  key: 'rising_star',
  title: 'Rising Star nominations',
  description:
    'Round-by-round Rising Star nominations in the FootyWire export layout '
    + '(one season per file or many; keyed by source_key).',
  requiredColumns: ['source_key', 'season', 'round_number', 'player', 'club'],
  awardSlug: 'rising-star',
  fileKey: (row) => row.source_key ?? '',

  async validateRow(row, { sql }) {
    const reasons: string[] = [];
    let verdict: RowVerdict['verdict'] = 'ok';

    if (!row.source_key) {
      return { verdict: 'error', reasons: ['source_key is empty'] };
    }
    const season = await resolveSeason(sql, row.season);
    if (season === null) {
      return { verdict: 'error', reasons: [`season ${row.season ?? '(empty)'} does not exist`] };
    }
    if (!row.player) {
      return { verdict: 'error', reasons: ['player is empty'] };
    }
    const round = toIntOrNull(row.round_number);
    if (round === null || round < 0 || round > 30) {
      return { verdict: 'error', reasons: [`round_number ${row.round_number ?? '(empty)'} is not a round`] };
    }

    const club = await resolveClub(sql, row.club, season);
    if (!club) {
      verdict = 'warning';
      reasons.push(`club "${row.club}" is not an AFL club; kept as text`);
    }
    const opponent = await resolveClub(sql, row.opponent, season);

    const player = await resolvePlayer(sql, row.player, season, club?.id ?? null);
    if (player.status !== 'unique') {
      verdict = 'warning';
      reasons.push(
        player.status === 'unmatched'
          ? `player "${row.player}" not found for ${season}; will import unlinked`
          : `player "${row.player}" is ambiguous (${player.count} candidates); will import unlinked`,
      );
    }

    return {
      verdict,
      reasons,
      resolved: {
        season,
        club_id: club?.id ?? null,
        opponent_club_id: opponent?.id ?? null,
        player_id: player.playerId,
        link_status: player.status,
        round_number: round,
      },
    };
  },

  async promoteRow(row, resolved, { sql, awardId, sourceId, batchId }) {
    const stats: Record<string, number> = {};
    for (const key of ['kicks', 'handballs', 'disposals', 'marks', 'goals', 'behinds',
      'tackles', 'hitouts', 'frees_for', 'frees_against', 'supercoach', 'afl_fantasy']) {
      const value = toIntOrNull(row[key]);
      if (value !== null) stats[key] = value;
    }

    await sql`
      INSERT INTO award_nominations
        (award_id, season, round_number, player_id, player_name_raw,
         link_status_value, club_id, opponent_club_id, is_winner, is_ineligible,
         ineligible_reason, votes, stat_line, source_id, source_record_id,
         import_batch_id)
      VALUES
        (${awardId}, ${resolved.season}, ${resolved.round_number},
         ${resolved.player_id}, ${row.player},
         ${resolved.link_status === 'unique' ? 'unique' : resolved.link_status}::link_status,
         ${resolved.club_id}, ${resolved.opponent_club_id},
         ${row.is_season_winner === '1'}, ${row.ineligible === '1'},
         ${row.ineligible_reason ?? null}, ${toIntOrNull(row.votes)},
         ${Object.keys(stats).length ? sql.json(stats) : null},
         ${sourceId}, ${row.source_key}, ${batchId})
      ON CONFLICT (award_id, source_record_id) WHERE source_record_id IS NOT NULL
      DO UPDATE SET
         season = EXCLUDED.season,
         round_number = EXCLUDED.round_number,
         player_id = EXCLUDED.player_id,
         player_name_raw = EXCLUDED.player_name_raw,
         link_status_value = EXCLUDED.link_status_value,
         club_id = EXCLUDED.club_id,
         opponent_club_id = EXCLUDED.opponent_club_id,
         is_winner = EXCLUDED.is_winner,
         is_ineligible = EXCLUDED.is_ineligible,
         ineligible_reason = EXCLUDED.ineligible_reason,
         votes = EXCLUDED.votes,
         stat_line = EXCLUDED.stat_line,
         import_batch_id = EXCLUDED.import_batch_id
    `;
  },
};

// --- Dataset: All-Australian selections ---

const allAustralian: DatasetSpec = {
  key: 'all_australian',
  title: 'All-Australian selections',
  description:
    'All-Australian teams in the DraftGuru export layout '
    + '(Player, Club, Position, Captain, Year).',
  requiredColumns: ['player', 'year'],
  awardSlug: 'all-australian',
  fileKey: (row) => `${row.year}:${row.player}:${row.club ?? ''}`,

  async validateRow(row, { sql }) {
    const reasons: string[] = [];
    let verdict: RowVerdict['verdict'] = 'ok';

    if (!row.player) return { verdict: 'error', reasons: ['player is empty'] };
    const season = await resolveSeason(sql, row.year);
    if (season === null) {
      return { verdict: 'error', reasons: [`year ${row.year ?? '(empty)'} does not exist`] };
    }

    const club = await resolveClub(sql, row.club, season);
    if (row.club && !club) {
      verdict = 'warning';
      reasons.push(`club "${row.club}" is not an AFL club; kept as text`);
    }

    const player = await resolvePlayer(sql, row.player, season, club?.id ?? null);
    if (player.status !== 'unique') {
      verdict = 'warning';
      reasons.push(
        player.status === 'unmatched'
          ? `player "${row.player}" not found for ${season}; will import unlinked`
          : `player "${row.player}" is ambiguous (${player.count} candidates); will import unlinked`,
      );
    }

    return {
      verdict,
      reasons,
      resolved: {
        season,
        club_id: club?.id ?? null,
        player_id: player.playerId,
        link_status: player.status,
      },
    };
  },

  async promoteRow(row, resolved, { sql, awardId, sourceId, batchId }) {
    const recordId = `${resolved.season}:${row.player}:${row.club ?? ''}`;

    // AFLDB-ISSUE-165 D-12. This is the SECOND writer of award_winners, and it
    // knows nothing about the correction/void lifecycle: the upsert below
    // re-asserts season, player, club, position and the captaincy flags from
    // the file on every promotion. If an administrator has corrected or voided
    // the row this file names, promoting over it would silently revert a human
    // decision that src/db/queries/admin-awards.ts recorded durably — the same
    // failure the awards importer needed replay_admin_overrides() to avoid.
    //
    // The answer here is a REFUSAL, not a replay. Teaching this writer full
    // override semantics would put a second, divergent implementation of the
    // replay in the ingest pipeline; refusing states the conflict plainly and
    // leaves the operator to resolve it in /admin/awards (reinstate the row,
    // or retire the override) before re-approving the submission. A 'record'
    // override is deliberately NOT a blocker: those name manual_admin_edit rows
    // this pipeline can never address, because its own source key is different.
    const [held] = await sql<{ fieldGroup: string; entityKey: string }[]>`
      SELECT o.field_group AS "fieldGroup", o.entity_key AS "entityKey"
        FROM data_overrides o
        JOIN sources s ON s.id = ${sourceId}
       WHERE o.entity_type = 'award_winners'
         AND o.is_active = true
         AND o.field_group IN ('lifecycle', 'correction')
         AND o.entity_key = s.key || ':' || ${recordId}
       ORDER BY o.field_group
       LIMIT 1
    `;
    if (held) {
      throw new Error(
        `"${row.player}" (${resolved.season}) carries an active ${held.fieldGroup} `
        + `decision recorded in /admin/awards (${held.entityKey}). Promoting this file `
        + 'would overwrite it. Resolve the row there first, then re-approve this submission.',
      );
    }

    await sql`
      INSERT INTO award_winners
        (award_id, season, player_id, player_name_raw, link_status_value,
         candidate_count, club_id, club_name_raw, position,
         is_captain, is_vice_captain, source_id, source_record_id, import_batch_id)
      VALUES
        (${awardId}, ${resolved.season}, ${resolved.player_id}, ${row.player},
         ${resolved.link_status === 'unique' ? 'unique' : resolved.link_status}::link_status,
         0, ${resolved.club_id}, ${row.club ?? null}, ${row.position ?? null},
         ${(row.captain ?? '').toLowerCase() === 'c' || row.captain === '1'},
         ${(row.captain ?? '').toLowerCase() === 'vc'},
         ${sourceId}, ${recordId}, ${batchId})
      ON CONFLICT (award_id, source_record_id) WHERE source_record_id IS NOT NULL
      DO UPDATE SET
         season = EXCLUDED.season,
         player_id = EXCLUDED.player_id,
         player_name_raw = EXCLUDED.player_name_raw,
         link_status_value = EXCLUDED.link_status_value,
         club_id = EXCLUDED.club_id,
         club_name_raw = EXCLUDED.club_name_raw,
         position = EXCLUDED.position,
         is_captain = EXCLUDED.is_captain,
         is_vice_captain = EXCLUDED.is_vice_captain,
         import_batch_id = EXCLUDED.import_batch_id
    `;
  },
};

// --- Dataset: Match results ---

/**
 * Round code -> canonical `round_type` for every round that is not home-and-away.
 * The name is historical: membership means "not a home-and-away premiership-points
 * round" (`matches.is_final`), not finals-series membership
 * (`matches.is_finals_series`). `WF` — the AFL Wildcard Round — belongs here and is
 * deliberately not collapsed into an existing finals type. See AFLDB-ISSUE-129 §8.4.
 * Kept in step with `FINALS_CODES` in `tools/migration/import_fitzroy_core.py`.
 */
const FINALS_ROUND_TYPES: Record<string, string> = {
  EF: 'elimination_final',
  QF: 'qualifying_final',
  SF: 'semi_final',
  PF: 'preliminary_final',
  GF: 'grand_final',
  WF: 'wildcard_final',
};

/**
 * The natural key match_results promotes by (season|round|date|home|away,
 * using the era-appropriate club identity's name). Shared by validation,
 * which reads the stored match it would update, and promotion.
 */
type KeyPart = number | string | null | undefined;
function matchResultsKey(
  season: KeyPart, roundCode: KeyPart, matchDate: KeyPart, homeName: KeyPart, awayName: KeyPart,
): string {
  return `${season}|${roundCode}|${matchDate}|${homeName}|${awayName}`;
}

/**
 * AFLDB-ISSUE-264 F-002 / AFLDB-ISSUE-265 — the locks the three legacy match writers take.
 *
 * `match_results`, `player_match_stats` and `match_attendance` all take their match
 * locks in `preparePromotion`, in ONE statement, ascending id (the order
 * `canonical-apply` uses for a rekey), before the first write. Two promotions, a
 * rekey and a Match Sheet save therefore queue behind one another instead of
 * crossing.
 *
 * ISSUE-265: before those match locks, each hook takes the settle/promotion gate
 * EXCLUSIVELY, inside `withLegacyLockTimeout` and so under its 5 s bound. A source
 * settle takes the same advisory lock shared before it writes anything
 * (`acquireSettlePromotionGate`), so a settle and a promotion never hold match row
 * locks at the same time and no settle-versus-promotion lock cycle can form. A
 * promotion that arrives while a settle runs, or while another promotion holds the
 * gate, waits at most 5 s and is refused retryably with nothing written. Promotions
 * therefore also serialise with one another.
 */
const LEGACY_LOCK_TIMEOUT = '5s';

export const LEGACY_PROMOTION_LOCK_REFUSAL =
  'Another operation (a Match Sheet save, a source settle or another promotion) is holding a match '
  + 'this file writes to. Nothing was promoted; promote this submission again in a moment.';

/** 55P03 (lock timeout) or 40P01 (deadlock victim) is retryable; any other error is not. */
export function legacyPromotionRetryableRefusal(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === '55P03' || code === '40P01' ? LEGACY_PROMOTION_LOCK_REFUSAL : null;
}

/**
 * Runs a hook's lock acquisition under a 5 s `lock_timeout`. The setting is
 * transaction-local (`set_config(..., true)`), so it cannot outlive the
 * promotion transaction on a pooled connection. On success the previous value
 * is restored, so the hook's bound does not apply to the row writes that follow;
 * on failure the pipeline's savepoint rolls back and reverts it. A lock wait
 * that times out, or a deadlock this transaction loses, becomes the retryable
 * refusal; every other error, including a real refusal, passes through.
 *
 * ISSUE-265: the order is the two setting statements (read the previous value,
 * set the 5 s bound), then the exclusive settle/promotion gate, then `work()`.
 * The gate is therefore bounded by the same 5 s and precedes every match lock.
 */
async function withLegacyLockTimeout(sql: Sql, work: () => Promise<void>): Promise<void> {
  const [{ previous }] = await sql<{ previous: string }[]>`SELECT current_setting('lock_timeout') AS previous`;
  await sql`SELECT set_config('lock_timeout', ${LEGACY_LOCK_TIMEOUT}, true)`;
  try {
    await sql`SELECT pg_advisory_xact_lock(${SETTLE_PROMOTION_GATE.classId}, ${SETTLE_PROMOTION_GATE.objId})`;
    await work();
  } catch (error) {
    const refusal = legacyPromotionRetryableRefusal(error);
    if (refusal !== null) throw new Error(refusal, { cause: error });
    throw error;
  }
  await sql`SELECT set_config('lock_timeout', ${previous}, true)`;
}

const matchResults: DatasetSpec = {
  key: 'match_results',
  title: 'Match results',
  description:
    'One row per match: season, round, date, venue, clubs and final score. '
    + 'Upserts by season/round/date/clubs, so re-uploading a corrected file (a fixed '
    + 'attendance figure, a corrected score) updates the same match rather than duplicating it.',
  requiredColumns: [
    'season', 'round_code', 'match_date', 'venue', 'home_club', 'away_club',
    'home_score', 'away_score',
  ],
  fileKey: (row) => `${row.season}|${row.round_code}|${row.match_date}|${row.home_club}|${row.away_club}`,

  async validateRow(row, { sql }) {
    const reasons: string[] = [];
    let verdict: RowVerdict['verdict'] = 'ok';

    // AFLDB-ISSUE-258: every optional count is read before any lookup, so a
    // malformed cell is reported (all of them at once) rather than nulled.
    const counts = optionalCountReader(row);
    const homeGoals = counts.read('home_goals');
    const homeBehinds = counts.read('home_behinds');
    const awayGoals = counts.read('away_goals');
    const awayBehinds = counts.read('away_behinds');
    const attendance = counts.read('attendance', INTEGER_MAX);
    if (counts.reasons.length > 0) return { verdict: 'error', reasons: counts.reasons };

    const season = await resolveSeason(sql, row.season);
    if (season === null) {
      return { verdict: 'error', reasons: [`season ${row.season ?? '(empty)'} does not exist`] };
    }

    const roundCode = (row.round_code ?? '').trim();
    if (!roundCode) return { verdict: 'error', reasons: ['round_code is empty'] };
    const roundNumber = toIntOrNull(row.round_number);
    const finalsType = FINALS_ROUND_TYPES[roundCode.toUpperCase()];

    let roundType: string;
    if (finalsType) {
      if (roundNumber !== null) {
        return {
          verdict: 'error',
          reasons: [`round_code "${roundCode}" is a non-home-and-away round code; round_number must be empty`],
        };
      }
      roundType = finalsType;
    } else if (roundNumber !== null) {
      roundType = 'home_and_away';
    } else {
      return {
        verdict: 'error',
        reasons: [`round_code "${roundCode}" is not a recognised round code (EF/QF/SF/PF/GF/WF) `
          + 'and round_number is empty'],
      };
    }

    if (!row.match_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.match_date)) {
      return { verdict: 'error', reasons: [`match_date "${row.match_date ?? '(empty)'}" must be YYYY-MM-DD`] };
    }

    const home = await resolveClub(sql, row.home_club, season);
    if (!home) {
      return { verdict: 'error', reasons: [`home_club "${row.home_club}" is not a recognised club for ${season}`] };
    }
    const away = await resolveClub(sql, row.away_club, season);
    if (!away) {
      return { verdict: 'error', reasons: [`away_club "${row.away_club}" is not a recognised club for ${season}`] };
    }
    if (home.id === away.id) {
      return { verdict: 'error', reasons: ['home_club and away_club are the same club'] };
    }

    if (!row.venue) return { verdict: 'error', reasons: ['venue is empty'] };
    const venue = await resolveVenue(sql, row.venue, season);
    if (!venue) {
      verdict = 'warning';
      reasons.push(`venue "${row.venue}" is not recognised; kept as text`);
    }

    const homeScore = toIntOrNull(row.home_score);
    const awayScore = toIntOrNull(row.away_score);
    if (homeScore === null || homeScore < 0) {
      return { verdict: 'error', reasons: [`home_score "${row.home_score}" must be a non-negative whole number`] };
    }
    if (awayScore === null || awayScore < 0) {
      return { verdict: 'error', reasons: [`away_score "${row.away_score}" must be a non-negative whole number`] };
    }

    if (homeGoals !== null && homeBehinds !== null && homeGoals * 6 + homeBehinds !== homeScore) {
      return { verdict: 'error', reasons: ['home_goals and home_behinds do not add up to home_score'] };
    }
    if (awayGoals !== null && awayBehinds !== null && awayGoals * 6 + awayBehinds !== awayScore) {
      return { verdict: 'error', reasons: ['away_goals and away_behinds do not add up to away_score'] };
    }

    // AFLDB-ISSUE-258: a goals or behinds cell the file leaves empty keeps
    // the stored figure on an existing match, so the breakdown that must add
    // up (matches_score_components_ck, migration 022) is the stored one
    // overlaid with the file's. Checked here so the reviewer sees it; the
    // constraint stays the backstop at promotion.
    if (homeGoals === null || homeBehinds === null || awayGoals === null || awayBehinds === null) {
      const [stored] = await sql<{
        homeGoals: number | null; homeBehinds: number | null;
        awayGoals: number | null; awayBehinds: number | null;
      }[]>`
        SELECT home_goals AS "homeGoals", home_behinds AS "homeBehinds",
               away_goals AS "awayGoals", away_behinds AS "awayBehinds"
          FROM matches
         WHERE match_key = ${matchResultsKey(season, row.round_code, row.match_date, home.name, away.name)}
      `;
      if (stored) {
        const sides = [
          ['home', homeScore, homeGoals ?? stored.homeGoals, homeBehinds ?? stored.homeBehinds],
          ['away', awayScore, awayGoals ?? stored.awayGoals, awayBehinds ?? stored.awayBehinds],
        ] as const;
        for (const [side, score, goals, behinds] of sides) {
          if (goals !== null && behinds !== null && goals * 6 + behinds !== score) {
            return {
              verdict: 'error',
              reasons: [`${side}_goals ${goals} and ${side}_behinds ${behinds} (the stored figure `
                + `where the file is blank) do not add up to ${side}_score ${score}; `
                + `supply both ${side}_goals and ${side}_behinds`],
            };
          }
        }
      }
    }

    // matches.attendance_status (migration 020) must agree with attendance
    // in both directions, and a genuine zero crowd requires a cited
    // source this CSV format has no column for -- refuse rather than
    // violate the constraint or silently invent a citation.
    if (attendance === 0) {
      return {
        verdict: 'error',
        reasons: ['attendance of exactly 0 needs a cited source; leave attendance blank if merely unknown'],
      };
    }
    const attendanceStatus = attendance !== null ? 'complete' : 'not_collected';

    const result = homeScore === awayScore ? 'draw' : homeScore > awayScore ? 'home_win' : 'away_win';
    const winnerClubId = result === 'draw' ? null : result === 'home_win' ? home.id : away.id;
    const margin = Math.abs(homeScore - awayScore);

    return {
      verdict,
      reasons,
      resolved: {
        season, round_number: roundNumber, round_type: roundType,
        home_club_id: home.id, home_club_name: home.name,
        away_club_id: away.id, away_club_name: away.name,
        venue_id: venue?.id ?? null,
        home_score: homeScore, home_goals: homeGoals, home_behinds: homeBehinds,
        away_score: awayScore, away_goals: awayGoals, away_behinds: awayBehinds,
        attendance, attendance_status: attendanceStatus,
        result, winner_club_id: winnerClubId, margin,
      },
    };
  },

  // AFLDB-ISSUE-264 F-002: lock the EXISTING target matches, ascending id, with the
  // strength the upsert below takes anyway (`ON CONFLICT DO UPDATE` never changes
  // match_key, so it is FOR NO KEY UPDATE; no lock is upgraded later). The upserts
  // then run in file order against rows already held, so this writer takes match
  // locks in the same order as player_match_stats' hook and as a rekey. A row that
  // inserts a new match has nothing to lock.
  async preparePromotion(rows, { sql }) {
    const keys = new Set<string>();
    for (const row of rows) {
      const { season, home_club_name: homeName, away_club_name: awayName } = row.resolved;
      const { round_code: roundCode, match_date: matchDate } = row.payload;
      if (typeof season !== 'number' || typeof homeName !== 'string' || typeof awayName !== 'string'
        || !roundCode || !matchDate) {
        throw new Error(`Row ${row.rowNo} carries no resolved season, clubs, round or date; re-validate the submission.`);
      }
      keys.add(matchResultsKey(season, roundCode, matchDate, homeName, awayName));
    }
    await withLegacyLockTimeout(sql, async () => {
      await sql`
        SELECT id::int AS id
          FROM matches
         WHERE match_key = ANY(${[...keys]}::text[])
         ORDER BY id
           FOR NO KEY UPDATE
      `;
    });
  },

  async promoteRow(row, resolved, { sql, sourceId, batchId }) {
    // Reproduces the natural key documented on the matches table itself
    // (season|round|date|home|away, using the era-appropriate club
    // identity's name) so re-uploading a corrected file about an
    // existing historical match updates it rather than duplicating it.
    // AFLDB-ISSUE-185: this same string is also this dataset's
    // source_record_id -- there is no external id in the CSV to carry
    // instead (the file has no source_key column, unlike rising_star),
    // so it follows all_australian's convention of deriving one from the
    // resolved identifying fields rather than inventing a new format.
    const matchKey = matchResultsKey(
      resolved.season, row.round_code, row.match_date,
      resolved.home_club_name, resolved.away_club_name,
    );

    await sql`
      INSERT INTO matches
        (match_key, season, round_code, round_number, round_type, is_final,
         match_date, venue_id, venue_raw, home_club_id, away_club_id,
         home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
         result, winner_club_id, margin, attendance, attendance_status,
         source_id, source_record_id, import_batch_id)
      VALUES
        (${matchKey}, ${resolved.season}, ${row.round_code}, ${resolved.round_number},
         ${resolved.round_type}::round_type, ${resolved.round_type !== 'home_and_away'},
         ${row.match_date}, ${resolved.venue_id}, ${row.venue},
         ${resolved.home_club_id}, ${resolved.away_club_id},
         ${resolved.home_goals}, ${resolved.home_behinds}, ${resolved.home_score},
         ${resolved.away_goals}, ${resolved.away_behinds}, ${resolved.away_score},
         ${resolved.result}::match_result, ${resolved.winner_club_id}, ${resolved.margin},
         ${resolved.attendance}, ${resolved.attendance_status}::coverage_status,
         ${sourceId || null}, ${matchKey}, ${batchId})
      ON CONFLICT (match_key) DO UPDATE SET
         round_number = EXCLUDED.round_number,
         round_type   = EXCLUDED.round_type,
         is_final     = EXCLUDED.is_final,
         venue_id     = EXCLUDED.venue_id,
         venue_raw    = EXCLUDED.venue_raw,
         home_goals   = COALESCE(EXCLUDED.home_goals, matches.home_goals),
         home_behinds = COALESCE(EXCLUDED.home_behinds, matches.home_behinds),
         home_score   = EXCLUDED.home_score,
         away_goals   = COALESCE(EXCLUDED.away_goals, matches.away_goals),
         away_behinds = COALESCE(EXCLUDED.away_behinds, matches.away_behinds),
         away_score   = EXCLUDED.away_score,
         result            = EXCLUDED.result,
         winner_club_id    = EXCLUDED.winner_club_id,
         margin            = EXCLUDED.margin,
         -- attendance and attendance_status move together
         -- (matches_attendance_status_ck): a file silent on attendance keeps
         -- both, a supplied figure sets both.
         attendance        = COALESCE(EXCLUDED.attendance, matches.attendance),
         attendance_status = CASE WHEN EXCLUDED.attendance IS NULL
                                  THEN matches.attendance_status
                                  ELSE EXCLUDED.attendance_status END
      -- AFLDB-ISSUE-258 (D-258-2/3): a NULL optional figure above means the
      -- file was silent (no column, or a blank cell) and keeps the stored
      -- value; a malformed cell never reaches here, validation refuses it.
      -- On INSERT there is nothing to keep, so it stays not recorded.
      -- source_id/source_record_id/import_batch_id are deliberately absent
      -- from this SET list (AFLDB-ISSUE-185): they are creation provenance,
      -- stamped once on INSERT only. An UPDATE here means a corrected file
      -- was re-promoted against an EXISTING canonical row -- which may be
      -- owned by afltables, manual_admin_edit, or an earlier promotion --
      -- and must never silently reassign that row's provenance, exactly as
      -- applyMatchEdit's score/attendance-group corrections never do.
    `;
  },
};

// --- Dataset: Player match stats ---

/** Every nullable statistic player_match_stats carries (migration 004). */
const STAT_COLUMNS = [
  'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts',
  'tackles', 'rebounds', 'inside_50s', 'clearances', 'clangers',
  'frees_for', 'frees_against', 'contested', 'uncontested', 'contested_marks',
  'marks_inside_50', 'one_percenters', 'bounces', 'goal_assists',
] as const;

/**
 * AFLDB-ISSUE-264 — the legacy file against durable Match Sheet authority.
 *
 * ISSUE-257 records each Match Sheet change in `data_overrides`. This writer
 * does not replay that authority (a second, divergent implementation, as
 * ISSUE-165 D-12 recorded for `all_australian`); it REFUSES a row that would
 * revert it, at validation for the report and again inside promotion under
 * the match lock. The authority is the settle's own reader
 * (`loadPlayerMatchStatsAuthority` -> `buildPlayerMatchStatsAuthority`): the
 * same key decoding, identity and continuity resolution, club check and
 * fail-closed marking, with no second implementation here.
 *
 * Against what promotion would actually write (`promoteRow` below):
 * - `club_id` is always written, so a protected club refuses unless equal;
 * - any other column writes only when supplied (ISSUE-258 `COALESCE`), so an
 *   absent or blank cell never conflicts; a supplied value refuses unless it
 *   equals the protected one. kicks, handballs and disposals are protected as
 *   one unit (`COUPLED_DISPOSAL_FIELDS`), so each supplied member is compared;
 * - a durable removal refuses the row outright: it would re-insert it;
 * - a durable addition stands: compatible values pass and the upsert leaves the
 *   row's ownership (`source_id`) alone, but an addition with no protected club
 *   or (at promotion) no row is an unexpected state and refuses;
 * - anything indeterminate for the row's match refuses.
 *
 * Returns the reason, or null when the row may be written. Pure.
 */
export function legacyStatsAuthorityRefusal(input: {
  authority: PlayerMatchStatsAuthority;
  playerId: number;
  matchId: number;
  /** The resolved values promoteRow writes. */
  write: Readonly<Record<string, number | string | null | undefined>>;
  /** Whether the row exists now; null when unknown (validation cannot read it). */
  rowExists: boolean | null;
}): string | null {
  const { authority } = input;
  if (authority.allIndeterminate) {
    return 'the stored Match Sheet authority cannot be read (a record does not decode, '
      + 'or the continuity contract is unreadable)';
  }
  if (authority.indeterminateMatchIds.has(input.matchId)) {
    return 'this match carries Match Sheet authority that cannot be attributed to exactly one '
      + 'player (unreadable, unresolved or duplicated, or naming a club outside the match)';
  }
  const pair = authority.byPair.get(playerMatchStatsPairKey(input.playerId, input.matchId));
  if (pair === undefined) return null;
  if (pair.presence === 'removed') {
    return 'the Match Sheet removed this player from this match; promoting would re-insert the row';
  }
  if (pair.presence === 'present') {
    if (pair.clubId === null) {
      return 'the Match Sheet added this player but records no club for the addition (unexpected state)';
    }
    if (input.rowExists === false) {
      return 'the Match Sheet added this player but the row is missing (unexpected state)';
    }
  }

  const conflicts: string[] = [];
  for (const [field, kept] of Object.entries(pair.fields ?? {})) {
    if (field === 'club_slug') {
      const supplied = input.write.club_id ?? null;
      if (supplied === null || Number(supplied) !== pair.clubId) {
        conflicts.push(`club_id (file ${supplied ?? 'blank'}, Match Sheet ${pair.clubId})`);
      }
      continue;
    }
    const supplied = input.write[field];
    if (supplied === null || supplied === undefined) continue;
    const same = field === 'jumper_number' ? String(supplied) === kept : Number(supplied) === kept;
    if (!same) conflicts.push(`${field} (file ${supplied}, Match Sheet ${kept ?? 'not recorded'})`);
  }
  if (conflicts.length === 0) return null;
  return `the Match Sheet protects ${conflicts.join(', ')}; promoting would overwrite it`;
}

/** The continuity contract, from the process cwd as the Match Sheet reads it (F-PR-02). */
const loadIntakeContinuity = () =>
  loadContinuityRulesFailClosed(join(process.cwd(), ...CONTINUITY_CONTRACT_SEGMENTS));

/**
 * One season's active Match Sheet authority through the settle's reader, never
 * throwing: an unreadable answer is a reason, never "no authority". Used by the
 * pipeline's validation reader and by promotion.
 */
export async function readMatchSheetAuthority(
  sql: Sql | TransactionSql, season: number,
): Promise<MatchSheetAuthorityRead> {
  try {
    const authority = await loadPlayerMatchStatsAuthority(sql, season, loadIntakeContinuity);
    return authority === null
      ? { ok: false, reason: 'a stored record has a shape that cannot be read' }
      : { ok: true, authority };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

const resolveInMatchSheet = (matchId: number) => 'Resolve it in the Match Sheet editor '
  + `(/admin/data-editor?mode=match-sheet&id=${matchId}) or correct the file, then re-validate.`;

const isPositiveInt = (value: unknown): boolean => Number.isInteger(Number(value)) && Number(value) > 0;

const playerMatchStats: DatasetSpec = {
  key: 'player_match_stats',
  title: 'Player match stats',
  description:
    'One row per player per match: kicks, marks, disposals and the rest of the box score. '
    + 'The match itself must already exist -- upload match results first. Upserts by '
    + 'player + match, so re-uploading a corrected file updates rather than duplicates.',
  requiredColumns: ['season', 'round_code', 'home_club', 'away_club', 'player', 'club'],
  fileKey: (row) =>
    `${row.season}|${row.round_code}|${row.home_club}|${row.away_club}|${row.player}|${row.club}`,

  async validateRow(row, { sql, matchSheetAuthority }) {
    // AFLDB-ISSUE-258: every optional count is read before any lookup, so a
    // malformed cell is reported (all of them at once) rather than nulled.
    const counts = optionalCountReader(row);
    const careerGameNo = counts.read('career_game_no');
    const brownlowVotes = counts.read('brownlow_votes', 3);
    const stats = Object.fromEntries(STAT_COLUMNS.map((key) => [key, counts.read(key)]));
    if (counts.reasons.length > 0) return { verdict: 'error', reasons: counts.reasons };

    const season = await resolveSeason(sql, row.season);
    if (season === null) {
      return { verdict: 'error', reasons: [`season ${row.season ?? '(empty)'} does not exist`] };
    }
    const roundCode = (row.round_code ?? '').trim();
    if (!roundCode) return { verdict: 'error', reasons: ['round_code is empty'] };

    const home = await resolveClub(sql, row.home_club, season);
    if (!home) {
      return { verdict: 'error', reasons: [`home_club "${row.home_club}" is not a recognised club for ${season}`] };
    }
    const away = await resolveClub(sql, row.away_club, season);
    if (!away) {
      return { verdict: 'error', reasons: [`away_club "${row.away_club}" is not a recognised club for ${season}`] };
    }

    const match = await resolveMatch(sql, season, roundCode, home.id, away.id);
    if (match.status !== 'unique') {
      return {
        verdict: 'error',
        reasons: [match.status === 'unmatched'
          ? `no match found for ${season} round ${roundCode}, ${row.home_club} v ${row.away_club} `
            + '-- upload match results first'
          : `${match.count} matches fit ${season} round ${roundCode}, ${row.home_club} v ${row.away_club}`],
      };
    }

    const club = await resolveClub(sql, row.club, season);
    if (!club) {
      return { verdict: 'error', reasons: [`club "${row.club}" is not a recognised club for ${season}`] };
    }
    if (club.id !== home.id && club.id !== away.id) {
      return { verdict: 'error', reasons: [`club "${row.club}" did not play in this match`] };
    }

    // player_match_stats.player_id is NOT NULL -- unlike the award tables
    // above, there is no "unlinked" representation this table can hold,
    // so an unmatched or ambiguous player is an error here, not a warning.
    const player = await resolvePlayer(sql, row.player, season, club.id);
    if (player.status !== 'unique') {
      return {
        verdict: 'error',
        reasons: [player.status === 'unmatched'
          ? `player "${row.player}" not found for ${season}`
          : `player "${row.player}" is ambiguous (${player.count} candidates)`],
      };
    }

    const resolved: Record<string, number | string | null> = {
      match_id: match.matchId,
      player_id: player.playerId,
      club_id: club.id,
      career_game_no: careerGameNo,
      // jumper_number is optional and pass-through text; coerced here
      // (not read from `row` directly in promoteRow) because an admin's
      // CSV is free to omit the column entirely, in which case `row.
      // jumper_number` is `undefined`, not `null` -- and postgres.js
      // refuses an undefined parameter outright rather than sending NULL.
      // Free text has no malformed form: absent or blank keeps the stored
      // value (AFLDB-ISSUE-258), any supplied text applies.
      jumper_number: row.jumper_number ?? null,
      brownlow_votes: brownlowVotes,
      ...stats,
    };

    // AFLDB-ISSUE-264: advisory here, for the report; promotion re-checks it
    // under the match lock. Unreadable or unavailable authority is an error.
    const read: MatchSheetAuthorityRead = matchSheetAuthority
      ? await matchSheetAuthority(season)
      : { ok: false, reason: 'no authority reader was supplied' };
    const refusal = read.ok
      ? legacyStatsAuthorityRefusal({
        authority: read.authority,
        playerId: player.playerId!,
        matchId: match.matchId!,
        write: resolved,
        rowExists: null,
      })
      : `the Match Sheet authority for ${season} could not be read (${read.reason})`;
    if (refusal !== null) {
      return {
        verdict: 'error',
        reasons: [`Match Sheet authority: ${refusal}. ${resolveInMatchSheet(match.matchId!)}`],
      };
    }

    return { verdict: 'ok', reasons: [], resolved };
  },

  async preparePromotion(rows, { sql }) {
    const bad = rows.find((row) => !isPositiveInt(row.resolved.match_id) || !isPositiveInt(row.resolved.player_id));
    if (bad) {
      throw new Error(`Row ${bad.rowNo} carries no resolved match or player; re-validate the submission.`);
    }
    const matchIds = [...new Set(rows.map((row) => Number(row.resolved.match_id)))].sort((a, b) => a - b);

    await withLegacyLockTimeout(sql, async () => {
      // Lock order (AFLDB-ISSUE-257, canonical-apply): the matches rows, ascending id,
      // before any player_match_stats row, in the strength canonical-apply takes for a
      // stats unit. FOR SHARE is enough to keep the authority read valid to commit: every
      // writer of Match Sheet authority or of match_key (Match Sheet save, Return to
      // source, a rekey's carry, deleteMatch) takes FOR UPDATE on the match first, and any
      // other UPDATE of the row takes FOR NO KEY UPDATE; both conflict with FOR SHARE, so
      // each waits for this promotion to commit. It does not conflict with another stats
      // promotion or a settle's FOR SHARE, and nothing below upgrades it (the upsert's
      // foreign key takes FOR KEY SHARE on the same row).
      const matches = await sql<{ id: number; matchKey: string }[]>`
        SELECT id::int AS id, match_key AS "matchKey"
          FROM matches
         WHERE id = ANY(${matchIds}::int[])
         ORDER BY id
           FOR SHARE
      `;
      if (matches.length !== matchIds.length) {
        throw new Error('A match this submission names no longer exists; re-validate the submission.');
      }

      // Records are scoped by the season their key carries, so read by that.
      const seasonByMatch = new Map<number, number>();
      for (const match of matches) {
        const season = seasonOfMatchKeyForAuthority(match.matchKey);
        if (season === null) {
          throw new Error(`Match #${match.id} has a key the Match Sheet authority cannot scope; nothing was promoted.`);
        }
        seasonByMatch.set(Number(match.id), season);
      }
      const authorityBySeason = new Map<number, PlayerMatchStatsAuthority>();
      for (const season of new Set(seasonByMatch.values())) {
        const read = await readMatchSheetAuthority(sql, season);
        if (!read.ok) {
          throw new Error(`The Match Sheet authority for ${season} could not be read (${read.reason}); `
            + 'nothing was promoted.');
        }
        authorityBySeason.set(season, read.authority);
      }

      // Only to tell a durable addition whose row is missing (unexpected) from one that is present.
      const existing = await sql<{ playerId: number; matchId: number }[]>`
        SELECT player_id::int AS "playerId", match_id::int AS "matchId"
          FROM player_match_stats
         WHERE match_id = ANY(${matchIds}::int[])
      `;
      const present = new Set(existing.map((r) => playerMatchStatsPairKey(Number(r.playerId), Number(r.matchId))));

      const refusals: string[] = [];
      for (const row of rows) {
        const matchId = Number(row.resolved.match_id);
        const playerId = Number(row.resolved.player_id);
        const refusal = legacyStatsAuthorityRefusal({
          authority: authorityBySeason.get(seasonByMatch.get(matchId)!)!,
          playerId,
          matchId,
          write: row.resolved,
          rowExists: present.has(playerMatchStatsPairKey(playerId, matchId)),
        });
        if (refusal !== null) refusals.push(`row ${row.rowNo} "${row.payload.player ?? ''}" (match #${matchId}): ${refusal}`);
      }
      if (refusals.length > 0) {
        const shown = refusals.slice(0, 10).join('; ');
        const more = refusals.length > 10 ? `; and ${refusals.length - 10} more` : '';
        throw new Error(`${refusals.length} row(s) conflict with durable Match Sheet authority; nothing was promoted. `
          + `${shown}${more}. Resolve them in the Match Sheet editor and promote this submission again, or upload a corrected file.`);
      }
    });
  },

  async promoteRow(row, resolved, { sql, sourceId, batchId }) {
    const s = (key: (typeof STAT_COLUMNS)[number]) => resolved[key] ?? null;
    await sql`
      INSERT INTO player_match_stats
        (player_id, match_id, club_id, career_game_no, jumper_number,
         kicks, marks, handballs, disposals, goals, behinds, hitouts, tackles,
         rebounds, inside_50s, clearances, clangers, frees_for, frees_against,
         contested, uncontested, contested_marks, marks_inside_50, one_percenters,
         bounces, goal_assists, brownlow_votes, source_id, import_batch_id)
      VALUES
        (${resolved.player_id}, ${resolved.match_id}, ${resolved.club_id},
         ${resolved.career_game_no}, ${resolved.jumper_number},
         ${s('kicks')}, ${s('marks')}, ${s('handballs')}, ${s('disposals')}, ${s('goals')},
         ${s('behinds')}, ${s('hitouts')}, ${s('tackles')}, ${s('rebounds')}, ${s('inside_50s')},
         ${s('clearances')}, ${s('clangers')}, ${s('frees_for')}, ${s('frees_against')},
         ${s('contested')}, ${s('uncontested')}, ${s('contested_marks')}, ${s('marks_inside_50')},
         ${s('one_percenters')}, ${s('bounces')}, ${s('goal_assists')},
         ${resolved.brownlow_votes}, ${sourceId || null}, ${batchId})
      -- AFLDB-ISSUE-258 (D-258-2/3): a NULL optional figure means the file
      -- was silent (no column, or a blank cell) and keeps the stored value;
      -- a malformed cell never reaches here, validation refuses it. On
      -- INSERT there is nothing to keep, so it stays not recorded.
      -- AFLDB-ISSUE-264: preparePromotion has already refused any row that
      -- would revert Match Sheet authority. source_id is deliberately not
      -- updated, so a durable addition's row keeps its ownership.
      ON CONFLICT (player_id, match_id) DO UPDATE SET
         club_id          = EXCLUDED.club_id,
         career_game_no   = COALESCE(EXCLUDED.career_game_no, player_match_stats.career_game_no),
         jumper_number    = COALESCE(EXCLUDED.jumper_number, player_match_stats.jumper_number),
         kicks            = COALESCE(EXCLUDED.kicks, player_match_stats.kicks),
         marks            = COALESCE(EXCLUDED.marks, player_match_stats.marks),
         handballs        = COALESCE(EXCLUDED.handballs, player_match_stats.handballs),
         disposals        = COALESCE(EXCLUDED.disposals, player_match_stats.disposals),
         goals            = COALESCE(EXCLUDED.goals, player_match_stats.goals),
         behinds          = COALESCE(EXCLUDED.behinds, player_match_stats.behinds),
         hitouts          = COALESCE(EXCLUDED.hitouts, player_match_stats.hitouts),
         tackles          = COALESCE(EXCLUDED.tackles, player_match_stats.tackles),
         rebounds         = COALESCE(EXCLUDED.rebounds, player_match_stats.rebounds),
         inside_50s       = COALESCE(EXCLUDED.inside_50s, player_match_stats.inside_50s),
         clearances       = COALESCE(EXCLUDED.clearances, player_match_stats.clearances),
         clangers         = COALESCE(EXCLUDED.clangers, player_match_stats.clangers),
         frees_for        = COALESCE(EXCLUDED.frees_for, player_match_stats.frees_for),
         frees_against    = COALESCE(EXCLUDED.frees_against, player_match_stats.frees_against),
         contested        = COALESCE(EXCLUDED.contested, player_match_stats.contested),
         uncontested      = COALESCE(EXCLUDED.uncontested, player_match_stats.uncontested),
         contested_marks  = COALESCE(EXCLUDED.contested_marks, player_match_stats.contested_marks),
         marks_inside_50  = COALESCE(EXCLUDED.marks_inside_50, player_match_stats.marks_inside_50),
         one_percenters   = COALESCE(EXCLUDED.one_percenters, player_match_stats.one_percenters),
         bounces          = COALESCE(EXCLUDED.bounces, player_match_stats.bounces),
         goal_assists     = COALESCE(EXCLUDED.goal_assists, player_match_stats.goal_assists),
         brownlow_votes   = COALESCE(EXCLUDED.brownlow_votes, player_match_stats.brownlow_votes),
         import_batch_id  = EXCLUDED.import_batch_id
    `;
  },
};

// --- Player biography updates (dob, height, weight) ---
// Keyed by AFLDB player id, because these files are produced FROM the
// gap-audit worklists, which carry the id — no name matching, no
// ambiguity. Only the provided fields change; a blank cell leaves the
// current value alone rather than clearing it.
const playerBio: DatasetSpec = {
  key: 'player_bio',
  title: 'Player biography updates',
  description:
    'dob / height_cm / weight_kg keyed by AFLDB player_id. Blank cells leave the '
    + 'current value untouched; at least one of the three must be present per row. '
    + 'A dob set here is recorded as sourced.',
  requiredColumns: ['player_id'],
  fileKey: (row) => row.player_id ?? '',
  async validateRow(row, { sql }) {
    const reasons: string[] = [];
    const playerId = Number(row.player_id);
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return { verdict: 'error', reasons: ['player_id must be a positive integer'] };
    }
    const [player] = await sql<{ id: number; name: string }[]>`
      SELECT id, display_name AS name FROM players WHERE id = ${playerId}
    `;
    if (!player) return { verdict: 'error', reasons: [`no player with id ${playerId}`] };

    const dob = (row.dob ?? '').trim();
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      reasons.push('dob must be YYYY-MM-DD');
    }
    const height = (row.height_cm ?? '').trim();
    if (height && !(Number.isInteger(Number(height)) && Number(height) >= 120 && Number(height) <= 230)) {
      reasons.push('height_cm must be a whole number between 120 and 230');
    }
    const weight = (row.weight_kg ?? '').trim();
    if (weight && !(Number.isInteger(Number(weight)) && Number(weight) >= 40 && Number(weight) <= 160)) {
      reasons.push('weight_kg must be a whole number between 40 and 160');
    }
    if (!dob && !height && !weight) {
      reasons.push('row provides none of dob, height_cm, weight_kg');
    }
    if (reasons.length > 0) return { verdict: 'error', reasons };
    return {
      verdict: 'ok',
      reasons: [`updates ${player.name}`],
      resolved: { player_id: playerId },
    };
  },
  async promoteRow(row, resolved, { sql }) {
    const dob = (row.dob ?? '').trim() || null;
    const height = (row.height_cm ?? '').trim() || null;
    const weight = (row.weight_kg ?? '').trim() || null;
    // COALESCE keeps the current value wherever the file is silent, so a
    // partial file can never blank a figure it did not mention.
    await sql`
      UPDATE players
         SET dob = COALESCE(${dob}::date, dob),
             dob_confidence = CASE WHEN ${dob}::date IS NOT NULL
                                   THEN 'sourced'::value_confidence
                                   ELSE dob_confidence END,
             height_cm = COALESCE(${height}::smallint, height_cm),
             weight_kg = COALESCE(${weight}::smallint, weight_kg)
       WHERE id = ${resolved.player_id}
    `;
  },
};

// --- Match attendance updates ---
// Keyed by AFLDB match id (from the match URL or an exported worklist).
// Honours migration 020's contract: the figure and its status agree,
// and a genuine zero cites the manual-edit source.
const MATCH_ATTENDANCE_MAX = 200_000;

type AttendanceCell =
  | { kind: 'figure'; value: number }
  | { kind: 'blank' }
  | { kind: 'invalid'; text: string };

/**
 * AFLDB-ISSUE-268: the ONE reading of an `attendance` cell, shared by `validateRow` and the
 * promotion-time re-check so the two cannot drift. A missing or blank cell is "not recorded"
 * (`Number('')` is 0, which is how a blank used to become a zero recorded against the manual-edit source); a nonblank cell keeps its
 * pre-fix reading (`Number()`, whole number, `0..MATCH_ATTENDANCE_MAX`), so `0` and every
 * previously accepted spelling still resolve to the same figure (runbook §15, D-268-1).
 */
function readAttendanceCell(raw: unknown): AttendanceCell {
  if (raw === null || raw === undefined) return { kind: 'blank' };
  if (typeof raw !== 'string') return { kind: 'invalid', text: JSON.stringify(raw) };
  const text = raw.trim();
  if (text === '') return { kind: 'blank' };
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > MATCH_ATTENDANCE_MAX) {
    return { kind: 'invalid', text };
  }
  return { kind: 'figure', value };
}

/**
 * Why a submission's stored rows can no longer be promoted as attendance figures, one entry per
 * offending row (empty = every row still agrees with the validator's current reading). Reads the
 * retained payload cell, never the stored verdict: a submission validated before ISSUE-268 keeps an
 * `ok` verdict and `resolved.attendance = 0` on a blank cell, and both promotion and approval trust
 * the stored verdict.
 */
function staleAttendanceRows(rows: readonly PromotionRow[]): string[] {
  const stale: string[] = [];
  for (const row of rows) {
    const payload = row.payload as unknown;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      stale.push(`Row ${row.rowNo}: the stored row payload is unreadable`);
      continue;
    }
    const cell = readAttendanceCell((payload as Record<string, unknown>).attendance);
    if (cell.kind === 'blank') {
      stale.push(`Row ${row.rowNo}: attendance is blank`);
    } else if (cell.kind === 'invalid') {
      stale.push(`Row ${row.rowNo}: attendance "${cell.text.slice(0, 40)}" is not a whole number from 0 to ${MATCH_ATTENDANCE_MAX}`);
    } else if (row.resolved.attendance !== cell.value) {
      stale.push(
        `Row ${row.rowNo}: the stored resolved attendance (${String(row.resolved.attendance)}) `
        + `disagrees with the cell (${cell.value})`,
      );
    }
  }
  return stale;
}

const matchAttendance: DatasetSpec = {
  key: 'match_attendance',
  title: 'Match attendance updates',
  description:
    'attendance keyed by AFLDB match_id. A 0 is accepted as a confirmed zero-crowd '
    + 'figure and cited to the manual-edit source; use it only when a source supports it. '
    + 'A blank attendance cell is refused, never read as 0: remove rows you have no figure for.',
  requiredColumns: ['match_id', 'attendance'],
  fileKey: (row) => row.match_id ?? '',
  async validateRow(row, { sql }) {
    const matchId = Number(row.match_id);
    if (!Number.isInteger(matchId) || matchId <= 0) {
      return { verdict: 'error', reasons: ['match_id must be a positive integer'] };
    }
    const [match] = await sql<{ id: number; label: string }[]>`
      SELECT m.id,
             hc.name || ' v ' || ac.name || ' · ' || m.season || ' ' || m.round_code AS label
        FROM matches m
        JOIN clubs hc ON hc.id = m.home_club_id
        JOIN clubs ac ON ac.id = m.away_club_id
       WHERE m.id = ${matchId}
    `;
    if (!match) return { verdict: 'error', reasons: [`no match with id ${matchId}`] };
    // AFLDB-ISSUE-268: a blank cell is "not recorded", never a crowd of 0. Number('') is 0, so the
    // old reading turned a half-filled worklist into `complete` zeros recorded against the manual-edit
    // source, which the settles then honoured as manual authority. A zero must be typed; a row with nothing to say is
    // removed from the file (the dataset exists to SET a figure, so there is nothing to preserve).
    // Nonblank cells keep the pre-fix reading (see readAttendanceCell), so spellings such as `1e2`,
    // `0x10` and `+5` stay accepted. Tightening to `^\d+$` like optionalCountReader would be a separate,
    // undecided change (runbook §15, D-268-1).
    const cell = readAttendanceCell(row.attendance);
    if (cell.kind === 'blank') {
      return {
        verdict: 'error',
        reasons: [`attendance is blank; enter a whole number from 0 to ${MATCH_ATTENDANCE_MAX}, or remove the row to leave the stored value`],
      };
    }
    if (cell.kind === 'invalid') {
      return {
        verdict: 'error',
        reasons: [`attendance "${cell.text}" must be a whole number from 0 to ${MATCH_ATTENDANCE_MAX}`],
      };
    }
    return {
      verdict: 'ok',
      reasons: [`sets ${match.label} to ${cell.value}`],
      resolved: { match_id: matchId, attendance: cell.value },
    };
  },

  // AFLDB-ISSUE-265 (review F-001, D-265-10): this was a third legacy match writer with no
  // hook, so its per-row UPDATEs ran in file order, unbounded, and could cross another
  // promotion, a rekey or a settle. It now takes the same exclusive gate as the other two
  // writers (inside `withLegacyLockTimeout`), then locks the EXISTING target matches in ONE
  // statement, ascending id. FOR NO KEY UPDATE is the strength the UPDATE below takes anyway
  // (it never changes match_key), so no lock is upgraded later. A match deleted since
  // validation has nothing to lock; the UPDATE then touches no row, as before.
  async preparePromotion(rows, { sql }) {
    const bad = rows.find((row) => !isPositiveInt(row.resolved.match_id));
    if (bad) {
      throw new Error(`Row ${bad.rowNo} carries no resolved match; re-validate the submission.`);
    }
    // AFLDB-ISSUE-268: the whole file is checked against the validator's CURRENT reading of each retained
    // cell before the gate, any lock or any write, so one stale row refuses every row. DB-free, so a
    // refused file never waits on the gate.
    const stale = staleAttendanceRows(rows);
    if (stale.length > 0) {
      throw new Error(
        `Nothing was promoted: ${stale.length} of ${rows.length} rows fail the attendance check applied at promotion `
        + `(${stale[0]}${stale.length > 1 ? `; ${stale.length - 1} more` : ''}). The stored verdicts predate it; `
        + 'upload a corrected file as a new submission.',
      );
    }
    const matchIds = [...new Set(rows.map((row) => Number(row.resolved.match_id)))].sort((a, b) => a - b);
    await withLegacyLockTimeout(sql, async () => {
      await sql`
        SELECT id::int AS id
          FROM matches
         WHERE id = ANY(${matchIds}::int[])
         ORDER BY id
           FOR NO KEY UPDATE
      `;
    });
  },

  async promoteRow(_row, resolved, { sql }) {
    await sql`
      UPDATE matches
         SET attendance = ${resolved.attendance},
             attendance_status = 'complete'::coverage_status,
             attendance_source_id = (SELECT id FROM sources WHERE key = 'manual_admin_edit')
       WHERE id = ${resolved.match_id}
    `;
  },
};

export const DATASETS: Record<string, DatasetSpec> = {
  [risingStar.key]: risingStar,
  [allAustralian.key]: allAustralian,
  [matchResults.key]: matchResults,
  [playerMatchStats.key]: playerMatchStats,
  [playerBio.key]: playerBio,
  [matchAttendance.key]: matchAttendance,
};

/**
 * The spec for a dataset key, or null when there is none.
 *
 * `Object.hasOwn`, not `DATASETS[key]` plus a truthiness check: the dataset
 * key arrives from a request (an upload form field, an emailed subject line),
 * and a plain index also finds inherited properties -- "constructor" returns a
 * function, which is truthy, so the "unknown dataset" guard passes it through
 * and the next line reads .requiredColumns off Object's constructor. Same
 * discipline the search specs already apply to their own catalogue lookups
 * (isGridStatKey, isPlayerSort).
 */
export function getDataset(key: string): DatasetSpec | null {
  return Object.hasOwn(DATASETS, key) ? DATASETS[key] : null;
}
