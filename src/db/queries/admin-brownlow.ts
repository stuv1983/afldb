import 'server-only';

import postgres from 'postgres';

import { sql } from '@/db/client';
import { recordDataEdit } from '@/db/queries/audit-log';
import {
  recomputeBrownlowCareerTotals,
  recomputeBrownlowCoverage,
  recomputeSeasonBrownlowStatus,
} from '@/db/queries/player-derived';
import { canonicalFingerprint } from '@/lib/brownlow/fingerprint';
import {
  assessParticipants,
  asCompleteSelection,
  brownlowRefusal,
  BROWNLOW_MANUAL_SOURCE_KEY,
  checkTransition,
  classifyMatchAssignment,
  deriveSeasonRows,
  entrySourceRecordId,
  MIN_CLUB_LINEUP_ROWS,
  publishSourceRecordId,
  reasonRequired,
  seasonStatusLabel,
  validateReason,
  validateSelection,
  type BrownlowAction,
  type BrownlowEntryStatus,
  type BrownlowOutcome,
  type BrownlowRefusal,
  type BrownlowSelection,
  type BrownlowSeasonAuthority,
  type BrownlowSeasonStatus,
  type CanonicalRoundRow,
  type MatchAssignment,
  type ParticipantAssessment,
} from '@/lib/brownlow/entry';

/**
 * AFLDB-ISSUE-155 Phase C1 — the Brownlow administration read model and
 * the four transactions that write Brownlow facts (§27.10, §27.14,
 * §27.17).
 *
 * THIS FILE IS THE ONLY APPLICATION WRITER of `brownlow_round_votes` and
 * `brownlow_season_votes`, and `tests/admin-match-mutations.test.ts`
 * asserts it. Everything it decides comes from `@/lib/brownlow/entry`,
 * which is pure and unit-tested; what lives here is the SQL, the lock
 * order and the audit.
 *
 * THE WRITER IS CLAIM-AND-DEMOTE, NEVER DELETE. `brownlow_round_votes`
 * is a dense participation record — 298,622 of its 320,861 rows are a
 * published zero meaning "played, polled nothing" (preflight P1). A
 * finalisation therefore CLAIMS the rows it needs and DEMOTES the ones
 * it displaces to zero; it never deletes a round row, because deleting
 * one would destroy a source fact about a player's season that has
 * nothing to do with who won the votes. §27.10's original sketch said
 * "delete every other row for that match"; that was written before P1
 * measured the density and is superseded here, which is the one
 * deliberate departure from §27.10 item 1.
 *
 * A void withdraws vote VALUES rather than asserting zeros (operator
 * decision D2): every round row of the match keeps `played` and takes
 * `votes = NULL`, the shape migration 005's CHECK already provides for.
 * Setting them to zero would claim that forty players each polled
 * nothing in a match where no votes were awarded at all.
 *
 * Reads run on the app pool. Writes run on a short-lived
 * `AFLDB_IMPORT_DATABASE_URL` connection with `max: 1`, the
 * `match-sheet.ts` pattern, and every audit row is written by
 * `recordDataEdit` inside the same transaction as the fact it records
 * (migration-066 discipline: a failed audit rolls the fact back).
 */

/* ------------------------------------------------------------------ *
 * Refusal plumbing
 * ------------------------------------------------------------------ */

/**
 * A business refusal, thrown so that it unwinds the transaction.
 *
 * The transactions must not COMMIT a refusal, and postgres.js rolls back
 * on a thrown error and only on a thrown error. Wrapping the refusal in
 * an Error is therefore how a refusal both aborts cleanly and arrives at
 * the caller as `{ ok: false, code }` rather than as `db_error`.
 */
class BrownlowRefusalError extends Error {
  readonly refusal: BrownlowRefusal;

  constructor(refusal: BrownlowRefusal) {
    super(refusal.message);
    this.name = 'BrownlowRefusalError';
    this.refusal = refusal;
  }
}

function refuse(...args: Parameters<typeof brownlowRefusal>): never {
  throw new BrownlowRefusalError(brownlowRefusal(...args));
}

/** Unwrap a pure-layer outcome inside a transaction, refusing on failure. */
function must<T>(outcome: BrownlowOutcome<T>): T {
  if (!outcome.ok) throw new BrownlowRefusalError(outcome);
  return outcome.value;
}

/* ------------------------------------------------------------------ *
 * Read model
 * ------------------------------------------------------------------ */

export type BrownlowSeasonCounts = {
  /** Home-and-away matches in the season. */
  expected: number;
  final: number;
  draft: number;
  voided: number;
  /** No workflow row, but the source's own facts are a complete 3/2/1. */
  imported: number;
  /** No workflow row and a positive but incomplete set of facts. */
  importedPartial: number;
  notEntered: number;
  /** Round rows in the season still unattached to any match. */
  unresolved: number;
  /** Home-and-away matches whose line-up fails §27.6. */
  participantsIncomplete: number;
};

export type BrownlowSeasonSummary = BrownlowSeasonCounts & {
  season: number;
  polled: boolean;
  status: BrownlowSeasonStatus;
  complete: boolean;
  authority: BrownlowSeasonAuthority;
  /**
   * 0 when the season has no `brownlow_season_authority` row — nobody has
   * administered it yet. The publish CAS expects that same 0 back, so the
   * page and the transaction agree about a season that does not exist as
   * a workflow entity.
   */
  revision: number;
  publishedRevision: number | null;
  publishedAt: Date | null;
  stale: boolean;
};

type SeasonAggregateRow = {
  season: number;
  coverage: string | null;
  expected: number;
  final: number;
  draft: number;
  voided: number;
  imported: number;
  importedPartial: number;
  notEntered: number;
  participantsIncomplete: number;
  started: number;
  unresolved: number;
  seasonRows: number;
  manualRows: number;
  revision: number;
  publishedRevision: number | null;
  publishedAt: Date | null;
};

/**
 * Per-season counts for the season list and the season page.
 *
 * One statement for every season, or for one when `season` is given, so
 * the list page costs a single round trip. The per-match classification
 * is the §27.9 one and is expressed once, here, rather than repeated in
 * each caller.
 */
