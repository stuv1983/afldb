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

export type PlayerCoachingClubStint = {
  clubId: number;
  clubName: string;
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

export type PlayerCoachingCareer = {
  coachId: number;
  clubs: PlayerCoachingClubStint[];
  totals: Omit<PlayerCoachingClubStint, 'clubId' | 'clubName' | 'firstSeason' | 'lastSeason'>;
};

function winPct(wins: number, draws: number, games: number): number | null {
  return games > 0 ? ((wins + draws * 0.5) / games) * 100 : null;
}

/**
 * A linked coach's career, derived from `coaches` + `match_coaches` +
 * `matches` (AFLDB-ISSUE-118 §23.28) rather than the AFL Tables coach
 * index's own stored totals: those are evidence only (`source_games_coached`,
 * never a total -- see migration 087), so games/W-D-L/finals/premierships
 * are always counted from the canonical per-match assignment.
 *
 * Only a 'unique' player link counts as coaching this player, matching the
 * `premiership_coach` Grid Solver builder. No linked coach row returns
 * null, never a fabricated empty career.
 */
export async function getPlayerCoachingCareer(playerId: number): Promise<PlayerCoachingCareer | null> {
  const [coach] = await sql<{ id: number }[]>`
    SELECT id FROM coaches WHERE player_id = ${playerId} AND link_status_value = 'unique'
  `;
  if (!coach) return null;

  const rows = await sql<Omit<PlayerCoachingClubStint, 'winPct'>[]>`
    SELECT cl.id AS "clubId", cl.name AS "clubName",
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
     GROUP BY cl.id, cl.name
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
