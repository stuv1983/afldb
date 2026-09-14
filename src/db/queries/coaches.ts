import 'server-only';

import { sql } from '@/db/client';

/**
 * Coaches for a picker, e.g. the grid solver's Coaching category.
 *
 * One row per person who coached (AFLDB-ISSUE-118 §23.27), labelled with the
 * span of seasons match_coaches records for them so two coaches who share a
 * surname read apart. Every coach is listed, whether or not they also played.
 */
export async function getCoachOptions() {
  return sql<{ id: number; name: string }[]>`
    SELECT c.id,
           c.display_name
             || COALESCE(' (' || min(m.season)::text || '–' || max(m.season)::text || ')', '') AS name
      FROM coaches c
      LEFT JOIN match_coaches mc ON mc.coach_id = c.id
      LEFT JOIN matches m ON m.id = mc.match_id
     GROUP BY c.id, c.display_name
     ORDER BY c.surname, c.given_name, c.display_name
  `;
}

export type CoachingClubStint = {
  clubId: number;
  clubName: string;
  clubSlug: string;
  firstSeason: number;
  lastSeason: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  finals: number;
  grandFinals: number;
  premierships: number;
  winPct: number | null;
};

/**
 * One decided (non-drawn) match a coach was assigned to, from the
 * coach's own perspective (AFLDB-ISSUE-170 Stage 1A). `margin` is signed:
 * positive for a win, negative for a loss, by exactly the formula in the
 * approved runbook -- home_score - away_score when the coached club is
 * home, away_score - home_score when it is away. Never built for a draw.
 */
export type CoachCareerMatch = {
  matchId: number;
  season: number;
  matchDate: Date;
  roundType: string;
  isFinalsSeries: boolean;
  coachedClubId: number;
  coachedClubName: string;
  coachedClubSlug: string;
  opponentClubId: number;
  opponentClubName: string;
  opponentClubSlug: string;
  margin: number;
  venueId: number | null;
  venueName: string | null;
  venueSlug: string | null;
};

type CoachCareerMatchRaw = Omit<CoachCareerMatch, 'margin'> & {
  homeClubId: number;
  homeScore: number;
  awayScore: number;
};

/**
 * One venue a coach has at least one canonical assignment at
 * (AFLDB-ISSUE-170 Stage 1B). Counted the same way as {@link CoachingClubStint}
 * (all assignments, not just decided ones), but grouped by `venue_id`
 * instead of `club_id` -- a coach's record travels with them across every
 * club they coached at that ground.
 */
export type CoachVenueRecord = {
  venueId: number;
  venueName: string;
  venueSlug: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winPct: number | null;
  finals: number;
  grandFinals: number;
  firstMatchId: number;
  firstMatchDate: Date;
  lastMatchId: number;
  lastMatchDate: Date;
};

export type CoachCareer = {
  coachId: number;
  clubs: CoachingClubStint[];
  totals: Omit<CoachingClubStint, 'clubId' | 'clubName' | 'clubSlug' | 'firstSeason' | 'lastSeason'>;
  /** The coach's biggest win/loss across their whole career, or null with no qualifying (decided) match. */
  biggestWin: CoachCareerMatch | null;
  biggestLoss: CoachCareerMatch | null;
  /**
   * Every venue with at least one canonical assignment, ordered `games
   * DESC, venue name ASC, venue id ASC` (AFLDB-ISSUE-170 Stage 1B). A
   * zero-game coach yields `[]`, never a fabricated venue.
   */
  venues: CoachVenueRecord[];
};

function winPct(wins: number, draws: number, games: number): number | null {
  return games > 0 ? ((wins + draws * 0.5) / games) * 100 : null;
}

/**
 * Coach-perspective margin for one decided match (AFLDB-ISSUE-170 Stage
 * 1A). Kept as a standalone pure function, rather than a SQL `CASE WHEN`,
 * so the home/away formula is unit-testable without a database.
 */
export function coachPerspectiveMargin(args: {
  coachedClubId: number;
  homeClubId: number;
  homeScore: number;
  awayScore: number;
}): number {
  return args.coachedClubId === args.homeClubId
    ? args.homeScore - args.awayScore
    : args.awayScore - args.homeScore;
}

/**
 * Deterministic tie-break among a coach's biggest wins/losses
 * (AFLDB-ISSUE-170 Stage 1A): largest absolute margin first, then
 * earliest match date, then lowest match id. Never picks a zero-margin
 * (drawn) match for either direction. A pure function, unit-tested
 * directly with fixtures rather than relying on a real tie existing in
 * historical data.
 */
export function selectCareerRecordMatch(
  matches: CoachCareerMatch[],
  direction: 'win' | 'loss',
): CoachCareerMatch | null {
  const candidates = matches.filter((m) => (direction === 'win' ? m.margin > 0 : m.margin < 0));
  return candidates.reduce<CoachCareerMatch | null>((best, m) => {
    if (!best) return m;
    const mAbs = Math.abs(m.margin);
    const bestAbs = Math.abs(best.margin);
    if (mAbs !== bestAbs) return mAbs > bestAbs ? m : best;
    const mTime = m.matchDate.getTime();
    const bestTime = best.matchDate.getTime();
    if (mTime !== bestTime) return mTime < bestTime ? m : best;
    return m.matchId < best.matchId ? m : best;
  }, null);
}