async function selectSeasonAggregates(season: number | null): Promise<SeasonAggregateRow[]> {
  return sql<SeasonAggregateRow[]>`
    WITH manual AS (
      SELECT id FROM sources WHERE key = ${BROWNLOW_MANUAL_SOURCE_KEY}
    ),
    match_state AS (
      SELECT m.season,
             es.status AS entry_status,
             -- A textbook poll: three distinct players holding 3, 2 and 1.
             (rv.total = 6 AND rv.positives = 3 AND rv.distinct_values = 3) AS facts_complete,
             rv.total > 0                                                   AS facts_any,
             (parts.home_rows < 18 OR parts.away_rows < 18 OR parts.foreign_rows > 0)
                                                                            AS participants_short
        FROM matches m
        LEFT JOIN brownlow_vote_entry_state es ON es.match_id = m.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(brv.votes), 0)                                  AS total,
                 count(*) FILTER (WHERE brv.votes > 0)                        AS positives,
                 count(DISTINCT brv.votes) FILTER (WHERE brv.votes > 0)       AS distinct_values
            FROM brownlow_round_votes brv
           WHERE brv.match_id = m.id
        ) rv ON true
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE pms.club_id = m.home_club_id) AS home_rows,
                 count(*) FILTER (WHERE pms.club_id = m.away_club_id) AS away_rows,
                 count(*) FILTER (WHERE pms.club_id NOT IN (m.home_club_id, m.away_club_id))
                                                                      AS foreign_rows
            FROM player_match_stats pms
           WHERE pms.match_id = m.id
        ) parts ON true
       WHERE m.round_type = 'home_and_away'
         ${season === null ? sql`` : sql`AND m.season = ${season}`}
    ),
    per_season AS (
      SELECT season,
             count(*)::int                                                       AS expected,
             count(*) FILTER (WHERE entry_status = 'final')::int                 AS final,
             count(*) FILTER (WHERE entry_status = 'draft')::int                 AS draft,
             count(*) FILTER (WHERE entry_status = 'void')::int                  AS voided,
             count(*) FILTER (WHERE entry_status IS NULL AND facts_complete)::int AS imported,
             count(*) FILTER (WHERE entry_status IS NULL AND facts_any
                                AND NOT facts_complete)::int                     AS "importedPartial",
             count(*) FILTER (WHERE entry_status IS NULL AND NOT facts_any)::int AS "notEntered",
             count(*) FILTER (WHERE participants_short)::int                     AS "participantsIncomplete",
             count(*) FILTER (WHERE entry_status IS NOT NULL OR facts_any)::int  AS started
        FROM match_state
       GROUP BY season
    )
    SELECT p.season,
           av.coverage::text                       AS coverage,
           p.expected, p.final, p.draft, p.voided,
           p.imported, p."importedPartial", p."notEntered",
           p."participantsIncomplete", p.started,
           COALESCE(u.unresolved, 0)::int          AS unresolved,
           COALESCE(b.season_rows, 0)::int         AS "seasonRows",
           COALESCE(b.manual_rows, 0)::int         AS "manualRows",
           COALESCE(a.revision, 0)::int            AS revision,
           a.published_revision                    AS "publishedRevision",
           a.published_at                          AS "publishedAt"
      FROM per_season p
      LEFT JOIN stat_availability av
        ON av.stat_key = 'brownlow_season_total' AND av.season = p.season
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE brv.match_id IS NULL) AS unresolved
          FROM brownlow_round_votes brv WHERE brv.season = p.season
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT count(*)                                                          AS season_rows,
               count(*) FILTER (WHERE bsv.source_id = (SELECT id FROM manual))   AS manual_rows
          FROM brownlow_season_votes bsv WHERE bsv.season = p.season
      ) b ON true
      LEFT JOIN brownlow_season_authority a ON a.season = p.season
     ORDER BY p.season DESC
  `;
}

function toSeasonSummary(row: SeasonAggregateRow): BrownlowSeasonSummary {
  // The coverage authority decides whether a season was polled at all,
  // rather than a hardcoded 1924-and-not-1942-to-1945 rule. A season with
  // no availability row is treated as unpolled: refusing to administer a
  // season nothing has classified is the fail-closed direction.
  const polled = row.coverage !== null && row.coverage !== 'not_applicable';

  const authority: BrownlowSeasonAuthority = row.seasonRows === 0
    ? 'none'
    : (row.manualRows > 0 ? 'manual' : 'source');

  const accounted = row.final + row.voided + row.imported;
  const complete = row.expected > 0 && accounted >= row.expected;

  return {
    season: row.season,
    polled,
    status: seasonStatusLabel({
      polled,
      expectedMatches: row.expected,
      accountedMatches: accounted,
      startedMatches: row.started,
      authority,
      revision: row.revision,
      publishedRevision: row.publishedRevision,
    }),
    complete,
    authority,
    revision: row.revision,
    publishedRevision: row.publishedRevision,
    publishedAt: row.publishedAt,
    stale: authority === 'manual'
      && row.publishedRevision !== null
      && row.publishedRevision !== row.revision,
    expected: row.expected,
    final: row.final,
    draft: row.draft,
    voided: row.voided,
    imported: row.imported,
    importedPartial: row.importedPartial,
    notEntered: row.notEntered,
    unresolved: row.unresolved,
    participantsIncomplete: row.participantsIncomplete,
  };
}

/** Every season with home-and-away matches, newest first (§27.9). */
export async function listBrownlowSeasons(): Promise<BrownlowSeasonSummary[]> {
  const rows = await selectSeasonAggregates(null);
  return rows.map(toSeasonSummary);
}

/**
 * One player's disagreement between the round facts and the published
 * season total (§27.9). Shown to the operator, never applied.
 */
export type BrownlowDisagreement = {
  playerId: number;
  playerName: string;
  roundVotes: number;
  seasonVotes: number | null;
};

export type BrownlowSeasonOverview = BrownlowSeasonSummary & {
  rounds: Array<{
    roundNumber: number;
    expected: number;
    accounted: number;
    draft: number;
    participantsIncomplete: number;
  }>;
  disagreements: BrownlowDisagreement[];
  /** Players who polled in the season, with their current ineligibility flag. */
  ineligiblePlayerIds: number[];
};

