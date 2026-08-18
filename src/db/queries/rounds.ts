import 'server-only';

import { sql } from '@/db/client';

/**
 * Round-grain views derived live from `matches` and `brownlow_round_votes`.
 *
 * `club_seasons` (the season page's final ladder) is loaded from an
 * external end-of-season ladder and has no round grain — see the
 * `club_seasons` REBUILDS block in tools/migration/rebuild_derived.py.
 * There is no equivalent published source for "the ladder after round N",
 * so it is computed here from `matches` instead, one query per season
 * covering every round at once rather than one query per round.
 */

export type RoundLadderRow = {
  roundNumber: number;
  clubId: number;
  clubName: string;
  clubSlug: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  percentage: string | null;
  premiershipPoints: number;
  ladderRank: number;
};

/**
 * Cumulative ladder standings after every home-and-away round of a
 * season, one row per (round, club).
 *
 * Each club's totals are summed from every one of its own rows with
 * `round_number <= target round` (a join on `<=`, not a running window
 * function) so that a bye correctly carries a club's standing forward
 * instead of silently missing a round. Ranked by premiership points then
 * percentage — AFLDB has no per-round countback source, so ties beyond
 * that are ordered by percentage alone, which will occasionally differ
 * from an official published round-by-round ladder.
 */
export async function getSeasonRoundLadder(year: number): Promise<RoundLadderRow[]> {
  return sql<RoundLadderRow[]>`
    WITH per_round AS (
      SELECT m.round_number, m.home_club_id AS club_id,
             (m.result = 'home_win')::int AS win,
             (m.result = 'draw')::int     AS draw,
             (m.result = 'away_win')::int AS loss,
             CASE WHEN m.result = 'home_win' THEN 4
                  WHEN m.result = 'draw'     THEN 2
                  ELSE 0 END AS pts,
             m.home_score AS pf, m.away_score AS pa
        FROM matches m
       WHERE m.season = ${year} AND m.round_type = 'home_and_away'
      UNION ALL
      SELECT m.round_number, m.away_club_id,
             (m.result = 'away_win')::int,
             (m.result = 'draw')::int,
             (m.result = 'home_win')::int,
             CASE WHEN m.result = 'away_win' THEN 4
                  WHEN m.result = 'draw'     THEN 2
                  ELSE 0 END,
             m.away_score, m.home_score
        FROM matches m
       WHERE m.season = ${year} AND m.round_type = 'home_and_away'
    ),
    rounds AS (SELECT DISTINCT round_number FROM per_round),
    clubs_in_season AS (SELECT DISTINCT club_id FROM per_round),
    grid AS (
      SELECT r.round_number, cs.club_id FROM rounds r CROSS JOIN clubs_in_season cs
    ),
    cumulative AS (
      SELECT g.round_number, g.club_id,
             COALESCE(sum(pr.win), 0)::int  AS wins,
             COALESCE(sum(pr.draw), 0)::int AS draws,
             COALESCE(sum(pr.loss), 0)::int AS losses,
             COALESCE(sum(pr.pts), 0)::int  AS premiership_points,
             COALESCE(sum(pr.pf), 0)::int   AS points_for,
             COALESCE(sum(pr.pa), 0)::int   AS points_against,
             COALESCE(count(pr.round_number), 0)::int AS played
        FROM grid g
        LEFT JOIN per_round pr
          ON pr.club_id = g.club_id AND pr.round_number <= g.round_number
       GROUP BY g.round_number, g.club_id
    )
    SELECT c.round_number AS "roundNumber", c.club_id AS "clubId",
           cl.name AS "clubName", cl.slug AS "clubSlug",
           c.played, c.wins, c.draws, c.losses,
           c.points_for AS "pointsFor", c.points_against AS "pointsAgainst",
           CASE WHEN c.points_against = 0 THEN NULL
                ELSE round(c.points_for::numeric / c.points_against * 100, 1)
           END AS percentage,
           c.premiership_points AS "premiershipPoints",
           RANK() OVER (
             PARTITION BY c.round_number
             ORDER BY c.premiership_points DESC,
                      CASE WHEN c.points_against = 0 THEN 0
                           ELSE c.points_for::numeric / c.points_against END DESC
           )::int AS "ladderRank"
      FROM cumulative c
      JOIN clubs cl ON cl.id = c.club_id
     ORDER BY c.round_number, "ladderRank"
  `;
}

export type RoundVoteRow = {
  roundNumber: number;
  id: number;
  slug: string;
  displayName: string;
  votes: number;
  clubName: string | null;
  clubSlug: string | null;
};

/**
 * Brownlow vote-getters for every round of a season, one row per
 * (round, player) who polled at least one vote. Round-grain coverage is
 * 1984-2025 only — earlier seasons return no rows, not zeroes.
 *
 * `brownlow_round_votes` has no club column, so the club is resolved via
 * the player's `player_match_stats` row for a match in that season/round.
 * A player with no matching row (a coverage gap between the two
 * independently sourced tables) renders with a null club — this is a data
 * gap, not a player-identity ambiguity, since `brownlow_round_votes.player_id`
 * is a hard foreign key with no name-matching involved.
 */
export async function getSeasonRoundVotes(year: number): Promise<RoundVoteRow[]> {
  return sql<RoundVoteRow[]>`
    SELECT rv.round_number AS "roundNumber",
           p.id, p.slug, p.display_name AS "displayName",
           rv.votes,
           cl.name AS "clubName", cl.slug AS "clubSlug"
      FROM brownlow_round_votes rv
      JOIN players p ON p.id = rv.player_id
      LEFT JOIN LATERAL (
        SELECT pms.club_id
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
         WHERE pms.player_id = rv.player_id
           AND m.season = rv.season AND m.round_number = rv.round_number
         LIMIT 1
      ) pc ON true
      LEFT JOIN clubs cl ON cl.id = pc.club_id
     WHERE rv.season = ${year} AND rv.votes > 0
     ORDER BY rv.round_number, rv.votes DESC, p.sort_name
  `;
}