/**
 * A coach's career, derived from `coaches` + `match_coaches` + `matches`
 * (AFLDB-ISSUE-118 §23.28) rather than the AFL Tables coach index's own
 * stored totals: those are evidence only (`source_games_coached`, never a
 * total -- see migration 087), so games/W-D-L/finals/premierships are
 * always counted from the canonical per-match assignment.
 *
 * Works for any canonical `coaches` row, including a coach-only person
 * whose `player_id IS NULL` -- the single aggregation both
 * {@link getPlayerCoachingCareer} and future coach-only/coach-comparison
 * read models delegate to. An unknown coach id returns null, never a
 * fabricated empty career.
 */
export async function getCoachCareer(coachId: number): Promise<CoachCareer | null> {
  const [coach] = await sql<{ id: number }[]>`
    SELECT id FROM coaches WHERE id = ${coachId}
  `;
  if (!coach) return null;

  const rows = await sql<Omit<CoachingClubStint, 'winPct'>[]>`
    SELECT cl.id AS "clubId", cl.name AS "clubName", cl.slug AS "clubSlug",
           min(m.season)::int AS "firstSeason", max(m.season)::int AS "lastSeason",
           count(*)::int AS games,
           count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
           count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
           count(*) FILTER (WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id)::int AS losses,
           count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
           count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals",
           count(*) FILTER (WHERE m.round_type = 'grand_final' AND m.winner_club_id = mc.club_id)::int AS premierships
      FROM match_coaches mc
      JOIN matches m ON m.id = mc.match_id
      JOIN clubs cl ON cl.id = mc.club_id
     WHERE mc.coach_id = ${coach.id}
     GROUP BY cl.id, cl.name, cl.slug
     ORDER BY min(m.season)
  `;
  const clubs = rows.map((r) => ({ ...r, winPct: winPct(r.wins, r.draws, r.games) }));

  const totals = clubs.reduce(
    (acc, c) => ({
      games: acc.games + c.games,
      wins: acc.wins + c.wins,
      draws: acc.draws + c.draws,
      losses: acc.losses + c.losses,
      finals: acc.finals + c.finals,
      grandFinals: acc.grandFinals + c.grandFinals,
      premierships: acc.premierships + c.premierships,
    }),
    { games: 0, wins: 0, draws: 0, losses: 0, finals: 0, grandFinals: 0, premierships: 0 },
  );

  // Every decided (non-drawn) match this coach was assigned to, raw
  // enough to compute the coach-perspective margin in JS
  // (coachPerspectiveMargin) rather than in SQL. A coach with zero
  // match_coaches rows, or with only draws, safely yields [] here.
  const decidedRaw = await sql<CoachCareerMatchRaw[]>`
    SELECT m.id AS "matchId", m.season, m.match_date AS "matchDate",
           m.round_type::text AS "roundType", m.is_finals_series AS "isFinalsSeries",
           mc.club_id AS "coachedClubId", cc.name AS "coachedClubName", cc.slug AS "coachedClubSlug",
           oc.id AS "opponentClubId", oc.name AS "opponentClubName", oc.slug AS "opponentClubSlug",
           m.home_club_id AS "homeClubId", m.home_score AS "homeScore", m.away_score AS "awayScore",
           v.id AS "venueId", v.canonical_name AS "venueName", v.slug AS "venueSlug"
      FROM match_coaches mc
      JOIN matches m ON m.id = mc.match_id
      JOIN clubs cc ON cc.id = mc.club_id
      JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE mc.coach_id = ${coach.id}
       AND m.winner_club_id IS NOT NULL
  `;
  const decided: CoachCareerMatch[] = decidedRaw.map(({ homeClubId, homeScore, awayScore, ...rest }) => ({
    ...rest,
    margin: coachPerspectiveMargin({ coachedClubId: rest.coachedClubId, homeClubId, homeScore, awayScore }),
  }));

  // One row per venue the coach has at least one canonical assignment at
  // (AFLDB-ISSUE-170 Stage 1B). `array_agg(... ORDER BY ...)` picks out the
  // first/most-recent match id and date per venue in the same aggregation
  // pass, rather than a per-venue round trip -- Stage 0 measured whole-
  // history aggregations at <=126ms, so this stays one query. A coach with
  // zero match_coaches rows safely yields [].
  const venueRows = await sql<Omit<CoachVenueRecord, 'winPct'>[]>`
    WITH assignments AS (
      SELECT mc.club_id AS coached_club_id, m.id AS match_id, m.match_date,
             m.is_finals_series, m.round_type, m.winner_club_id,
             v.id AS venue_id, v.canonical_name AS venue_name, v.slug AS venue_slug
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN venues v ON v.id = m.venue_id
       WHERE mc.coach_id = ${coach.id}
    )
    SELECT venue_id AS "venueId", venue_name AS "venueName", venue_slug AS "venueSlug",
           count(*)::int AS games,
           count(*) FILTER (WHERE winner_club_id = coached_club_id)::int AS wins,
           count(*) FILTER (WHERE winner_club_id IS NULL)::int AS draws,
           count(*) FILTER (WHERE winner_club_id IS NOT NULL AND winner_club_id <> coached_club_id)::int AS losses,
           count(*) FILTER (WHERE is_finals_series)::int AS finals,
           count(*) FILTER (WHERE round_type = 'grand_final')::int AS "grandFinals",
           (array_agg(match_id ORDER BY match_date ASC, match_id ASC))[1] AS "firstMatchId",
           (array_agg(match_date ORDER BY match_date ASC, match_id ASC))[1] AS "firstMatchDate",
           (array_agg(match_id ORDER BY match_date DESC, match_id DESC))[1] AS "lastMatchId",
           (array_agg(match_date ORDER BY match_date DESC, match_id DESC))[1] AS "lastMatchDate"
      FROM assignments
     GROUP BY venue_id, venue_name, venue_slug
     ORDER BY count(*) DESC, venue_name ASC, venue_id ASC
  `;
  const venues = venueRows.map((r) => ({ ...r, winPct: winPct(r.wins, r.draws, r.games) }));

  return {
    coachId: coach.id,
    clubs,
    totals: { ...totals, winPct: winPct(totals.wins, totals.draws, totals.games) },
    biggestWin: selectCareerRecordMatch(decided, 'win'),
    biggestLoss: selectCareerRecordMatch(decided, 'loss'),
    venues,
  };
}