export async function getBrownlowSeasonOverview(
  season: number,
): Promise<BrownlowSeasonOverview | null> {
  const [aggregate] = await selectSeasonAggregates(season);
  if (!aggregate) return null;

  const [rounds, disagreements, ineligible] = await Promise.all([
    sql<Array<{
      roundNumber: number; expected: number; accounted: number;
      draft: number; participantsIncomplete: number;
    }>>`
      SELECT m.round_number AS "roundNumber",
             count(*)::int  AS expected,
             count(*) FILTER (
               WHERE es.status = 'void'
                  OR (rv.total = 6 AND rv.positives = 3 AND rv.distinct_values = 3)
             )::int AS accounted,
             count(*) FILTER (WHERE es.status = 'draft')::int AS draft,
             count(*) FILTER (
               WHERE parts.home_rows < 18 OR parts.away_rows < 18
             )::int AS "participantsIncomplete"
        FROM matches m
        LEFT JOIN brownlow_vote_entry_state es ON es.match_id = m.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(brv.votes), 0)                            AS total,
                 count(*) FILTER (WHERE brv.votes > 0)                  AS positives,
                 count(DISTINCT brv.votes) FILTER (WHERE brv.votes > 0) AS distinct_values
            FROM brownlow_round_votes brv WHERE brv.match_id = m.id
        ) rv ON true
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE pms.club_id = m.home_club_id) AS home_rows,
                 count(*) FILTER (WHERE pms.club_id = m.away_club_id) AS away_rows
            FROM player_match_stats pms WHERE pms.match_id = m.id
        ) parts ON true
       WHERE m.season = ${season} AND m.round_type = 'home_and_away'
       GROUP BY m.round_number
       ORDER BY m.round_number
    `,
    // Round facts against the published total, per player. Only rows that
    // actually disagree, so a healthy season reports nothing.
    sql<BrownlowDisagreement[]>`
      WITH round_totals AS (
        SELECT player_id, sum(votes)::int AS votes
          FROM brownlow_round_votes
         WHERE season = ${season} AND votes > 0
         GROUP BY player_id
      ),
      season_totals AS (
        SELECT player_id, votes::int AS votes
          FROM brownlow_season_votes WHERE season = ${season}
      )
      SELECT COALESCE(r.player_id, s.player_id) AS "playerId",
             p.display_name                     AS "playerName",
             COALESCE(r.votes, 0)               AS "roundVotes",
             s.votes                            AS "seasonVotes"
        FROM round_totals r
        FULL OUTER JOIN season_totals s ON s.player_id = r.player_id
        JOIN players p ON p.id = COALESCE(r.player_id, s.player_id)
       WHERE COALESCE(r.votes, 0) IS DISTINCT FROM COALESCE(s.votes, 0)
       ORDER BY COALESCE(r.votes, 0) DESC, "playerId"
    `,
    sql<Array<{ playerId: number }>>`
      SELECT player_id AS "playerId"
        FROM brownlow_season_votes
       WHERE season = ${season} AND is_ineligible
       ORDER BY player_id
    `,
  ]);

  return {
    ...toSeasonSummary(aggregate),
    rounds,
    disagreements,
    ineligiblePlayerIds: ineligible.map((row) => row.playerId),
  };
}

export type BrownlowRoundMatch = {
  matchId: number;
  season: number;
  roundNumber: number;
  matchDate: Date;
  homeClubId: number;
  homeClubName: string;
  awayClubId: number;
  awayClubName: string;
  venue: string;
  status: BrownlowEntryStatus | null;
  revision: number;
  assignment: MatchAssignment;
  participantsComplete: boolean;
  /** Current holders, whatever their provenance, highest vote first. */
  holders: Array<{ playerId: number; playerName: string; votes: number }>;
};

/** Every home-and-away match of a round, in fixture order (§27.26). */
export async function getBrownlowRound(
  season: number,
  roundNumber: number,
): Promise<BrownlowRoundMatch[]> {
  const rows = await sql<Array<Omit<BrownlowRoundMatch, 'assignment' | 'holders' | 'participantsComplete'> & {
    homeRows: number; awayRows: number; foreignRows: number;
    holders: Array<{ playerId: number; playerName: string; votes: number }> | null;
    canonical: Array<{ playerId: number; votes: number | null; sourceId: number | null; matchId: number | null }> | null;
  }>>`
    SELECT m.id                       AS "matchId",
           m.season,
           m.round_number             AS "roundNumber",
           m.match_date               AS "matchDate",
           m.home_club_id             AS "homeClubId",
           home.name                  AS "homeClubName",
           m.away_club_id             AS "awayClubId",
           away.name                  AS "awayClubName",
           COALESCE(v.canonical_name, m.venue_raw) AS venue,
           es.status                  AS status,
           COALESCE(es.revision, 0)   AS revision,
           parts.home_rows            AS "homeRows",
           parts.away_rows            AS "awayRows",
           parts.foreign_rows         AS "foreignRows",
           facts.holders              AS holders,
           facts.canonical            AS canonical
      FROM matches m
      JOIN clubs home ON home.id = m.home_club_id
      JOIN clubs away ON away.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
      LEFT JOIN brownlow_vote_entry_state es ON es.match_id = m.id
      LEFT JOIN LATERAL (
        SELECT (count(*) FILTER (WHERE pms.club_id = m.home_club_id))::int AS home_rows,
               (count(*) FILTER (WHERE pms.club_id = m.away_club_id))::int AS away_rows,
               (count(*) FILTER (WHERE pms.club_id NOT IN (m.home_club_id, m.away_club_id)))::int
                                                                    AS foreign_rows
          FROM player_match_stats pms WHERE pms.match_id = m.id
      ) parts ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
                 'playerId', brv.player_id,
                 'playerName', p.display_name,
                 'votes', brv.votes)
                 ORDER BY brv.votes DESC) FILTER (WHERE brv.votes > 0) AS holders,
               jsonb_agg(jsonb_build_object(
                 'playerId', brv.player_id,
                 'votes', brv.votes,
                 'sourceId', brv.source_id,
                 'matchId', brv.match_id)) FILTER (WHERE brv.votes > 0) AS canonical
          FROM brownlow_round_votes brv
          JOIN players p ON p.id = brv.player_id
         WHERE brv.match_id = m.id
      ) facts ON true
     WHERE m.season = ${season}
       AND m.round_type = 'home_and_away'
       AND m.round_number = ${roundNumber}
     ORDER BY m.match_date, m.id
  `;

  return rows.map((row) => ({
    matchId: row.matchId,
    season: row.season,
    roundNumber: row.roundNumber,
    matchDate: row.matchDate,
    homeClubId: row.homeClubId,
    homeClubName: row.homeClubName,
    awayClubId: row.awayClubId,
    awayClubName: row.awayClubName,
    venue: row.venue,
    status: row.status,
    revision: row.revision,
    assignment: classifyMatchAssignment(row.canonical ?? []),
    // The counts are cast to int in the query above: postgres.js hands back a
    // bare count() as a string, which no threshold or `=== 0` here would read
    // correctly. The rule matches assessParticipants exactly (§27.6).
    participantsComplete: row.homeRows >= MIN_CLUB_LINEUP_ROWS
      && row.awayRows >= MIN_CLUB_LINEUP_ROWS
      && row.foreignRows === 0,
    holders: row.holders ?? [],
  }));
}

