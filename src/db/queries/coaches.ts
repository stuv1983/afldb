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

export type CoachCareer = {
  coachId: number;
  clubs: CoachingClubStint[];
  totals: Omit<CoachingClubStint, 'clubId' | 'clubName' | 'clubSlug' | 'firstSeason' | 'lastSeason'>;
};

function winPct(wins: number, draws: number, games: number): number | null {
  return games > 0 ? ((wins + draws * 0.5) / games) * 100 : null;
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

  return {
    coachId: coach.id,
    clubs,
    totals: { ...totals, winPct: winPct(totals.wins, totals.draws, totals.games) },
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
 * (AFLDB-ISSUE-118 §W.4): just enough to render a coach-only profile or
 * redirect a linked coach to their player page, never the coaching
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
 * Includes coaches who also played -- their row still needs to be findable
 * from the index, it just resolves to their player profile rather than a
 * coach-only one, same rule the linked-coach redirect on the profile route
 * applies.
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