/**
 * Convenience wrapper for the player page: resolves the player's uniquely
 * linked coach row (matching the `premiership_coach` Grid Solver builder's
 * link requirement) and delegates to {@link getCoachCareer}. An unlinked
 * player returns null, never a fabricated empty career.
 */
export async function getPlayerCoachingCareer(playerId: number): Promise<CoachCareer | null> {
  const [coach] = await sql<{ id: number }[]>`
    SELECT id FROM coaches WHERE player_id = ${playerId} AND link_status_value = 'unique'
  `;
  if (!coach) return null;
  return getCoachCareer(coach.id);
}

/** Opponent organisation identity, kept minimal -- just enough for a Stage 1D link/label. */
export type CoachOpponentOrganization = {
  id: number;
  name: string;
  slug: string;
};

export type CoachOrganizationTotals = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  finals: number;
  grandFinals: number;
  winPct: number | null;
};

export type CoachOrganizationRecord = {
  coachId: number;
  organization: CoachOpponentOrganization;
  totals: CoachOrganizationTotals;
  biggestWin: CoachCareerMatch | null;
  biggestLoss: CoachCareerMatch | null;
  venues: CoachVenueRecord[];
};

/**
 * Every decided (non-drawn) match a coach was assigned to against ANY
 * historical identity inside one opponent organisation (AFLDB-ISSUE-170
 * Stage 1C, Stage 0 §0.5) -- the same shape/margin logic as
 * {@link getCoachCareer}'s `decided` query, kept as its own query rather
 * than a shared parameterised one so Stage 1A/1B's existing query is never
 * touched by this addition.
 */
async function getDecidedMatchesAgainstOrganization(
  coachId: number,
  organizationId: number,
): Promise<CoachCareerMatch[]> {
  const rows = await sql<CoachCareerMatchRaw[]>`
    SELECT m.id AS "matchId", m.season, m.match_date AS "matchDate",
           m.round_type::text AS "roundType", m.is_finals_series AS "isFinalsSeries",
           mc.club_id AS "coachedClubId", cc.name AS "coachedClubName", cc.slug AS "coachedClubSlug",
           oc.id AS "opponentClubId", oc.name AS "opponentClubName", oc.slug AS "opponentClubSlug",
           m.home_club_id AS "homeClubId", m.home_score AS "homeScore", m.away_score AS "awayScore",
           v.id AS "venueId", v.canonical_name AS "venueName", v.slug AS "venueSlug"
      FROM match_coaches mc
      JOIN matches m ON m.id = mc.match_id
      JOIN clubs cc ON cc.id = mc.club_id
      JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE mc.coach_id = ${coachId}
       AND m.winner_club_id IS NOT NULL
       AND oc.organization_id = ${organizationId}
  `;
  return rows.map(({ homeClubId, homeScore, awayScore, ...rest }) => ({
    ...rest,
    margin: coachPerspectiveMargin({ coachedClubId: rest.coachedClubId, homeClubId, homeScore, awayScore }),
  }));
}

/**
 * One coach's record against a single opponent club-organisation
 * (AFLDB-ISSUE-170 Stage 1C): Games/W/D/L/Win%/Finals/Grand Finals,
 * biggest win/loss (Stage 1A's contract type and
 * {@link selectCareerRecordMatch} tie-break, reused verbatim) and venue
 * history (Stage 1B's {@link CoachVenueRecord} shape and aggregation
 * approach, reused verbatim).
 *
 * The opponent is scoped by `clubs.organization_id`, never one historical
 * club identity (Stage 0 §0.5): a coach's meetings against Footscray and
 * against Western Bulldogs are the same organisation's record, exactly the
 * lineage convention {@link getClubLineage} and the club-comparison
 * queries already use.
 *
 * Returns null only for an unrecognised coach id or organisation id. A
 * recognised coach who has never coached against a recognised organisation
 * -- or an organisation with zero canonical meetings -- returns a real
 * record with zero totals and empty lists, the same deliberate no-record
 * convention {@link getCoachCareer} uses for a zero-game coach.
 */