export type BrownlowMatchEditorModel = {
  matchId: number;
  season: number;
  roundNumber: number;
  matchDate: Date;
  homeClubId: number;
  homeClubName: string;
  awayClubId: number;
  awayClubName: string;
  venue: string;
  status: BrownlowEntryStatus | null;
  revision: number;
  selection: BrownlowSelection;
  lastReason: string | null;
  participants: Array<{
    playerId: number;
    playerName: string;
    clubId: number;
    // `player_match_stats.jumper_number` is text (migration 004): historical
    // numbers are not all integers and leading zeros are meaningful.
    jumperNumber: string | null;
  }>;
  participantAssessment: ParticipantAssessment;
  /** The facts as they stand: imported, finalised, or absent. */
  canonicalRows: Array<CanonicalRoundRow & { playerName: string; unresolved: boolean }>;
  assignment: MatchAssignment;
  /** The §27.14 compare-and-set value the submit must carry back. */
  canonicalFingerprint: string;
};

export async function getBrownlowMatchEditorModel(
  matchId: number,
): Promise<BrownlowMatchEditorModel | null> {
  const [match] = await sql<Array<{
    matchId: number; season: number; roundNumber: number; matchDate: Date;
    homeClubId: number; homeClubName: string; awayClubId: number; awayClubName: string;
    venue: string; status: BrownlowEntryStatus | null; revision: number;
    three: number | null; two: number | null; one: number | null; lastReason: string | null;
  }>>`
    SELECT m.id                        AS "matchId",
           m.season,
           m.round_number              AS "roundNumber",
           m.match_date                AS "matchDate",
           m.home_club_id              AS "homeClubId",
           home.name                   AS "homeClubName",
           m.away_club_id              AS "awayClubId",
           away.name                   AS "awayClubName",
           COALESCE(v.canonical_name, m.venue_raw) AS venue,
           es.status                   AS status,
           COALESCE(es.revision, 0)    AS revision,
           es.three_player_id          AS three,
           es.two_player_id            AS two,
           es.one_player_id            AS one,
           es.last_reason              AS "lastReason"
      FROM matches m
      JOIN clubs home ON home.id = m.home_club_id
      JOIN clubs away ON away.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
      LEFT JOIN brownlow_vote_entry_state es ON es.match_id = m.id
     WHERE m.id = ${matchId} AND m.round_type = 'home_and_away'
  `;
  if (!match) return null;

  const [participants, canonical] = await Promise.all([
    sql<BrownlowMatchEditorModel['participants']>`
      SELECT pms.player_id     AS "playerId",
             p.display_name    AS "playerName",
             pms.club_id       AS "clubId",
             pms.jumper_number AS "jumperNumber"
        FROM player_match_stats pms
        JOIN players p ON p.id = pms.player_id
       WHERE pms.match_id = ${matchId}
       ORDER BY pms.club_id, p.display_name
    `,
    selectCanonicalRows(sql, {
      matchId, season: match.season, roundNumber: match.roundNumber,
    }),
  ]);

  return {
    ...match,
    selection: { three: match.three, two: match.two, one: match.one },
    participants,
    participantAssessment: assessParticipants(
      participants.map((row) => ({ playerId: row.playerId, clubId: row.clubId })),
      match.homeClubId,
      match.awayClubId,
    ),
    canonicalRows: canonical,
    assignment: classifyMatchAssignment(canonical.filter((row) => !row.unresolved)),
    canonicalFingerprint: canonicalFingerprint(canonical),
  };
}

/* ------------------------------------------------------------------ *
 * Shared reads (used by both the read model and the transactions)
 * ------------------------------------------------------------------ */

type Queryable = postgres.Sql | postgres.TransactionSql;

type CanonicalRowWithName = CanonicalRoundRow & { playerName: string; unresolved: boolean };

/**
 * The exact row set §27.14 fingerprints: the match's own round rows,
 * PLUS the season/round rows still unattached to any match whose player
 * is a participant of this match.
 *
 * The unresolved rows belong in the picture precisely because a
 * finalisation is about to claim them — if one of them moves between
 * render and submit, the operator is deciding against a stale view.
 */
async function selectCanonicalRows(
  db: Queryable,
  match: { matchId: number; season: number; roundNumber: number },
): Promise<CanonicalRowWithName[]> {
  return db<CanonicalRowWithName[]>`
    SELECT brv.player_id  AS "playerId",
           brv.votes      AS votes,
           brv.source_id  AS "sourceId",
           brv.match_id   AS "matchId",
           p.display_name AS "playerName",
           brv.match_id IS NULL AS unresolved
      FROM brownlow_round_votes brv
      JOIN players p ON p.id = brv.player_id
     WHERE brv.match_id = ${match.matchId}
        OR (brv.match_id IS NULL
            AND brv.season = ${match.season}
            AND brv.round_number = ${match.roundNumber}
            AND EXISTS (
              SELECT 1 FROM player_match_stats pms
               WHERE pms.match_id = ${match.matchId}
                 AND pms.player_id = brv.player_id
            ))
     ORDER BY brv.votes DESC NULLS LAST, brv.player_id
  `;
}

/* ------------------------------------------------------------------ *
 * Transactions
 * ------------------------------------------------------------------ */

/** The `0xAF1DB` advisory namespace: 1 honour teams, 2 admin lifecycle, 3 Brownlow. */
const BROWNLOW_ADVISORY_KEY = [717275, 3] as const;

export type BrownlowMutationResult = BrownlowOutcome<{
  matchId: number;
  status: BrownlowEntryStatus;
  revision: number;
  selection: BrownlowSelection;
  /** Set when the mutation re-derived an already-published season. */
  republishedSeason: number | null;
}>;

type MatchMutationInput = {
  matchId: number;
  selection?: BrownlowSelection;
  expectedRevision: number;
  expectedCanonicalFingerprint?: string;
  actorId: number;
  reason?: string | null;
  note?: string | null;
};

type LockedMatch = {
  id: number;
  season: number;
  roundNumber: number;
  homeClubId: number;
  awayClubId: number;
};

type LockedEntry = {
  status: BrownlowEntryStatus;
  revision: number;
  three: number | null;
  two: number | null;
  one: number | null;
};

function importConnection(): postgres.Sql {
  const url = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!url) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Lock the match row and prove it is a poll-able home-and-away match. */
