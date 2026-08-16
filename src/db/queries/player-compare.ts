import 'server-only';

import { sql } from '@/db/client';

/**
 * Queries backing /players/compare: career comparison reuses getPlayer()
 * and getPlayerHonours() directly (players.ts, awards.ts) -- everything
 * here is the part those don't already cover: single-game bests across
 * all seven era-limited stats (player_career_stats only precomputes
 * bestGoalsGame/bestDisposalsGame), and the shared-match self-join that
 * answers "played with/against", modelled on player_compare.py's
 * overlap() and explore.py's _player_connections().
 */

// --- Best single game ---

export type BestSingleGame = {
  goals: number | null;
  behinds: number | null;
  kicks: number | null;
  handballs: number | null;
  disposals: number | null;
  marks: number | null;
  tackles: number | null;
  hitouts: number | null;
};

/**
 * The best a player ever did, per statistic, in one game -- across all
 * seven era-limited stats, not just the two player_career_stats
 * precomputes. One indexed scan (ix_pms_player) bounded to that player's
 * own games. MAX() with no matching rows returns one all-NULL row, never
 * zero rows, so this never needs the empty-result fallback getPlayerMatches
 * uses for paged queries.
 */
export async function getBestSingleGame(playerId: number): Promise<BestSingleGame> {
  const [row] = await sql<BestSingleGame[]>`
    SELECT max(goals) AS goals, max(behinds) AS behinds,
           max(kicks) AS kicks, max(handballs) AS handballs,
           max(disposals) AS disposals, max(marks) AS marks,
           max(tackles) AS tackles, max(hitouts) AS hitouts
      FROM player_match_stats
     WHERE player_id = ${playerId}
  `;
  return row;
}

// --- Shared matches: summary ---

export type OverlapSummary = {
  together: number;
  togetherFrom: number | null;
  togetherTo: number | null;
  against: number;
  againstFrom: number | null;
  againstTo: number | null;
};

/**
 * Did these two ever share a match, as teammates or opponents? Self-join
 * on match_id, grouped by same-club-or-not. Callers must never pass the
 * same player_id for both a and b: pms_player_match_uq means pms1 and
 * pms2 would collapse onto the same row for every one of that player's
 * matches, reporting their whole career as "together". The compare page
 * already refuses to compare a player against themselves before any
 * query in this file runs, so that guard is not repeated here.
 */
export async function getPlayerOverlapSummary(a: number, b: number): Promise<OverlapSummary> {
  const rows = await sql<{ sameClub: boolean; games: number; fromSeason: number; toSeason: number }[]>`
    SELECT (pms1.club_id = pms2.club_id) AS "sameClub", count(*)::int AS games,
           min(m.season) AS "fromSeason", max(m.season) AS "toSeason"
      FROM player_match_stats pms1
      JOIN player_match_stats pms2 ON pms2.match_id = pms1.match_id
      JOIN matches m ON m.id = pms1.match_id
     WHERE pms1.player_id = ${a} AND pms2.player_id = ${b}
     GROUP BY (pms1.club_id = pms2.club_id)
  `;
  const together = rows.find((r) => r.sameClub) ?? null;
  const against = rows.find((r) => !r.sameClub) ?? null;
  return {
    together: together?.games ?? 0,
    togetherFrom: together?.fromSeason ?? null,
    togetherTo: together?.toSeason ?? null,
    against: against?.games ?? 0,
    againstFrom: against?.fromSeason ?? null,
    againstTo: against?.toSeason ?? null,
  };
}

// --- Shared matches: full drill-down ---

export type HeadToHeadRelationship = 'all' | 'teammates' | 'opponents';

export type HeadToHeadMatch = {
  matchId: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  matchDate: Date;
  venueName: string;
  relationship: 'teammates' | 'opponents';
  aClubName: string;
  aClubSlug: string;
  bClubName: string;
  bClubSlug: string;
  homeClubId: number;
  homeScore: number;
  awayScore: number;
  aGoals: number | null;
  aKicks: number | null;
  aMarks: number | null;
  aDisposals: number | null;
  aTackles: number | null;
  aBrownlowVotes: number | null;
  bGoals: number | null;
  bKicks: number | null;
  bMarks: number | null;
  bDisposals: number | null;
  bTackles: number | null;
  bBrownlowVotes: number | null;
};

/**
 * Defensive cap, not a page size. This is every match two specific careers
 * share, categorically smaller than "one player's whole match log" (which
 * is what getPlayerMatches paginates) -- the longest-overlapping pair of
 * teammates in VFL/AFL history falls well under this.
 */
const HEAD_TO_HEAD_LIMIT = 500;

/** Every match two players shared, as teammates and/or opponents, newest first. */
export async function getHeadToHeadMatches(
  a: number,
  b: number,
  relationship: HeadToHeadRelationship,
): Promise<HeadToHeadMatch[]> {
  const relationshipFilter = relationship === 'teammates'
    ? sql`pms1.club_id = pms2.club_id`
    : relationship === 'opponents'
      ? sql`pms1.club_id <> pms2.club_id`
      : sql`TRUE`;

  return sql<HeadToHeadMatch[]>`
    SELECT m.id AS "matchId", m.season, m.round_type AS "roundType",
           m.round_number AS "roundNumber", m.match_date AS "matchDate",
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           CASE WHEN pms1.club_id = pms2.club_id THEN 'teammates' ELSE 'opponents' END AS relationship,
           ca.name AS "aClubName", ca.slug AS "aClubSlug",
           cb.name AS "bClubName", cb.slug AS "bClubSlug",
           m.home_club_id AS "homeClubId", m.home_score AS "homeScore", m.away_score AS "awayScore",
           pms1.goals AS "aGoals", pms1.kicks AS "aKicks", pms1.marks AS "aMarks",
           pms1.disposals AS "aDisposals", pms1.tackles AS "aTackles",
           pms1.brownlow_votes AS "aBrownlowVotes",
           pms2.goals AS "bGoals", pms2.kicks AS "bKicks", pms2.marks AS "bMarks",
           pms2.disposals AS "bDisposals", pms2.tackles AS "bTackles",
           pms2.brownlow_votes AS "bBrownlowVotes"
      FROM player_match_stats pms1
      JOIN player_match_stats pms2 ON pms2.match_id = pms1.match_id
      JOIN matches m ON m.id = pms1.match_id
      JOIN clubs ca ON ca.id = pms1.club_id
      JOIN clubs cb ON cb.id = pms2.club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE pms1.player_id = ${a} AND pms2.player_id = ${b}
       AND ${relationshipFilter}
     ORDER BY m.match_date DESC, m.id DESC
     LIMIT ${HEAD_TO_HEAD_LIMIT}
  `;
}