export async function getCoachRecordAgainstOrganization(
  coachId: number,
  organizationId: number,
): Promise<CoachOrganizationRecord | null> {
  const [coach] = await sql<{ id: number }[]>`
    SELECT id FROM coaches WHERE id = ${coachId}
  `;
  if (!coach) return null;

  const [organization] = await sql<CoachOpponentOrganization[]>`
    SELECT id, name, slug FROM club_organizations WHERE id = ${organizationId}
  `;
  if (!organization) return null;

  // Games/W/D/L/finals/Grand Finals against the organisation, all
  // assignments (not just decided ones) -- an aggregate with no GROUP BY
  // always returns exactly one row, zeros included, so no fallback default
  // is needed for a zero-meeting pair.
  const [totalsRow] = await sql<Omit<CoachOrganizationTotals, 'winPct'>[]>`
    SELECT count(*)::int AS games,
           count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
           count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
           count(*) FILTER (WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id)::int AS losses,
           count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
           count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals"
      FROM match_coaches mc
      JOIN matches m ON m.id = mc.match_id
      JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
     WHERE mc.coach_id = ${coach.id}
       AND oc.organization_id = ${organization.id}
  `;

  const decided = await getDecidedMatchesAgainstOrganization(coach.id, organization.id);

  // Venue breakdown for matches against the organisation only, one venue
  // per row via array_agg (same approach as getCoachCareer's Stage 1B
  // venue query) rather than a per-venue round trip.
  const venueRows = await sql<Omit<CoachVenueRecord, 'winPct'>[]>`
    WITH assignments AS (
      SELECT mc.club_id AS coached_club_id, m.id AS match_id, m.match_date,
             m.is_finals_series, m.round_type, m.winner_club_id,
             v.id AS venue_id, v.canonical_name AS venue_name, v.slug AS venue_slug
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN clubs oc ON oc.id = (CASE WHEN mc.club_id = m.home_club_id THEN m.away_club_id ELSE m.home_club_id END)
        JOIN venues v ON v.id = m.venue_id
       WHERE mc.coach_id = ${coach.id}
         AND oc.organization_id = ${organization.id}
    )
    SELECT venue_id AS "venueId", venue_name AS "venueName", venue_slug AS "venueSlug",
           count(*)::int AS games,
           count(*) FILTER (WHERE winner_club_id = coached_club_id)::int AS wins,
           count(*) FILTER (WHERE winner_club_id IS NULL)::int AS draws,
           count(*) FILTER (WHERE winner_club_id IS NOT NULL AND winner_club_id <> coached_club_id)::int AS losses,
           count(*) FILTER (WHERE is_finals_series)::int AS finals,
           count(*) FILTER (WHERE round_type = 'grand_final')::int AS "grandFinals",
           (array_agg(match_id ORDER BY match_date ASC, match_id ASC))[1] AS "firstMatchId",
           (array_agg(match_date ORDER BY match_date ASC, match_id ASC))[1] AS "firstMatchDate",
           (array_agg(match_id ORDER BY match_date DESC, match_id DESC))[1] AS "lastMatchId",
           (array_agg(match_date ORDER BY match_date DESC, match_id DESC))[1] AS "lastMatchDate"
      FROM assignments
     GROUP BY venue_id, venue_name, venue_slug
     ORDER BY count(*) DESC, venue_name ASC, venue_id ASC
  `;
  const venues = venueRows.map((r) => ({ ...r, winPct: winPct(r.wins, r.draws, r.games) }));

  return {
    coachId: coach.id,
    organization,
    totals: { ...totalsRow, winPct: winPct(totalsRow.wins, totalsRow.draws, totalsRow.games) },
    biggestWin: selectCareerRecordMatch(decided, 'win'),
    biggestLoss: selectCareerRecordMatch(decided, 'loss'),
    venues,
  };
}

export type CoachIdentity = {
  id: number;
  displayName: string;
  dob: Date | null;
  /** Non-null only for a 'unique' link (coaches_link_ck, migration 087). */
  playerId: number | null;
  playerSlug: string | null;
};

/**
 * A coach's stable public identity, for the `/coaches/[slug]-id` route
 * (AFLDB-ISSUE-118 §W.4): just enough to render the coach profile and, for
 * a coach who also played, to link out to their playing career
 * (AFLDB-ISSUE-170 Stage 1E -- `playerId`/`playerSlug` used to drive a
 * permanent redirect to the player page, which is gone). Never the coaching
 * aggregation itself -- that stays {@link getCoachCareer}'s job. An unknown
 * id returns null, never a fabricated identity.
 */
export async function getCoach(id: number): Promise<CoachIdentity | null> {
  const [row] = await sql<CoachIdentity[]>`
    SELECT c.id, c.display_name AS "displayName", c.dob,
           c.player_id AS "playerId", p.slug AS "playerSlug"
      FROM coaches c
      LEFT JOIN players p ON p.id = c.player_id
     WHERE c.id = ${id}
  `;
  return row ?? null;
}

export type CoachRecordRow = {
  rank: number;
  coachId: number;
  displayName: string;
  coachOnly: boolean;
  playerId: number | null;
  playerSlug: string | null;
  firstSeason: number | null;
  lastSeason: number | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  finals: number;
  grandFinals: number;
  premierships: number;
  /** From `round(...)::numeric`, so postgres.js returns this as a string, never a number. */
  winPct: string | null;
};

/**
 * Most games coached, for the Coach Records board (AFLDB-ISSUE-139 UI
 * handoff). Draws use `m.id IS NOT NULL AND m.winner_club_id IS NULL`
 * rather than `m.winner_club_id IS NULL` alone: on the LEFT JOIN through
 * match_coaches, a coach with zero games has both `mc` and `m` null, and
 * `m.winner_club_id IS NULL` alone would count that absence as a draw.
 */
export async function getCoachRecordsByGames(limit = 50): Promise<CoachRecordRow[]> {
  return sql<CoachRecordRow[]>`
    SELECT dense_rank() OVER (ORDER BY count(mc.match_id) DESC)::int AS rank,
           c.id AS "coachId", c.display_name AS "displayName",
           (c.player_id IS NULL) AS "coachOnly",
           c.player_id AS "playerId", p.slug AS "playerSlug",
           min(m.season)::int AS "firstSeason", max(m.season)::int AS "lastSeason",
           count(mc.match_id)::int AS games,
           count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
           count(*) FILTER (WHERE m.id IS NOT NULL AND m.winner_club_id IS NULL)::int AS draws,
           count(*) FILTER (
             WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id
           )::int AS losses,
           count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
           count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals",
           count(*) FILTER (
             WHERE m.round_type = 'grand_final' AND m.winner_club_id = mc.club_id
           )::int AS premierships,
           CASE WHEN count(mc.match_id) > 0
                THEN round((
                  (count(*) FILTER (WHERE m.winner_club_id = mc.club_id)
                    + count(*) FILTER (WHERE m.id IS NOT NULL AND m.winner_club_id IS NULL) * 0.5
                  ) * 100.0 / count(mc.match_id)
                )::numeric, 2)
           END AS "winPct"
      FROM coaches c
      LEFT JOIN players p ON p.id = c.player_id
      LEFT JOIN match_coaches mc ON mc.coach_id = c.id
      LEFT JOIN matches m ON m.id = mc.match_id
     GROUP BY c.id, c.display_name, c.player_id, p.slug
     ORDER BY count(mc.match_id) DESC, c.display_name
     LIMIT ${limit}
  `;
}