async function lockMatch(tx: postgres.TransactionSql, matchId: number): Promise<LockedMatch> {
  const [match] = await tx<Array<LockedMatch & { roundType: string }>>`
    SELECT id, season,
           round_number  AS "roundNumber",
           round_type::text AS "roundType",
           home_club_id  AS "homeClubId",
           away_club_id  AS "awayClubId"
      FROM matches
     WHERE id = ${matchId}
       FOR UPDATE
  `;
  if (!match) refuse('not_found', `Match #${matchId} does not exist.`);
  if (match.roundType !== 'home_and_away') refuse('not_home_and_away');

  const [availability] = await tx<Array<{ coverage: string }>>`
    SELECT coverage::text AS coverage
      FROM stat_availability
     WHERE stat_key = 'brownlow_season_total' AND season = ${match.season}
  `;
  if (!availability || availability.coverage === 'not_applicable') {
    refuse('season_not_polled', `No Brownlow Medal was awarded in ${match.season}.`);
  }

  return {
    id: match.id,
    season: match.season,
    roundNumber: match.roundNumber,
    homeClubId: match.homeClubId,
    awayClubId: match.awayClubId,
  };
}

/**
 * Take the entry row's lock, creating it if this is the first decision.
 *
 * `INSERT … ON CONFLICT DO NOTHING` then re-read under the match lock, so
 * two "first" drafts cannot both believe they created the row: the match
 * lock serialises them and the loser reads revision 1 and fails its CAS.
 */
async function lockEntry(
  tx: postgres.TransactionSql,
  match: LockedMatch,
): Promise<LockedEntry | null> {
  const [existing] = await tx<LockedEntry[]>`
    SELECT status, revision,
           three_player_id AS three, two_player_id AS two, one_player_id AS one
      FROM brownlow_vote_entry_state
     WHERE match_id = ${match.id}
       FOR UPDATE
  `;
  return existing ?? null;
}

function assertRevision(entry: LockedEntry | null, expectedRevision: number): void {
  const current = entry?.revision ?? 0;
  if (current !== expectedRevision) {
    refuse(
      'stale',
      `This match has changed since the page was loaded (revision ${current}, not ${expectedRevision}).`,
    );
  }
}

async function requireManualSourceId(tx: postgres.TransactionSql): Promise<number> {
  const [source] = await tx<Array<{ id: number }>>`
    SELECT id FROM sources WHERE key = ${BROWNLOW_MANUAL_SOURCE_KEY}
  `;
  if (!source) {
    throw new Error(`Required source '${BROWNLOW_MANUAL_SOURCE_KEY}' is not configured.`);
  }
  return source.id;
}

/**
 * Write the canonical match facts (§27.10 item 1), claim-and-demote.
 *
 * Order matters and is not incidental. Migration 094's partial unique
 * index on `(match_id, votes) WHERE votes > 0` means no two rows of a
 * match may hold the same positive value even for an instant, so a
 * correction that swaps two players' votes would violate it mid-update.
 * Demoting every value first and then claiming the three leaves no
 * intermediate state that can collide.
 *
 *   1. resolve — attach this match to the participants' unresolved rows
 *      for the same season and round, provenance untouched. This is the
 *      migration-094 backfill applied to rows the backfill could not
 *      settle, and it is what makes a claim see them at all;
 *   2. demote — every row of the match holding a value drops to zero
 *      ("played, polled nothing"), taking manual provenance because a
 *      human decided it. Rows already at zero are left completely alone;
 *   3. claim — the three selected players are upserted with 3, 2 and 1.
 *
 * A void skips 2 and 3 and instead withdraws every value on the match to
 * NULL, keeping `played` (operator decision D2).
 */
async function writeMatchFacts(
  tx: postgres.TransactionSql,
  input: {
    match: LockedMatch;
    selection: BrownlowSelection | null;
    revision: number;
    sourceId: number;
  },
): Promise<void> {
  const { match, selection, revision, sourceId } = input;
  const sourceRecordId = entrySourceRecordId(match.id, revision);

  // 1. Resolve — never guessed: only rows for players this match's own
  // line-up contains, in this match's own season and round.
  await tx`
    UPDATE brownlow_round_votes brv
       SET match_id = ${match.id}
     WHERE brv.match_id IS NULL
       AND brv.season = ${match.season}
       AND brv.round_number = ${match.roundNumber}
       AND EXISTS (
         SELECT 1 FROM player_match_stats pms
          WHERE pms.match_id = ${match.id} AND pms.player_id = brv.player_id
       )
  `;

  if (selection === null) {
    // Void: withdraw the values, keep the participation record.
    await tx`
      UPDATE brownlow_round_votes
         SET votes = NULL,
             source_id = ${sourceId},
             source_record_id = ${sourceRecordId},
             import_batch_id = NULL,
             imported_at = now()
       WHERE match_id = ${match.id}
         AND votes IS NOT NULL
    `;
    await tx`
      UPDATE player_match_stats
         SET brownlow_votes = NULL
       WHERE match_id = ${match.id}
         AND brownlow_votes IS NOT NULL
    `;
    return;
  }

  const complete = asCompleteSelection(selection);

  // 2. Demote. `IS DISTINCT FROM 0` catches both a positive value and the
  // NULL a previous void left behind.
  await tx`
    UPDATE brownlow_round_votes
       SET votes = 0,
           played = true,
           source_id = ${sourceId},
           source_record_id = ${sourceRecordId},
           import_batch_id = NULL,
           imported_at = now()
     WHERE match_id = ${match.id}
       AND votes IS DISTINCT FROM 0
  `;

  // 3. Claim. The upsert covers the current-season case where the player
  // has no round row at all yet, without manufacturing rows for the
  // forty players who do not appear here (see the entry.ts header).
  for (const [playerId, votes] of [
    [complete.three, 3], [complete.two, 2], [complete.one, 1],
  ] as const) {
    await tx`
      INSERT INTO brownlow_round_votes
            (season, player_id, round_number, match_id, played, votes,
             source_id, source_record_id, import_batch_id, imported_at)
      VALUES (${match.season}, ${playerId}, ${match.roundNumber}, ${match.id}, true, ${votes},
              ${sourceId}, ${sourceRecordId}, NULL, now())
      ON CONFLICT (season, player_id, round_number) DO UPDATE
         SET match_id         = EXCLUDED.match_id,
             played           = true,
             votes            = EXCLUDED.votes,
             source_id        = EXCLUDED.source_id,
             source_record_id = EXCLUDED.source_record_id,
             import_batch_id  = NULL,
             imported_at      = now()
    `;
  }

  // The per-match mirror, dense across the line-up: 3/2/1 to the chosen
  // and 0 to everybody else who played (§27.10 item 1).
  await tx`
    UPDATE player_match_stats
       SET brownlow_votes = CASE player_id
                              WHEN ${complete.three} THEN 3
                              WHEN ${complete.two}   THEN 2
                              WHEN ${complete.one}   THEN 1
                              ELSE 0
                            END
     WHERE match_id = ${match.id}
  `;
}