/**
 * Best coaching win percentage, qualified at a minimum of 50 games
 * coached. AFLDB has no existing percentage-based record convention to
 * follow (nl-search's average-ranking support is deliberately deferred
 * for the same reason, docs/search.md), so 50 is chosen here and stated
 * on the page rather than left implicit.
 */
export async function getCoachRecordsByWinPct(minGames = 50, limit = 50): Promise<CoachRecordRow[]> {
  return sql<CoachRecordRow[]>`
    WITH totals AS (
      SELECT c.id AS "coachId", c.display_name AS "displayName",
             (c.player_id IS NULL) AS "coachOnly",
             c.player_id AS "playerId", p.slug AS "playerSlug",
             min(m.season)::int AS "firstSeason", max(m.season)::int AS "lastSeason",
             count(mc.match_id)::int AS games,
             count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
             count(*) FILTER (WHERE m.id IS NOT NULL AND m.winner_club_id IS NULL)::int AS draws,
             count(*) FILTER (
               WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id
             )::int AS losses,
             count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
             count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals",
             count(*) FILTER (
               WHERE m.round_type = 'grand_final' AND m.winner_club_id = mc.club_id
             )::int AS premierships
        FROM coaches c
        LEFT JOIN players p ON p.id = c.player_id
        LEFT JOIN match_coaches mc ON mc.coach_id = c.id
        LEFT JOIN matches m ON m.id = mc.match_id
       GROUP BY c.id, c.display_name, c.player_id, p.slug
    )
    SELECT dense_rank() OVER (
             ORDER BY ((wins + draws * 0.5) * 100.0 / games) DESC
           )::int AS rank,
           "coachId", "displayName", "coachOnly", "playerId", "playerSlug",
           "firstSeason", "lastSeason", games, wins, draws, losses, finals, "grandFinals", premierships,
           round(((wins + draws * 0.5) * 100.0 / games)::numeric, 2) AS "winPct"
      FROM totals
     WHERE games >= ${minGames}
     ORDER BY ((wins + draws * 0.5) * 100.0 / games) DESC, "displayName"
     LIMIT ${limit}
  `;
}

export type ClubCoachRecordRow = {
  coachId: number;
  displayName: string;
  /** True when no player links to this coach (coaches_link_ck, migration 087). */
  coachOnly: boolean;
  playerId: number | null;
  playerSlug: string | null;
  firstSeason: number;
  lastSeason: number;
  /** Distinct seasons in charge of this club, tenure gaps not counted. */
  seasons: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /**
   * The site's draw-weighted coaching win rate, `(W + D/2) / G * 100`,
   * matching /records/coaches, {@link getCoachCareer} and the club page's
   * own club win rate -- not a plain `W / G`. `round(...)::numeric`, so
   * postgres.js returns it as a string.
   */
  winPct: string;
};

/**
 * Every coach who has coached one club, with that coach's record for THAT
 * club only (AFLDB-ISSUE-148) -- club-specific, never whole-career
 * totals. Counted from the canonical per-match coaching assignment
 * (`match_coaches` + `matches`), the same source {@link getCoachCareer}
 * uses, so `source_games_coached` (evidence only, migration 087) is never
 * read.
 *
 * One row per coach: a coach with more than one separate period in charge
 * of the club (Tony Jewell coached Richmond 1979-81 and again 1986-87)
 * has those periods aggregated into a single record, and
 * `games = wins + draws + losses` always holds.
 *
 * Club scope follows the rest of the club page -- every identity in the
 * club's lineage (`organization_id`, exactly {@link getClubLineage} /
 * {@link getClubTotals}), so a coach of "Footscray" is counted on the
 * Western Bulldogs page too. A merger is a different organisation and
 * never reaches this set, the same way nothing of Fitzroy's is counted
 * towards Brisbane Lions.
 *
 * Ordered most-recently-in-charge first. A club with no `match_coaches`
 * rows returns `[]`.
 */
export async function getClubCoachRecords(clubId: number): Promise<ClubCoachRecordRow[]> {
  return sql<ClubCoachRecordRow[]>`
    SELECT c.id AS "coachId", c.display_name AS "displayName",
           (c.player_id IS NULL) AS "coachOnly",
           c.player_id AS "playerId", p.slug AS "playerSlug",
           min(m.season)::int AS "firstSeason",
           max(m.season)::int AS "lastSeason",
           count(DISTINCT m.season)::int AS seasons,
           count(*)::int AS games,
           count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
           count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
           count(*) FILTER (
             WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id
           )::int AS losses,
           round((
             (count(*) FILTER (WHERE m.winner_club_id = mc.club_id)
               + count(*) FILTER (WHERE m.winner_club_id IS NULL) * 0.5)
             * 100.0 / count(*)
           )::numeric, 2) AS "winPct"
      FROM match_coaches mc
      JOIN matches m ON m.id = mc.match_id
      JOIN coaches c ON c.id = mc.coach_id
      LEFT JOIN players p ON p.id = c.player_id
     WHERE mc.club_id IN (
       SELECT id FROM clubs
        WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
     )
     GROUP BY c.id, c.display_name, c.player_id, p.slug
     ORDER BY max(m.season) DESC, min(m.season) DESC, c.display_name
  `;
}

export type CoachIndexRow = {
  id: number;
  displayName: string;
  firstSeason: number | null;
  lastSeason: number | null;
  games: number;
  playerId: number | null;
  playerSlug: string | null;
};

/**
 * Every coach, for the `/coaches` discovery index (AFLDB-ISSUE-118 §W.4).
 * Includes coaches who also played: since AFLDB-ISSUE-170 Stage 1E every row
 * here resolves to that coach's own `/coaches/[slug]-id` page, player-linked
 * or not. `playerId`/`playerSlug` are retained because callers still need to
 * know that a playing career exists, not to redirect to it.
 */
export async function listCoaches(): Promise<CoachIndexRow[]> {
  return sql<CoachIndexRow[]>`
    SELECT c.id, c.display_name AS "displayName",
           min(m.season)::int AS "firstSeason", max(m.season)::int AS "lastSeason",
           count(mc.match_id)::int AS games,
           c.player_id AS "playerId", p.slug AS "playerSlug"
      FROM coaches c
      LEFT JOIN players p ON p.id = c.player_id
      LEFT JOIN match_coaches mc ON mc.coach_id = c.id
      LEFT JOIN matches m ON m.id = mc.match_id
     GROUP BY c.id, c.display_name, c.player_id, p.slug
     ORDER BY c.surname, c.given_name, c.display_name
  `;
}

// --- Stage 2C: direct coach-v-coach head-to-head ---

export type CoachHeadToHeadTotals = {
  meetings: number;
  aWins: number;
  bWins: number;
  draws: number;
  aWinPct: number | null;
  bWinPct: number | null;
  finals: number;
  grandFinals: number;
};

/**
 * One venue where two coaches met directly (AFLDB-ISSUE-170 Stage 2C). Kept
 * as its own type rather than reusing {@link CoachVenueRecord}: that type's
 * wins/losses are single-coach oriented and would misrepresent an A/B
 * head-to-head, where "a win" and "a loss" both need a named side.
 */
export type CoachHeadToHeadVenueRecord = {
  venueId: number;
  venueName: string;
  venueSlug: string;
  meetings: number;
  aWins: number;
  bWins: number;
  draws: number;
  aWinPct: number | null;
  bWinPct: number | null;
  finals: number;
  grandFinals: number;
  firstMeetingDate: Date;
  lastMeetingDate: Date;
};

/**
 * Seasons in which two coaches were both canonically active
 * (AFLDB-ISSUE-170 Stage 2D), independent of whether they ever directly
 * opposed each other -- {@link CoachHeadToHead.totals} answers a different
 * question. `seasons === 0` is the deliberate no-overlap state; `firstSeason`
 * and `lastSeason` are null only then, never a fabricated span.
 */
export type CoachOverlap = {
  firstSeason: number | null;
  lastSeason: number | null;
  seasons: number;
};

export type CoachHeadToHead = {
  coachAId: number;
  coachBId: number;
  totals: CoachHeadToHeadTotals;
  /** This coach's biggest-margin direct win over the other, or null with no qualifying (decided) direct meeting. */
  biggestWinA: CoachCareerMatch | null;
  biggestWinB: CoachCareerMatch | null;
  /**
   * Every venue with at least one direct meeting, ordered `meetings DESC,
   * venue name ASC, venue id ASC` -- the same tie-break {@link CoachVenueRecord}
   * uses for a single coach's venue history.
   */
  venues: CoachHeadToHeadVenueRecord[];
  /**
   * Seasons in which both coaches held at least one canonical coaching
   * assignment (AFLDB-ISSUE-170 Stage 2D). Derived from each coach's actual
   * season presence in `match_coaches`/`matches`, never by intersecting
   * career first/last-season endpoints -- a coach with a mid-career gap
   * must not be credited with an overlapping season they were not actually
   * active in.
   */
  overlap: CoachOverlap;
  /**
   * The earliest/most recent direct meeting between the two coaches
   * (AFLDB-ISSUE-170 Stage 2D), oriented to coach A's perspective -- the
   * same fixed orientation {@link biggestWinA} already uses. Unlike
   * {@link biggestWinA}/{@link biggestWinB}, a drawn meeting counts here (a
   * draw is still a meeting). `null` only for a real, distinct pair with
   * zero direct meetings (`totals.meetings === 0`), never a fabricated date.
   */
  firstMeeting: CoachCareerMatch | null;
  lastMeeting: CoachCareerMatch | null;
};

type CoachHeadToHeadMeetingRaw = {
  matchId: number;
  season: number;
  matchDate: Date;
  roundType: string;
  isFinalsSeries: boolean;
  aClubId: number;
  aClubName: string;
  aClubSlug: string;
  bClubId: number;
  bClubName: string;
  bClubSlug: string;
  homeClubId: number;
  homeScore: number;
  awayScore: number;
  venueId: number | null;
  venueName: string | null;
  venueSlug: string | null;
};