/**
 * The season rows a publication (or a correction inside a published
 * season) writes (§27.10 item 2).
 *
 * Returns the union of the players whose career totals the change can
 * touch — those in the old rows and those in the new — because a player
 * dropping out of the season entirely still needs his career total
 * rebuilt.
 */
async function writeSeasonRows(
  tx: postgres.TransactionSql,
  input: {
    season: number;
    revision: number;
    ineligiblePlayerIds: number[];
    sourceId: number;
  },
): Promise<{ affectedPlayerIds: number[]; rowCount: number; votesTotal: number; winners: number[] }> {
  const { season, revision, ineligiblePlayerIds, sourceId } = input;

  const facts = await tx<Array<{ playerId: number; votes: number | null }>>`
    SELECT player_id AS "playerId", votes
      FROM brownlow_round_votes
     WHERE season = ${season} AND votes > 0
  `;

  const games = await tx<Array<{ playerId: number; homeAndAway: number }>>`
    SELECT player_id AS "playerId",
           (games - COALESCE(finals, 0))::int AS "homeAndAway"
      FROM player_season_stats
     WHERE season = ${season}
  `;

  const derived = must(deriveSeasonRows({
    facts,
    ineligiblePlayerIds,
    homeAndAwayGames: new Map(games.map((row) => [row.playerId, row.homeAndAway])),
  }));

  const previous = await tx<Array<{ playerId: number }>>`
    SELECT player_id AS "playerId" FROM brownlow_season_votes WHERE season = ${season}
  `;

  await tx`DELETE FROM brownlow_season_votes WHERE season = ${season}`;

  const sourceRecordId = publishSourceRecordId(season, revision);
  for (const row of derived) {
    await tx`
      INSERT INTO brownlow_season_votes
            (season, player_id, club_id, votes, vote_rank, eligible_rank,
             is_ineligible, is_winner, games,
             three_vote_games, two_vote_games, one_vote_games, polling_games,
             link_status_value, source_id, source_record_id, import_batch_id)
      VALUES (${season}, ${row.playerId}, NULL, ${row.votes}, ${row.voteRank}, ${row.eligibleRank},
              ${row.isIneligible}, ${row.isWinner}, ${row.games},
              ${row.threeVoteGames}, ${row.twoVoteGames}, ${row.oneVoteGames}, ${row.pollingGames},
              ${row.linkStatusValue}, ${sourceId}, ${sourceRecordId}, NULL)
    `;
  }

  const affected = new Set<number>(previous.map((row) => row.playerId));
  for (const row of derived) affected.add(row.playerId);

  await recomputeSeasonBrownlowStatus(tx, season);
  await recomputeBrownlowCareerTotals(tx, [...affected]);

  return {
    affectedPlayerIds: [...affected].sort((a, b) => a - b),
    rowCount: derived.length,
    votesTotal: derived.reduce((sum, row) => sum + row.votes, 0),
    winners: derived.filter((row) => row.isWinner).map((row) => row.playerId),
  };
}

/**
 * Insert-if-absent then lock the season authority row, and report
 * whether the season's public totals are this workflow's to maintain.
 */
async function lockSeasonAuthority(
  tx: postgres.TransactionSql,
  season: number,
  actorId: number,
): Promise<{ revision: number; publishedRevision: number | null; expectedRevision: number }> {
  const created = await tx`
    INSERT INTO brownlow_season_authority (season, updated_by)
    VALUES (${season}, ${actorId})
    ON CONFLICT (season) DO NOTHING
    RETURNING season
  `;
  const [row] = await tx<Array<{ revision: number; publishedRevision: number | null }>>`
    SELECT revision, published_revision AS "publishedRevision"
      FROM brownlow_season_authority
     WHERE season = ${season}
       FOR UPDATE
  `;
  return {
    ...row,
    // A season nobody has administered has no authority row, and the page
    // that rendered it saw revision 0. Comparing the CAS against the row
    // this call just created would refuse every first publication.
    expectedRevision: created.count > 0 ? 0 : row.revision,
  };
}

/**
 * The one implementation behind `saveDraft`, `finalise`, `correct` and
 * `void` (§27.17). They differ in five decisions — which transition,
 * whether a reason is required, whether the selection must be complete,
 * whether the fingerprint is checked, and what the audit calls it — and
 * are otherwise the same sequence of locks, checks and writes. Writing
 * them out four times is how three of them quietly drift.
 */