/**
 * THE direct-meeting population fragment (AFLDB-ISSUE-170 Stage 2C, Stage 0
 * §0.8): matches where `coachAId` and `coachBId` each have a `match_coaches`
 * assignment, to two DIFFERENT clubs, in the SAME match. `match_coaches` has
 * at most one row per (match, club) and Stage 0 §0.8 found zero matches with
 * more than two coach assignments, so joining one coach's assignment to the
 * other's on the same `match_id` with `club_id <>` is exactly "opposing
 * clubs, same match" -- never a same-club pairing, and never inferred from
 * career-span overlap. A match where only one (or neither) of these two
 * coaches is assigned simply has no row in this join, and a match where
 * they are somehow assigned to the SAME club (never observed, Stage 0 §0.8)
 * is excluded by `club_id <>` regardless.
 *
 * Every query below builds its `meetings` CTE from this and nothing else,
 * so totals, biggest wins and venue history can never disagree about which
 * matches count as a direct meeting.
 */
function coachHeadToHeadScope(coachAId: number, coachBId: number) {
  return sql`
    SELECT mcA.match_id, m.season, m.match_date, m.round_type::text AS round_type,
           m.is_finals_series, m.winner_club_id, m.home_club_id, m.home_score, m.away_score,
           m.venue_id, mcA.club_id AS a_club_id, mcB.club_id AS b_club_id
      FROM match_coaches mcA
      JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
      JOIN matches m ON m.id = mcA.match_id
     WHERE mcA.coach_id = ${coachAId} AND mcB.coach_id = ${coachBId}
  `;
}

/** One direct meeting, oriented to one side's perspective, in {@link CoachCareerMatch} shape. */
function toDirectMeetingMatch(row: CoachHeadToHeadMeetingRaw, perspective: 'a' | 'b'): CoachCareerMatch {
  const coachedClubId = perspective === 'a' ? row.aClubId : row.bClubId;
  const coachedClubName = perspective === 'a' ? row.aClubName : row.bClubName;
  const coachedClubSlug = perspective === 'a' ? row.aClubSlug : row.bClubSlug;
  const opponentClubId = perspective === 'a' ? row.bClubId : row.aClubId;
  const opponentClubName = perspective === 'a' ? row.bClubName : row.aClubName;
  const opponentClubSlug = perspective === 'a' ? row.bClubSlug : row.aClubSlug;
  return {
    matchId: row.matchId,
    season: row.season,
    matchDate: row.matchDate,
    roundType: row.roundType,
    isFinalsSeries: row.isFinalsSeries,
    coachedClubId,
    coachedClubName,
    coachedClubSlug,
    opponentClubId,
    opponentClubName,
    opponentClubSlug,
    margin: coachPerspectiveMargin({
      coachedClubId, homeClubId: row.homeClubId, homeScore: row.homeScore, awayScore: row.awayScore,
    }),
    venueId: row.venueId,
    venueName: row.venueName,
    venueSlug: row.venueSlug,
  };
}

/**
 * The earliest/most recent meeting in a direct-meeting population
 * (AFLDB-ISSUE-170 Stage 2D): earliest-or-latest match date first, then
 * lowest-or-highest match id as the deterministic tie-break -- the same
 * two-key shape {@link selectCareerRecordMatch} uses for margin, just
 * ordered by date instead. Unlike {@link selectCareerRecordMatch}, a drawn
 * meeting is a valid candidate here (a draw is still a meeting).
 */
export function selectDirectMeeting(
  matches: CoachCareerMatch[],
  which: 'first' | 'last',
): CoachCareerMatch | null {
  return matches.reduce<CoachCareerMatch | null>((best, m) => {
    if (!best) return m;
    const mTime = m.matchDate.getTime();
    const bestTime = best.matchDate.getTime();
    if (mTime !== bestTime) {
      return (which === 'first' ? mTime < bestTime : mTime > bestTime) ? m : best;
    }
    return (which === 'first' ? m.matchId < best.matchId : m.matchId > best.matchId) ? m : best;
  }, null);
}

/**
 * Two coaches' direct record against EACH OTHER (AFLDB-ISSUE-170 Stage 2C):
 * meetings, wins/draws/win% oriented to the requested A/B order, finals and
 * Grand Final meeting counts, each side's biggest direct win (reusing
 * {@link selectCareerRecordMatch}'s tie rule verbatim -- greatest margin,
 * then earliest date, then lowest match id), and venue history scoped to
 * these two coaches' meetings only. Also carries Stage 2D's comparison
 * context: {@link CoachOverlap} and the pair's first/most recent direct
 * meeting -- kept on this same result rather than a second query family,
 * since the direct-meeting population is already assembled here.
 *
 * Orientation is never canonicalised: `coachAId`/`coachBId` are passed
 * straight into {@link coachHeadToHeadScope} in the order given, so calling
 * this with the two ids swapped swaps every A/B value in the result -- it
 * does not change which pair is being described, exactly the convention
 * `swapCoachComparePath` already applies to the comparison URL.
 *
 * A recognised, distinct pair that never met returns a real object with
 * `totals.meetings = 0` (an aggregate with no GROUP BY always returns
 * exactly one row, zeros included), `venues: []` and `firstMeeting`/
 * `lastMeeting` both null -- never null itself. Null is reserved for an
 * unrecognised coach id on either side, the same zero-vs-null convention
 * {@link getCoachRecordAgainstOrganization} already uses.
 */