async function runMatchMutation(
  action: BrownlowAction,
  input: MatchMutationInput,
): Promise<BrownlowMutationResult> {
  const touchesSeasonAuthority = action !== 'saveDraft';
  const importSql = importConnection();

  try {
    const result = await importSql.begin(async (tx) => {
      // Lock order (§27.14): advisory, match, entry, season authority.
      if (touchesSeasonAuthority) {
        await tx`SELECT pg_advisory_xact_lock(${BROWNLOW_ADVISORY_KEY[0]}, ${BROWNLOW_ADVISORY_KEY[1]})`;
      }

      const match = await lockMatch(tx, input.matchId);
      const entry = await lockEntry(tx, match);
      const from = entry?.status ?? null;

      // Revision CAS first, transition second. The two orders differ only when
      // BOTH are violated, which is exactly the race of §27.14: two Super
      // Admins finalise from the same rendered revision, the winner commits,
      // and the loser now sees a row that is both final and moved. §27.14
      // ("Two finalisations -> second refused stale") is the normative answer
      // there, and it is the more useful one: the loser did not choose to act
      // on a decided match, it acted on a page that stopped being true.
      // §27.17 step 4's already_final is preserved for the case it describes —
      // an administrator who can see the final row (revision unchanged) and
      // presses Finalise anyway is told to use Correct.
      assertRevision(entry, input.expectedRevision);
      const transition = must(checkTransition(from, action));

      const reason = must(validateReason(input.reason, {
        required: reasonRequired(from, action),
      }));

      const participants = await tx<Array<{ playerId: number; clubId: number }>>`
        SELECT player_id AS "playerId", club_id AS "clubId"
          FROM player_match_stats
         WHERE match_id = ${match.id}
      `;

      const selection: BrownlowSelection = action === 'void'
        ? { three: null, two: null, one: null }
        : must(validateSelection(
          input.selection ?? { three: null, two: null, one: null },
          participants.map((row) => row.playerId),
          { requireComplete: action !== 'saveDraft' },
        ));

      if (action !== 'saveDraft') {
        // §27.6: a vote may only become public against a line-up that is
        // actually a line-up. There is no override inside this workflow.
        const assessment = assessParticipants(
          participants, match.homeClubId, match.awayClubId,
        );
        if (!assessment.complete) {
          refuse('participants_incomplete', assessment.shortfall ?? undefined);
        }

        // §27.14 fingerprint CAS: catches a settle landing a vote, another
        // Super Admin's correction, or an operator repair since render.
        const canonicalNow = await selectCanonicalRows(tx, {
          matchId: match.id, season: match.season, roundNumber: match.roundNumber,
        });
        const fingerprintNow = canonicalFingerprint(canonicalNow);
        if (input.expectedCanonicalFingerprint !== undefined
          && input.expectedCanonicalFingerprint !== fingerprintNow) {
          refuse('stale', 'The recorded votes for this match changed since the page was loaded.');
        }
      }

      const canonicalBefore = await selectCanonicalRows(tx, {
        matchId: match.id, season: match.season, roundNumber: match.roundNumber,
      });
      const revision = (entry?.revision ?? 0) + 1;

      if (action !== 'saveDraft') {
        const sourceId = await requireManualSourceId(tx);
        await writeMatchFacts(tx, {
          match,
          selection: action === 'void' ? null : selection,
          revision,
          sourceId,
        });
      }

      const status: BrownlowEntryStatus = transition.to;
      const finalising = status !== 'draft';

      await tx`
        INSERT INTO brownlow_vote_entry_state
              (match_id, season, status, three_player_id, two_player_id, one_player_id,
               revision, created_by, updated_by, updated_at,
               finalised_by, finalised_at, finalised_revision, last_reason)
        VALUES (${match.id}, ${match.season}, ${status},
                ${selection.three}, ${selection.two}, ${selection.one},
                ${revision}, ${input.actorId}, ${input.actorId}, now(),
                ${finalising ? input.actorId : null},
                CASE WHEN ${finalising}::boolean THEN now() ELSE NULL END,
                ${finalising ? revision : null},
                ${reason})
        ON CONFLICT (match_id) DO UPDATE
           SET status             = EXCLUDED.status,
               three_player_id    = EXCLUDED.three_player_id,
               two_player_id      = EXCLUDED.two_player_id,
               one_player_id      = EXCLUDED.one_player_id,
               revision           = EXCLUDED.revision,
               updated_by         = EXCLUDED.updated_by,
               updated_at         = now(),
               finalised_by       = COALESCE(EXCLUDED.finalised_by, brownlow_vote_entry_state.finalised_by),
               finalised_at       = COALESCE(EXCLUDED.finalised_at, brownlow_vote_entry_state.finalised_at),
               finalised_revision = COALESCE(EXCLUDED.finalised_revision, brownlow_vote_entry_state.finalised_revision),
               last_reason        = EXCLUDED.last_reason
      `;

      let republishedSeason: number | null = null;
      if (touchesSeasonAuthority) {
        const authority = await lockSeasonAuthority(tx, match.season, input.actorId);
        const seasonRevision = authority.revision + 1;

        if (authority.publishedRevision !== null) {
          // The season's public totals are already derived from the match
          // set this mutation just changed, so they are re-derived in the
          // SAME transaction: there is no published-but-unreconciled state.
          const ineligible = await tx<Array<{ playerId: number }>>`
            SELECT player_id AS "playerId"
              FROM brownlow_season_votes
             WHERE season = ${match.season} AND is_ineligible
          `;
          const sourceId = await requireManualSourceId(tx);
          const summary = await writeSeasonRows(tx, {
            season: match.season,
            revision: seasonRevision,
            ineligiblePlayerIds: ineligible.map((row) => row.playerId),
            sourceId,
          });
          republishedSeason = match.season;

          await tx`
            UPDATE brownlow_season_authority
               SET revision = ${seasonRevision},
                   published_revision = ${seasonRevision},
                   published_by = ${input.actorId},
                   published_at = now(),
                   updated_by = ${input.actorId},
                   updated_at = now()
             WHERE season = ${match.season}
          `;
          await recordDataEdit(tx, {
            tableName: 'brownlow_season_authority',
            rowId: match.season,
            fieldGroup: 'republish',
            oldValues: { revision: authority.revision, publishedRevision: authority.publishedRevision },
            newValues: {
              revision: seasonRevision,
              publishedRevision: seasonRevision,
              rowCount: summary.rowCount,
              votesTotal: summary.votesTotal,
              winners: summary.winners,
              ineligible: ineligible.map((row) => row.playerId),
            },
            adminUserId: input.actorId,
            note: reason,
          });
        } else {
          await tx`
            UPDATE brownlow_season_authority
               SET revision = ${seasonRevision},
                   updated_by = ${input.actorId},
                   updated_at = now()
             WHERE season = ${match.season}
          `;
        }

        await recomputeBrownlowCoverage(tx, match.season);
      }

      const canonicalAfter = await selectCanonicalRows(tx, {
        matchId: match.id, season: match.season, roundNumber: match.roundNumber,
      });

      const auditField: Record<BrownlowAction, string> = {
        saveDraft: 'draft', finalise: 'finalise', correct: 'correct', void: 'void',
      };
      await recordDataEdit(tx, {
        tableName: 'brownlow_vote_entry_state',
        rowId: match.id,
        fieldGroup: auditField[action],
        oldValues: {
          status: from,
          three: entry?.three ?? null,
          two: entry?.two ?? null,
          one: entry?.one ?? null,
          revision: entry?.revision ?? 0,
          canonicalRows: auditRows(canonicalBefore),
        },
        newValues: {
          status,
          three: selection.three,
          two: selection.two,
          one: selection.one,
          revision,
          canonicalRows: auditRows(canonicalAfter),
        },
        adminUserId: input.actorId,
        note: reason ?? input.note ?? null,
      });

      return {
        matchId: match.id, status, revision, selection, republishedSeason,
      };
    });

    return { ok: true, value: result };
  } catch (error) {
    if (error instanceof BrownlowRefusalError) return error.refusal;
    return databaseRefusal(error, `Brownlow ${action} on match #${input.matchId}`);
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

/** The audited shape of a canonical row: what it says, and who said it. */
function auditRows(rows: readonly CanonicalRowWithName[]): Array<Record<string, unknown>> {
  return rows
    .filter((row) => row.votes !== null && row.votes > 0)
    .map((row) => ({ playerId: row.playerId, votes: row.votes, sourceId: row.sourceId }));
}

function databaseRefusal(error: unknown, context: string): BrownlowRefusal {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[admin-brownlow] ${context} failed:`, error);
  return brownlowRefusal('db_error', message);
}

/** Admin or Super Admin: save a selection that reaches no public query. */
export function saveDraftBrownlowMatch(input: MatchMutationInput): Promise<BrownlowMutationResult> {
  return runMatchMutation('saveDraft', input);
}

/** Super Admin: make the selection a public fact. */
export function finaliseBrownlowMatch(input: MatchMutationInput): Promise<BrownlowMutationResult> {
  return runMatchMutation('finalise', input);
}

/** Super Admin: change a finalised match, with a reason and full audit. */
export function correctBrownlowMatch(input: MatchMutationInput): Promise<BrownlowMutationResult> {
  return runMatchMutation('correct', input);
}

/** Super Admin: declare that no votes were awarded in this match. */
export function voidBrownlowMatch(
  input: Omit<MatchMutationInput, 'selection'>,
): Promise<BrownlowMutationResult> {
  return runMatchMutation('void', input);
}

export type PublishSeasonResult = BrownlowOutcome<{
  season: number;
  revision: number;
  rowCount: number;
  votesTotal: number;
  winners: number[];
}>;

/**
 * Super Admin: derive the season's public totals from the finalised
 * match set and take authority for them (§27.9, §27.17).
 *
 * Idempotent for identical inputs: re-publishing produces identical rows
 * and a new revision. There is no unpublish — reversal is a correction
 * and a re-publish.
 */
export async function publishBrownlowSeason(input: {
  season: number;
  ineligiblePlayerIds: number[];
  expectedRevision: number;
  actorId: number;
  note?: string | null;
}): Promise<PublishSeasonResult> {
  const importSql = importConnection();

  try {
    const result = await importSql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${BROWNLOW_ADVISORY_KEY[0]}, ${BROWNLOW_ADVISORY_KEY[1]})`;

      const [season] = await tx<Array<{ year: number }>>`
        SELECT year FROM seasons WHERE year = ${input.season}
      `;
      if (!season) refuse('not_found', `Season ${input.season} does not exist.`, 'season');

      const [availability] = await tx<Array<{ coverage: string }>>`
        SELECT coverage::text AS coverage
          FROM stat_availability
         WHERE stat_key = 'brownlow_season_total' AND season = ${input.season}
      `;
      if (!availability || availability.coverage === 'not_applicable') {
        refuse('season_not_polled', `No Brownlow Medal was awarded in ${input.season}.`);
      }

      const authority = await lockSeasonAuthority(tx, input.season, input.actorId);
      if (authority.expectedRevision !== input.expectedRevision) {
        refuse(
          'stale',
          `The season has changed since the page was loaded (revision ${authority.revision}, not ${input.expectedRevision}).`,
          // §27.27 E-1: this refusal is about the season, not a match.
          'season',
        );
      }

      // Completeness is measured here, under the lock, from the same
      // definition the read model shows (§27.9) — never from a count the
      // browser sent back.
      const [counts] = await tx<Array<{
        expected: number; accounted: number; unresolved: number;
      }>>`
        SELECT count(*)::int AS expected,
               count(*) FILTER (
                 WHERE es.status = 'void'
                    OR (rv.total = 6 AND rv.positives = 3 AND rv.distinct_values = 3)
               )::int AS accounted,
               (SELECT count(*) FROM brownlow_round_votes
                 WHERE season = ${input.season} AND match_id IS NULL)::int AS unresolved
          FROM matches m
          LEFT JOIN brownlow_vote_entry_state es ON es.match_id = m.id
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(brv.votes), 0)                            AS total,
                   count(*) FILTER (WHERE brv.votes > 0)                  AS positives,
                   count(DISTINCT brv.votes) FILTER (WHERE brv.votes > 0) AS distinct_values
              FROM brownlow_round_votes brv WHERE brv.match_id = m.id
          ) rv ON true
         WHERE m.season = ${input.season} AND m.round_type = 'home_and_away'
      `;

      if (counts.expected === 0 || counts.accounted < counts.expected) {
        refuse(
          'season_incomplete',
          `${counts.accounted} of ${counts.expected} home-and-away matches are accounted for.`,
        );
      }
      if (counts.unresolved > 0) {
        refuse(
          'season_incomplete',
          `${counts.unresolved} round vote row(s) are not attached to a match.`,
        );
      }

      // Every ineligible player must actually have polled: an ineligibility
      // flag on a player with no votes is a mistake, not a decision.
      const polled = await tx<Array<{ playerId: number }>>`
        SELECT DISTINCT player_id AS "playerId"
          FROM brownlow_round_votes
         WHERE season = ${input.season} AND votes > 0
      `;
      const polledIds = new Set(polled.map((row) => row.playerId));
      const strays = input.ineligiblePlayerIds.filter((id) => !polledIds.has(id));
      if (strays.length > 0) {
        refuse(
          'invalid',
          `Player(s) ${strays.join(', ')} are marked ineligible but polled no votes in ${input.season}.`,
        );
      }

      const revision = authority.revision + 1;
      const sourceId = await requireManualSourceId(tx);
      const summary = await writeSeasonRows(tx, {
        season: input.season,
        revision,
        ineligiblePlayerIds: input.ineligiblePlayerIds,
        sourceId,
      });
      await recomputeBrownlowCoverage(tx, input.season);

      await tx`
        UPDATE brownlow_season_authority
           SET revision = ${revision},
               published_revision = ${revision},
               published_by = ${input.actorId},
               published_at = now(),
               updated_by = ${input.actorId},
               updated_at = now()
         WHERE season = ${input.season}
      `;

      await recordDataEdit(tx, {
        tableName: 'brownlow_season_authority',
        rowId: input.season,
        fieldGroup: 'publish',
        oldValues: {
          revision: authority.revision,
          publishedRevision: authority.publishedRevision,
        },
        newValues: {
          revision,
          publishedRevision: revision,
          authority: 'manual',
          rowCount: summary.rowCount,
          votesTotal: summary.votesTotal,
          winners: summary.winners,
          ineligible: [...input.ineligiblePlayerIds].sort((a, b) => a - b),
        },
        adminUserId: input.actorId,
        note: input.note ?? null,
      });

      return {
        season: input.season,
        revision,
        rowCount: summary.rowCount,
        votesTotal: summary.votesTotal,
        winners: summary.winners,
      };
    });

    return { ok: true, value: result };
  } catch (error) {
    if (error instanceof BrownlowRefusalError) return error.refusal;
    return databaseRefusal(error, `Brownlow publish of ${input.season}`);
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