export async function getCoachHeadToHead(coachAId: number, coachBId: number): Promise<CoachHeadToHead | null> {
  const [coachA] = await sql<{ id: number }[]>`SELECT id FROM coaches WHERE id = ${coachAId}`;
  if (!coachA) return null;
  const [coachB] = await sql<{ id: number }[]>`SELECT id FROM coaches WHERE id = ${coachBId}`;
  if (!coachB) return null;

  const [[totalsRow], meetingsRaw, venueRows, [overlap]] = await Promise.all([
    sql<Omit<CoachHeadToHeadTotals, 'aWinPct' | 'bWinPct'>[]>`
      WITH meetings AS (${coachHeadToHeadScope(coachA.id, coachB.id)})
      SELECT count(*)::int AS meetings,
             count(*) FILTER (WHERE winner_club_id = a_club_id)::int AS "aWins",
             count(*) FILTER (WHERE winner_club_id = b_club_id)::int AS "bWins",
             count(*) FILTER (WHERE winner_club_id IS NULL)::int AS draws,
             count(*) FILTER (WHERE is_finals_series)::int AS finals,
             count(*) FILTER (WHERE round_type = 'grand_final')::int AS "grandFinals"
        FROM meetings
    `,
    // Every direct meeting, decided or drawn (AFLDB-ISSUE-170 Stage 2D):
    // {@link selectCareerRecordMatch}'s own margin-sign filter already
    // excludes a drawn (margin = 0) meeting from biggestWinA/B, so widening
    // this from "decided only" to "every meeting" changes nothing about
    // those two results and lets firstMeeting/lastMeeting share the same
    // query rather than a second round trip.
    sql<CoachHeadToHeadMeetingRaw[]>`
      WITH meetings AS (${coachHeadToHeadScope(coachA.id, coachB.id)})
      SELECT mt.match_id AS "matchId", mt.season, mt.match_date AS "matchDate",
             mt.round_type AS "roundType", mt.is_finals_series AS "isFinalsSeries",
             ac.id AS "aClubId", ac.name AS "aClubName", ac.slug AS "aClubSlug",
             bc.id AS "bClubId", bc.name AS "bClubName", bc.slug AS "bClubSlug",
             mt.home_club_id AS "homeClubId", mt.home_score AS "homeScore", mt.away_score AS "awayScore",
             v.id AS "venueId", v.canonical_name AS "venueName", v.slug AS "venueSlug"
        FROM meetings mt
        JOIN clubs ac ON ac.id = mt.a_club_id
        JOIN clubs bc ON bc.id = mt.b_club_id
        LEFT JOIN venues v ON v.id = mt.venue_id
    `,
    sql<Omit<CoachHeadToHeadVenueRecord, 'aWinPct' | 'bWinPct'>[]>`
      WITH meetings AS (${coachHeadToHeadScope(coachA.id, coachB.id)})
      SELECT v.id AS "venueId", v.canonical_name AS "venueName", v.slug AS "venueSlug",
             count(*)::int AS meetings,
             count(*) FILTER (WHERE mt.winner_club_id = mt.a_club_id)::int AS "aWins",
             count(*) FILTER (WHERE mt.winner_club_id = mt.b_club_id)::int AS "bWins",
             count(*) FILTER (WHERE mt.winner_club_id IS NULL)::int AS draws,
             count(*) FILTER (WHERE mt.is_finals_series)::int AS finals,
             count(*) FILTER (WHERE mt.round_type = 'grand_final')::int AS "grandFinals",
             min(mt.match_date) AS "firstMeetingDate",
             max(mt.match_date) AS "lastMeetingDate"
        FROM meetings mt
        JOIN venues v ON v.id = mt.venue_id
       GROUP BY v.id, v.canonical_name, v.slug
       ORDER BY count(*) DESC, v.canonical_name ASC, v.id ASC
    `,
    // A small, dedicated query (AFLDB-ISSUE-170 Stage 2D) rather than an
    // extension of coachHeadToHeadScope: overlap is about each coach's own
    // season presence, not about the two of them ever meeting, so it is a
    // genuinely different population. Built from `DISTINCT season` per
    // coach, then intersected -- never `least(maxA, maxB) >= greatest(minA,
    // minB)`, which would credit a mid-career gap year as "overlapping". An
    // aggregate with no GROUP BY over a zero-row join still returns exactly
    // one row (min/max NULL, count 0), so a non-overlapping pair gets the
    // deliberate no-overlap state, never a missing row.
    sql<CoachOverlap[]>`
      WITH seasons_a AS (
        SELECT DISTINCT m.season
          FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
         WHERE mc.coach_id = ${coachA.id}
      ), seasons_b AS (
        SELECT DISTINCT m.season
          FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
         WHERE mc.coach_id = ${coachB.id}
      )
      SELECT min(a.season)::int AS "firstSeason", max(a.season)::int AS "lastSeason", count(*)::int AS seasons
        FROM seasons_a a JOIN seasons_b b ON a.season = b.season
    `,
  ]);

  const matchesFromA = meetingsRaw.map((r) => toDirectMeetingMatch(r, 'a'));
  const matchesFromB = meetingsRaw.map((r) => toDirectMeetingMatch(r, 'b'));

  return {
    coachAId: coachA.id,
    coachBId: coachB.id,
    totals: {
      ...totalsRow,
      aWinPct: winPct(totalsRow.aWins, totalsRow.draws, totalsRow.meetings),
      bWinPct: winPct(totalsRow.bWins, totalsRow.draws, totalsRow.meetings),
    },
    biggestWinA: selectCareerRecordMatch(matchesFromA, 'win'),
    biggestWinB: selectCareerRecordMatch(matchesFromB, 'win'),
    venues: venueRows.map((v) => ({
      ...v,
      aWinPct: winPct(v.aWins, v.draws, v.meetings),
      bWinPct: winPct(v.bWins, v.draws, v.meetings),
    })),
    overlap,
    firstMeeting: selectDirectMeeting(matchesFromA, 'first'),
    lastMeeting: selectDirectMeeting(matchesFromA, 'last'),
  };
}
