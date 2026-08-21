import 'server-only';

import { sql } from '@/db/client';
import {
  GRID_BUILDERS,
  GRID_LIMITS,
  GRID_STATS,
  isGridStatKey,
  type GridAxisState,
  type GridOrder,
  type GridStatKey,
} from '@/search/grid-solver-spec';

/**
 * Compile a grid axis to parameterised SQL and solve a cell.
 *
 * Every builder in GRID_BUILDERS is a fixed, named SQL shape -- there is
 * no request-selected column or operator here at all, unlike
 * query-builder.ts, so most of this file needs no allowlist check beyond
 * "is this a known builder key". The one place a request value reaches an
 * identifier position is the `stat`/`statA`/`statB` family of params
 * (requireStatKeyAt), checked against GRID_STATS (isGridStatKey) before
 * sql.unsafe ever sees it -- the same discipline query-builder.ts applies
 * to its column picker.
 *
 * Runs through the same read-only `sql` client (afldb_app) as
 * query-builder.ts and every public page.
 */

type SqlFragment = ReturnType<typeof sql>;

function parseIntParam(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${label} must be a whole number.`);
  return n;
}

function parseDecimalParam(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
}

function requireParam(axis: GridAxisState, key: string, label: string): string {
  const value = axis.params[key];
  if (value === undefined || value.trim() === '') throw new Error(`${label} is required.`);
  return value.trim();
}

function requireInt(axis: GridAxisState, key: string, label: string): number {
  return parseIntParam(requireParam(axis, key, label), label);
}

function requireDecimal(axis: GridAxisState, key: string, label: string): number {
  return parseDecimalParam(requireParam(axis, key, label), label);
}

/**
 * The validated stat key at a given param key, checked against GRID_STATS
 * before it can ever reach sql.unsafe. Returned as a plain string, not a
 * fragment: each call site builds its own fully-qualified
 * `sql.unsafe('<alias>.<key>')` in one shot, the same way filters.ts's
 * rangeConditions does, rather than splicing an unsafe fragment next to
 * literal template text. Parameterised by key so the two-stat builders
 * (career_stat_exceeds, single_game_two_stats_min) can validate `statA`/
 * `statB` with the same check as every single-stat builder's `stat`.
 */
function requireStatKeyAt(axis: GridAxisState, key: string, label: string): GridStatKey {
  const value = requireParam(axis, key, label);
  if (!isGridStatKey(value)) throw new Error(`Unknown statistic: ${value}`);
  return value;
}

function requireStatKey(axis: GridAxisState): GridStatKey {
  return requireStatKeyAt(axis, 'stat', 'Statistic');
}

/** Ascending [lo, hi], regardless of which order the two params were entered in. */
function orderedRange(axis: GridAxisState, loKey: string, loLabel: string, hiKey: string, hiLabel: string): [number, number] {
  const a = requireInt(axis, loKey, loLabel);
  const b = requireInt(axis, hiKey, hiLabel);
  return a <= b ? [a, b] : [b, a];
}

/**
 * The player's career total for a stat, grain-aware: player_career_stats
 * precomputes a real total column for the 8 'always'/'era_limited' stats
 * (goals plus the original 7), so those read directly from `c`. The other
 * 13 'live_only' stats (migration 007 never precomputed them) fall back to
 * a correlated SUM over player_match_stats, scoped to this player by the
 * existing ix_pms_player index. Shared by every career-grain stat builder
 * (total, average, and the two-stat comparison) so each one gets the cheap
 * path automatically wherever it exists.
 */
function careerStatValueExpr(statKey: GridStatKey): SqlFragment {
  if (GRID_STATS[statKey].grain !== 'live_only') {
    return sql`${sql.unsafe(`c.${statKey}`)}`;
  }
  return sql`(SELECT sum(${sql.unsafe(statKey)}) FROM player_match_stats WHERE player_id = p.id)`;
}

function careerStatAtLeast(statKey: GridStatKey, n: number): SqlFragment {
  return sql`${careerStatValueExpr(statKey)} >= ${n}`;
}

/**
 * "X+ of a stat in one season" -- does the player's whole-season total (as
 * player_season_stats defines it: player_id+season grain, regardless of
 * club -- migration 015 split what used to be a club-grained table into
 * this player-season table plus a separate player_club_season_stats)
 * clear the threshold. Precomputed stats check the real column directly;
 * live_only stats fall back to grouping player_match_stats by player and
 * season only, matching that same whole-season (not per-club-stint) grain.
 */
function seasonStatAtLeast(statKey: GridStatKey, n: number): SqlFragment {
  if (GRID_STATS[statKey].grain !== 'live_only') {
    return sql`p.id IN (SELECT player_id FROM player_season_stats WHERE ${sql.unsafe(statKey)} >= ${n})`;
  }
  return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                        JOIN matches m ON m.id = pms.match_id
                       GROUP BY pms.player_id, m.season
                      HAVING sum(${sql.unsafe(statKey)}) >= ${n})`;
}

/**
 * (player_id, season, club_id) rows where that player was at least
 * equal-top of their own club's season total for a stat -- ties both
 * "led". Club-scoped by design ("led CLUB in a stat"), so this reads
 * player_club_season_stats (migration 015's club-grained table), not
 * player_season_stats (player-season grain, no club dimension at all).
 * Precomputed stats compare the real column directly; live_only stats
 * aggregate player_match_stats by player, season and club on both sides
 * of the comparison. Shared by club_season_stat_leader and its "X+ times"
 * sibling.
 */
function ledSeasonRows(statKey: GridStatKey): SqlFragment {
  const col = sql.unsafe(statKey);
  if (GRID_STATS[statKey].grain !== 'live_only') {
    return sql`SELECT pcs.player_id, pcs.season, pcs.club_id
                  FROM player_club_season_stats pcs
                 WHERE pcs.${col} IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM player_club_season_stats pcs2
                      WHERE pcs2.season = pcs.season AND pcs2.club_id = pcs.club_id
                        AND pcs2.${col} > pcs.${col})`;
  }
  return sql`SELECT t.player_id, t.season, t.club_id FROM (
                SELECT pms.player_id, m.season, pms.club_id, sum(pms.${col}) AS total
                  FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
                 GROUP BY pms.player_id, m.season, pms.club_id
              ) t
              WHERE NOT EXISTS (
                SELECT 1 FROM (
                  SELECT pms2.player_id, m2.season, pms2.club_id, sum(pms2.${col}) AS total
                    FROM player_match_stats pms2 JOIN matches m2 ON m2.id = pms2.match_id
                   GROUP BY pms2.player_id, m2.season, pms2.club_id
                ) t2
                WHERE t2.season = t.season AND t2.club_id = t.club_id AND t2.total > t.total)`;
}

// One dispatch per builder is the clearest shape here; splitting it up
// would scatter the catalogue across files for no real benefit.
//
// Exported for src/db/queries/nl/player-career.ts: the natural-language
// engine's career-grain compiler reuses this catalogue of 107 tuned,
// allowlist-safe predicates directly rather than duplicating any of
// them -- a career-predicate phrase in a parsed question ("played a
// grand final", "premierships >= 3") becomes exactly the GridAxisState
// this function already knows how to compile.
export function compileAxis(axis: GridAxisState): SqlFragment {
  const def = GRID_BUILDERS[axis.builder];
  if (!def) throw new Error(`Unknown builder: ${axis.builder}`);

  switch (axis.builder) {
    // -- Clubs & journeys ---------------------------------------------
    case 'played_for_club': {
      const orgId = requireInt(axis, 'club', 'Club');
      return sql`p.id IN (SELECT pc.player_id FROM player_clubs pc
                            WHERE pc.club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId}))`;
    }
    case 'debut_club': {
      const orgId = requireInt(axis, 'club', 'Club');
      return sql`p.id IN (SELECT player_id FROM player_match_stats
                            WHERE career_game_no = 1
                              AND club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId}))`;
    }
    case 'one_club_player':
      return sql`c.clubs_played = 1`;
    case 'multi_club_player':
      return sql`c.clubs_played > 1`;
    // "Club" in the per-club aggregate builders means the organization
    // (lineage), the same resolution played_for_club uses and the same
    // definition clubs_played precomputes. player_clubs is one row per
    // HISTORICAL identity, so summing per organization here is what stops
    // a rename (North Melbourne <-> Kangaroos, Footscray -> Western
    // Bulldogs) splitting one stint into two "clubs": counted per
    // identity, Brent Harvey and 26 other one-organization players
    // satisfied "X+ games at 2+ clubs", and 12 genuine 250-games-at-one-
    // club careers went missing because no single identity row reached
    // the threshold.
    case 'games_at_one_club_min': {
      const n = requireInt(axis, 'games', 'Games');
      return sql`EXISTS (SELECT 1 FROM player_clubs pc
                           JOIN clubs cl ON cl.id = pc.club_id
                          WHERE pc.player_id = p.id
                          GROUP BY cl.organization_id
                         HAVING sum(pc.games) >= ${n})`;
    }
    case 'clubs_played_min':
      return sql`c.clubs_played >= ${requireInt(axis, 'clubs', 'Clubs')}`;
    // Correlated rather than a set-wide IN: Postgres cannot estimate rows
    // through the per-org HAVING (it guessed 67 where ~13k came back) and
    // answered the IN form with a nested loop over a materialised
    // aggregate -- past the 5s statement timeout. Correlated, each
    // candidate costs one player_clubs_pkey seek over a handful of rows
    // (281ms worst-case across every player on real data), and the
    // clubs_played gate -- implied by the org count, and indexed -- prunes
    // most candidates before the subquery runs at all.
    case 'goals_at_multiple_clubs_min': {
      const goals = requireInt(axis, 'goals', 'Goals');
      const clubs = requireInt(axis, 'clubs', 'Clubs');
      return sql`(c.clubs_played >= ${clubs} AND (
                    SELECT count(*) FROM (
                      SELECT 1 FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
                       WHERE pc.player_id = p.id
                       GROUP BY cl.organization_id
                      HAVING sum(pc.goals) >= ${goals}
                    ) org) >= ${clubs})`;
    }
    case 'games_at_multiple_clubs_min': {
      const games = requireInt(axis, 'games', 'Games');
      const clubs = requireInt(axis, 'clubs', 'Clubs');
      return sql`(c.clubs_played >= ${clubs} AND (
                    SELECT count(*) FROM (
                      SELECT 1 FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
                       WHERE pc.player_id = p.id
                       GROUP BY cl.organization_id
                      HAVING sum(pc.games) >= ${games}
                    ) org) >= ${clubs})`;
    }

    // -- Career milestones ----------------------------------------------
    case 'career_games_min':
      return sql`c.games >= ${requireInt(axis, 'games', 'Games')}`;
    case 'career_games_max':
      return sql`c.games <= ${requireInt(axis, 'games', 'Games')}`;
    case 'career_goals_min':
      return sql`c.goals >= ${requireInt(axis, 'goals', 'Goals')}`;
    case 'career_goals_max':
      return sql`c.goals <= ${requireInt(axis, 'goals', 'Goals')}`;
    case 'career_stat_total_min':
      return careerStatAtLeast(requireStatKey(axis), requireInt(axis, 'x', 'At least'));
    case 'career_stat_avg_min': {
      const statKey = requireStatKey(axis);
      const avg = requireDecimal(axis, 'avg', 'At least (average)');
      const minGames = requireInt(axis, 'minGames', 'Minimum games');
      const col = sql.unsafe(statKey);
      return sql`p.id IN (SELECT player_id FROM player_match_stats
                            WHERE ${col} IS NOT NULL
                           GROUP BY player_id
                          HAVING avg(${col}) >= ${avg} AND count(*) >= ${minGames})`;
    }
    case 'career_stat_exceeds': {
      const statA = requireStatKeyAt(axis, 'statA', 'Statistic A');
      const statB = requireStatKeyAt(axis, 'statB', 'Statistic B');
      return sql`${careerStatValueExpr(statA)} > ${careerStatValueExpr(statB)}`;
    }
    case 'career_teammates_min': {
      // "Teammate" means same club, same season -- player_club_season_stats
      // (migration 015's club-grained table), not player_season_stats
      // (player-season grain, no club dimension at all).
      //
      // A direct self-join here (pcs1 JOIN pcs2 ON season/club) blows the
      // 5s statement timeout: EXPLAIN ANALYZE showed Postgres choosing a
      // Nested Loop + Memoize plan with a 0% cache hit rate (every
      // (player, season, club) key is visited once), so the "cache" adds
      // pure overhead over ~2.1M intermediate join rows. Pre-aggregating
      // each (season, club) roster into an array first and hash-joining
      // against that gets the same 2.1M-row result through a Hash Join
      // instead, in ~2s against the real test data -- comfortably inside
      // budget where the self-join version measured over 5s.
      const n = requireInt(axis, 'x', 'At least');
      return sql`p.id IN (
        WITH rosters AS (
          SELECT season, club_id, array_agg(player_id) AS players
            FROM player_club_season_stats
           GROUP BY season, club_id
        )
        SELECT t.player_id FROM (
          SELECT pcs.player_id, unnest(r.players) AS other
            FROM player_club_season_stats pcs
            JOIN rosters r ON r.season = pcs.season AND r.club_id = pcs.club_id
        ) t
        WHERE t.other <> t.player_id
        GROUP BY t.player_id
        HAVING count(DISTINCT t.other) >= ${n}
      )`;
    }

    // -- Single-game feats -- the per-game sibling of the career/season
    // stat-total builders; same GRID_STATS mechanism, no grain branching
    // needed since player_match_stats has every stat as a real column. --
    case 'single_game_stat_min': {
      const statKey = requireStatKey(axis);
      const n = requireInt(axis, 'x', 'At least');
      return sql`p.id IN (SELECT player_id FROM player_match_stats WHERE ${sql.unsafe(statKey)} >= ${n})`;
    }
    case 'single_game_two_stats_min': {
      const statA = requireStatKeyAt(axis, 'statA', 'Statistic A');
      const xA = requireInt(axis, 'xA', 'At least (A)');
      const statB = requireStatKeyAt(axis, 'statB', 'Statistic B');
      const xB = requireInt(axis, 'xB', 'At least (B)');
      return sql`p.id IN (SELECT player_id FROM player_match_stats
                            WHERE ${sql.unsafe(statA)} >= ${xA} AND ${sql.unsafe(statB)} >= ${xB})`;
    }
    case 'games_with_stat_min_count': {
      const statKey = requireStatKey(axis);
      const y = requireInt(axis, 'y', 'At least (per game)');
      const times = requireInt(axis, 'times', 'In this many games');
      return sql`p.id IN (SELECT player_id FROM player_match_stats WHERE ${sql.unsafe(statKey)} >= ${y}
                           GROUP BY player_id HAVING count(*) >= ${times})`;
    }

    // -- Season & era -----------------------------------------------------
    case 'debuted_between': {
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`c.debut_season BETWEEN ${lo} AND ${hi}`;
    }
    case 'debuted_in_decade': {
      const start = requireInt(axis, 'decade', 'Decade start');
      return sql`c.debut_season BETWEEN ${start} AND ${start + 9}`;
    }
    case 'played_in_decade': {
      const start = requireInt(axis, 'decade', 'Decade start');
      return sql`p.id IN (SELECT player_id FROM player_season_stats
                            WHERE season BETWEEN ${start} AND ${start + 9})`;
    }
    case 'played_between_seasons': {
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`p.id IN (SELECT player_id FROM player_season_stats WHERE season BETWEEN ${lo} AND ${hi})`;
    }
    case 'season_stat_total_min':
      return seasonStatAtLeast(requireStatKey(axis), requireInt(axis, 'x', 'At least'));
    case 'games_in_season_min':
      return sql`p.id IN (SELECT player_id FROM player_season_stats WHERE games >= ${requireInt(axis, 'games', 'Games')})`;
    case 'season_stat_avg_min': {
      const statKey = requireStatKey(axis);
      const avg = requireDecimal(axis, 'avg', 'At least (average)');
      const col = sql.unsafe(statKey);
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE ${col} IS NOT NULL
                           GROUP BY pms.player_id, m.season
                          HAVING avg(${col}) >= ${avg})`;
    }
    case 'season_wins_min':
      return sql`p.id IN (SELECT player_id FROM player_season_stats WHERE wins >= ${requireInt(axis, 'times', 'Wins')})`;
    case 'season_losses_min':
      return sql`p.id IN (SELECT player_id FROM player_season_stats WHERE losses >= ${requireInt(axis, 'times', 'Losses')})`;
    case 'season_draws_min':
      return sql`p.id IN (SELECT player_id FROM player_season_stats WHERE draws >= ${requireInt(axis, 'times', 'Draws')})`;
    case 'drawn_matches_min': {
      const n = requireInt(axis, 'times', 'Drawn matches');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.result = 'draw'
                           GROUP BY pms.player_id HAVING count(*) >= ${n})`;
    }
    case 'never_played_in_draw':
      return sql`NOT EXISTS (SELECT 1 FROM player_match_stats pms
                               JOIN matches m ON m.id = pms.match_id
                              WHERE pms.player_id = p.id AND m.result = 'draw')`;
    case 'club_season_stat_leader': {
      const statKey = requireStatKey(axis);
      return sql`p.id IN (SELECT DISTINCT player_id FROM (${ledSeasonRows(statKey)}) led)`;
    }
    case 'club_season_stat_leader_min_times': {
      const statKey = requireStatKey(axis);
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT player_id FROM (${ledSeasonRows(statKey)}) led
                           GROUP BY player_id HAVING count(*) >= ${n})`;
    }
    case 'wooden_spoon_season':
      return sql`EXISTS (SELECT 1 FROM player_club_season_stats pcs
                           JOIN club_seasons cs ON cs.season = pcs.season AND cs.club_id = pcs.club_id
                          WHERE pcs.player_id = p.id AND cs.wooden_spoon)`;
    case 'minor_premiership_season':
      return sql`EXISTS (SELECT 1 FROM player_club_season_stats pcs
                           JOIN club_seasons cs ON cs.season = pcs.season AND cs.club_id = pcs.club_id
                          WHERE pcs.player_id = p.id AND cs.ladder_rank = 1)`;
    case 'never_minor_premier':
      return sql`NOT EXISTS (SELECT 1 FROM player_club_season_stats pcs
                               JOIN club_seasons cs ON cs.season = pcs.season AND cs.club_id = pcs.club_id
                              WHERE pcs.player_id = p.id AND cs.ladder_rank = 1)`;
    case 'minor_premierships_min': {
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT pcs.player_id FROM player_club_season_stats pcs
                            JOIN club_seasons cs ON cs.season = pcs.season AND cs.club_id = pcs.club_id
                           WHERE cs.ladder_rank = 1
                           GROUP BY pcs.player_id HAVING count(*) >= ${n})`;
    }

    // -- Finals & premierships ------------------------------------------
    case 'played_in_a_final':
      return sql`c.finals > 0`;
    case 'never_played_finals':
      return sql`c.finals = 0`;
    case 'finals_games_min':
      return sql`c.finals >= ${requireInt(axis, 'games', 'Games')}`;
    case 'premiership_player':
      return sql`c.premierships > 0`;
    case 'won_a_final':
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.is_final AND m.winner_club_id = pms.club_id)`;
    case 'finals_wins_min': {
      const n = requireInt(axis, 'x', 'At least');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.is_final AND m.winner_club_id = pms.club_id
                           GROUP BY pms.player_id HAVING count(*) >= ${n})`;
    }
    case 'never_won_a_final':
      return sql`NOT EXISTS (SELECT 1 FROM player_match_stats pms
                               JOIN matches m ON m.id = pms.match_id
                              WHERE pms.player_id = p.id AND m.is_final AND m.winner_club_id = pms.club_id)`;
    case 'played_finals_no_wins':
      return sql`c.finals > 0 AND NOT EXISTS (
                    SELECT 1 FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
                     WHERE pms.player_id = p.id AND m.is_final AND m.winner_club_id = pms.club_id)`;
    case 'finals_clubs_min': {
      // Distinct organizations, not distinct historical identities --
      // finals played either side of a club rename are one club here,
      // the same rule as the per-club aggregate builders above.
      const n = requireInt(axis, 'clubs', 'Clubs');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                            JOIN clubs cl ON cl.id = pms.club_id
                           WHERE m.is_final
                           GROUP BY pms.player_id HAVING count(DISTINCT cl.organization_id) >= ${n})`;
    }
    case 'final_game_stat_min': {
      const statKey = requireStatKey(axis);
      const n = requireInt(axis, 'x', 'At least');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.is_final AND ${sql.unsafe(`pms.${statKey}`)} >= ${n})`;
    }
    case 'grand_final_game_stat_min': {
      const statKey = requireStatKey(axis);
      const n = requireInt(axis, 'x', 'At least');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.round_type = 'grand_final' AND ${sql.unsafe(`pms.${statKey}`)} >= ${n})`;
    }
    case 'finals_stat_total_min': {
      const statKey = requireStatKey(axis);
      const n = requireInt(axis, 'x', 'At least');
      const col = sql.unsafe(`pms.${statKey}`);
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.is_final
                           GROUP BY pms.player_id HAVING sum(${col}) >= ${n})`;
    }
    case 'finals_stat_avg_min': {
      const statKey = requireStatKey(axis);
      const avg = requireDecimal(axis, 'avg', 'At least (average)');
      const col = sql.unsafe(`pms.${statKey}`);
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.is_final AND ${col} IS NOT NULL
                           GROUP BY pms.player_id HAVING avg(${col}) >= ${avg})`;
    }
    case 'played_a_grand_final':
      return sql`EXISTS (SELECT 1 FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
                          WHERE pms.player_id = p.id AND m.round_type = 'grand_final')`;
    case 'never_played_grand_final':
      return sql`NOT EXISTS (SELECT 1 FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
                              WHERE pms.player_id = p.id AND m.round_type = 'grand_final')`;
    case 'grand_finals_played_min': {
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.round_type = 'grand_final'
                           GROUP BY pms.player_id HAVING count(*) >= ${n})`;
    }
    case 'prelim_finals_played_min': {
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.round_type = 'preliminary_final'
                           GROUP BY pms.player_id HAVING count(*) >= ${n})`;
    }
    case 'grand_final_clubs_min': {
      // Distinct organizations, same as finals_clubs_min.
      const n = requireInt(axis, 'clubs', 'Clubs');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                            JOIN clubs cl ON cl.id = pms.club_id
                           WHERE m.round_type = 'grand_final'
                           GROUP BY pms.player_id HAVING count(DISTINCT cl.organization_id) >= ${n})`;
    }
    case 'grand_final_between_seasons': {
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`EXISTS (SELECT 1 FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
                          WHERE pms.player_id = p.id AND m.round_type = 'grand_final'
                            AND m.season BETWEEN ${lo} AND ${hi})`;
    }
    case 'premierships_min':
      return sql`c.premierships >= ${requireInt(axis, 'times', 'Premierships')}`;
    case 'premiership_between_seasons': {
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`EXISTS (SELECT 1 FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
                          WHERE pms.player_id = p.id AND m.round_type = 'grand_final'
                            AND m.winner_club_id = pms.club_id
                            AND m.season BETWEEN ${lo} AND ${hi})`;
    }
    case 'grand_finals_lost_min': {
      // A drawn Grand Final (winner_club_id IS NULL) counts as neither a
      // win nor a loss -- the replay is what actually decided it.
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.round_type = 'grand_final'
                             AND m.winner_club_id IS NOT NULL AND m.winner_club_id <> pms.club_id
                           GROUP BY pms.player_id HAVING count(*) >= ${n})`;
    }
    case 'lost_grand_final_against': {
      const otherId = requireInt(axis, 'player', 'Player');
      return sql`p.id IN (SELECT pms1.player_id FROM player_match_stats pms1
                            JOIN matches m ON m.id = pms1.match_id
                            JOIN player_match_stats pms2
                              ON pms2.match_id = pms1.match_id AND pms2.club_id <> pms1.club_id
                           WHERE m.round_type = 'grand_final'
                             AND pms2.player_id = ${otherId}
                             AND m.winner_club_id = pms2.club_id)`;
    }

    // -- Grounds & venues -------------------------------------------------
    case 'played_at_venue': {
      const venueId = requireInt(axis, 'venue', 'Venue');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.venue_id = ${venueId})`;
    }
    case 'games_at_venue_min': {
      const venueId = requireInt(axis, 'venue', 'Venue');
      const n = requireInt(axis, 'games', 'Games');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.venue_id = ${venueId}
                           GROUP BY pms.player_id HAVING count(*) >= ${n})`;
    }
    case 'won_final_at_venue': {
      const venueId = requireInt(axis, 'venue', 'Venue');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.venue_id = ${venueId} AND m.is_final AND m.winner_club_id = pms.club_id)`;
    }
    case 'venue_game_stat_min': {
      const venueId = requireInt(axis, 'venue', 'Venue');
      const statKey = requireStatKey(axis);
      const n = requireInt(axis, 'x', 'At least');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.venue_id = ${venueId} AND ${sql.unsafe(`pms.${statKey}`)} >= ${n})`;
    }
    case 'venue_stat_total_min': {
      const venueId = requireInt(axis, 'venue', 'Venue');
      const statKey = requireStatKey(axis);
      const n = requireInt(axis, 'x', 'At least');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.venue_id = ${venueId}
                           GROUP BY pms.player_id HAVING sum(${sql.unsafe(`pms.${statKey}`)}) >= ${n})`;
    }
    case 'venue_goals_max': {
      // "Played there" is the gate: the subquery only produces players
      // with at least one game at the venue, so a player who never set
      // foot there does not satisfy "X or fewer goals" vacuously. Goals
      // are recorded for every player-game (never NULL-for-era), so the
      // coalesce only covers the empty-sum edge, not missing data.
      const venueId = requireInt(axis, 'venue', 'Venue');
      const n = requireInt(axis, 'goals', 'Goals');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.venue_id = ${venueId}
                           GROUP BY pms.player_id HAVING coalesce(sum(pms.goals), 0) <= ${n})`;
    }

    // -- Rivalries & marquee matches --------------------------------------
    // match_event is a bound value from GRID_MATCH_EVENTS; like club and
    // venue ids, an unrecognised value is safe SQL that matches nothing.
    case 'match_event_played': {
      const event = requireParam(axis, 'event', 'Marquee match');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.match_event = ${event})`;
    }
    case 'match_event_min': {
      const event = requireParam(axis, 'event', 'Marquee match');
      const n = requireInt(axis, 'times', 'Matches');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                           WHERE m.match_event = ${event}
                           GROUP BY pms.player_id HAVING count(*) >= ${n})`;
    }
    case 'matchup_played_min': {
      // Both clubs resolve at the organization level, like every other
      // club-scoped builder, so a Showdown filter spans any rename on
      // either side. The player only has to have played IN the match,
      // for either organization.
      const orgA = requireInt(axis, 'clubA', 'Club A');
      const orgB = requireInt(axis, 'clubB', 'Club B');
      const n = requireInt(axis, 'times', 'Matches');
      return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                            JOIN matches m ON m.id = pms.match_id
                            JOIN clubs home ON home.id = m.home_club_id
                            JOIN clubs away ON away.id = m.away_club_id
                           WHERE (home.organization_id = ${orgA} AND away.organization_id = ${orgB})
                              OR (home.organization_id = ${orgB} AND away.organization_id = ${orgA})
                           GROUP BY pms.player_id HAVING count(*) >= ${n})`;
    }

    // -- Teammates -- the same self-join as getPlayerOverlapSummary
    // in db/queries/player-compare.ts. ------------------------------
    case 'teammate_of': {
      const otherId = requireInt(axis, 'player', 'Player');
      return sql`p.id IN (SELECT pcs1.player_id FROM player_club_season_stats pcs1
                            JOIN player_club_season_stats pcs2
                              ON pcs2.season = pcs1.season AND pcs2.club_id = pcs1.club_id
                           WHERE pcs2.player_id = ${otherId} AND pcs1.player_id <> ${otherId})`;
    }
    case 'played_against': {
      const otherId = requireInt(axis, 'player', 'Player');
      return sql`p.id IN (SELECT pms1.player_id FROM player_match_stats pms1
                            JOIN player_match_stats pms2
                              ON pms2.match_id = pms1.match_id AND pms2.club_id <> pms1.club_id
                           WHERE pms2.player_id = ${otherId})`;
    }

    // -- Captaincy -- no CHECK constraint ties captaincies.player_id to
    // its link_status_value, so both are checked explicitly. -----------
    case 'club_captain': {
      const orgId = requireInt(axis, 'club', 'Club');
      return sql`p.id IN (SELECT cp.player_id FROM captaincies cp
                            WHERE cp.player_id IS NOT NULL
                              AND cp.link_status_value IN ('unique', 'resolved')
                              AND cp.club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId}))`;
    }
    case 'captain_between_seasons': {
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`p.id IN (SELECT player_id FROM captaincies
                            WHERE player_id IS NOT NULL
                              AND link_status_value IN ('unique', 'resolved')
                              AND season BETWEEN ${lo} AND ${hi})`;
    }
    case 'club_captain_any':
      return sql`p.id IN (SELECT player_id FROM captaincies
                            WHERE player_id IS NOT NULL
                              AND link_status_value IN ('unique', 'resolved'))`;
    case 'captain_of_club_between_seasons': {
      const orgId = requireInt(axis, 'club', 'Club');
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`p.id IN (SELECT cp.player_id FROM captaincies cp
                            WHERE cp.player_id IS NOT NULL
                              AND cp.link_status_value IN ('unique', 'resolved')
                              AND cp.club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId})
                              AND cp.season BETWEEN ${lo} AND ${hi})`;
    }

    // -- Awards & honours -------------------------------------------------
    case 'hall_of_fame_player':
      return sql`p.id IN (SELECT player_id FROM hall_of_fame
                            WHERE player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved'))`;
    case 'brownlow_medallist':
      return sql`p.id IN (SELECT player_id FROM brownlow_season_votes WHERE is_winner)`;

    // player_achievements: curated facts AFLDB cannot recompute from its
    // own match data (there is no play-by-play table), so these read the
    // stored claim rather than deriving anything. Linked rows only.
    case 'first_kick_goal_player':
      return sql`p.id IN (SELECT player_id FROM player_achievements
                            WHERE achievement_type = 'first_kick_goal'
                              AND player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved'))`;
    case 'first_kick_goal_only_career_goal':
      return sql`p.id IN (SELECT player_id FROM player_achievements
                            WHERE achievement_type = 'first_kick_goal'
                              AND player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')
                              AND no_further_career_goals)`;
    case 'first_kick_goal_consecutive_min':
      return sql`p.id IN (SELECT player_id FROM player_achievements
                            WHERE achievement_type = 'first_kick_goal'
                              AND player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')
                              AND consecutive_goal_kicks >= ${requireInt(axis, 'kicks', 'Kicks')})`;
    case 'first_kick_goal_for_club': {
      // By lineage, like every other club-scoped builder, so a Western
      // Bulldogs filter includes the Footscray era.
      const orgId = requireInt(axis, 'club', 'Club');
      return sql`p.id IN (SELECT a.player_id FROM player_achievements a
                            JOIN clubs cl ON cl.id = a.club_id
                           WHERE a.achievement_type = 'first_kick_goal'
                             AND a.player_id IS NOT NULL AND a.link_status_value IN ('unique', 'resolved')
                             AND cl.organization_id = ${orgId})`;
    }
    case 'first_kick_goal_between': {
      // The season the feat happened in, not the player's debut season:
      // the two differ whenever the first kick came after the first game.
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`p.id IN (SELECT player_id FROM player_achievements
                            WHERE achievement_type = 'first_kick_goal'
                              AND player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')
                              AND season BETWEEN ${lo} AND ${hi})`;
    }
    case 'brownlow_votes_career_min':
      return sql`c.brownlow_votes >= ${requireInt(axis, 'votes', 'Votes')}`;

    // -- Awards & honours (generic) -- award_winners/award_nominations,
    // linked rows only, same discipline as everywhere else. 'rising-star'
    // and 'all-australian' are fixed literal slugs (not request-selected),
    // the same status as a hardcoded table name -- only the `award`
    // param itself (an id) is ever request-supplied, and it is always a
    // bound value, never an identifier. ------------------------------
    case 'award_winner': {
      const awardId = requireInt(axis, 'award', 'Award');
      return sql`p.id IN (SELECT player_id FROM award_winners
                            WHERE player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')
                              AND award_id = ${awardId})`;
    }
    case 'award_winner_min_times': {
      const awardId = requireInt(axis, 'award', 'Award');
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT player_id FROM award_winners
                            WHERE player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')
                              AND award_id = ${awardId}
                           GROUP BY player_id HAVING count(*) >= ${n})`;
    }
    case 'award_winner_between_seasons': {
      const awardId = requireInt(axis, 'award', 'Award');
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`p.id IN (SELECT player_id FROM award_winners
                            WHERE player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')
                              AND award_id = ${awardId} AND season BETWEEN ${lo} AND ${hi})`;
    }
    case 'under_22_selection':
      return sql`p.id IN (SELECT w.player_id FROM award_winners w
                            JOIN awards a ON a.id = w.award_id
                           WHERE a.slug = '22-under-22'
                             AND w.player_id IS NOT NULL
                             AND w.link_status_value IN ('unique', 'resolved'))`;
    case 'all_australian_captain':
      return sql`p.id IN (SELECT w.player_id FROM award_winners w
                            JOIN awards a ON a.id = w.award_id
                           WHERE a.slug = 'all-australian' AND w.is_captain
                             AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved'))`;
    case 'all_australian_position': {
      const position = requireParam(axis, 'position', 'Position');
      return sql`p.id IN (SELECT w.player_id FROM award_winners w
                            JOIN awards a ON a.id = w.award_id
                           WHERE a.slug = 'all-australian' AND w.position = ${position}
                             AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved'))`;
    }
    case 'club_best_and_fairest_min_times': {
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT w.player_id FROM award_winners w
                            JOIN awards a ON a.id = w.award_id
                           WHERE a.category = 'club_best_and_fairest'
                             AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved')
                           GROUP BY w.player_id HAVING count(*) >= ${n})`;
    }
    case 'best_and_fairest_multi_club': {
      // Each of the 18 club_best_and_fairest awards already IS one
      // current club identity (its winner rows carry the historical club
      // as it was at the time, but the award_id itself never changes
      // across a rename) -- counting distinct award_id is exactly
      // "distinct clubs' B&F won" with no separate lineage lookup needed.
      const n = requireInt(axis, 'clubs', 'Clubs');
      return sql`p.id IN (SELECT w.player_id FROM award_winners w
                            JOIN awards a ON a.id = w.award_id
                           WHERE a.category = 'club_best_and_fairest'
                             AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved')
                           GROUP BY w.player_id HAVING count(DISTINCT w.award_id) >= ${n})`;
    }
    case 'brownlow_finish_exact':
      return sql`p.id IN (SELECT player_id FROM brownlow_season_votes
                            WHERE eligible_rank = ${requireInt(axis, 'place', 'Finishing place')})`;
    case 'brownlow_top_finish':
      return sql`p.id IN (SELECT player_id FROM brownlow_season_votes
                            WHERE eligible_rank <= ${requireInt(axis, 'place', 'Top place')})`;
    case 'brownlow_top_finish_min_times': {
      const place = requireInt(axis, 'place', 'Top place');
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT player_id FROM brownlow_season_votes WHERE eligible_rank <= ${place}
                           GROUP BY player_id HAVING count(*) >= ${n})`;
    }
    case 'brownlow_winner_votes_min': {
      const votes = requireInt(axis, 'votes', 'Votes');
      return sql`p.id IN (SELECT player_id FROM brownlow_season_votes WHERE is_winner AND votes >= ${votes})`;
    }
    case 'brownlow_season_votes_min':
      return sql`p.id IN (SELECT player_id FROM brownlow_season_votes WHERE votes >= ${requireInt(axis, 'votes', 'Votes')})`;
    case 'rising_star_nominee':
      return sql`p.id IN (SELECT n.player_id FROM award_nominations n
                            JOIN awards a ON a.id = n.award_id
                           WHERE a.slug = 'rising-star'
                             AND n.player_id IS NOT NULL AND n.link_status_value IN ('unique', 'resolved'))`;
    case 'rising_star_nominee_between_seasons': {
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`p.id IN (SELECT n.player_id FROM award_nominations n
                            JOIN awards a ON a.id = n.award_id
                           WHERE a.slug = 'rising-star' AND n.season BETWEEN ${lo} AND ${hi}
                             AND n.player_id IS NOT NULL AND n.link_status_value IN ('unique', 'resolved'))`;
    }
    case 'rising_star_nominee_for_club': {
      const orgId = requireInt(axis, 'club', 'Club');
      return sql`p.id IN (SELECT n.player_id FROM award_nominations n
                            JOIN awards a ON a.id = n.award_id
                           WHERE a.slug = 'rising-star'
                             AND n.club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId})
                             AND n.player_id IS NOT NULL AND n.link_status_value IN ('unique', 'resolved'))`;
    }
    case 'rising_star_nominee_for_club_between_seasons': {
      const orgId = requireInt(axis, 'club', 'Club');
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`p.id IN (SELECT n.player_id FROM award_nominations n
                            JOIN awards a ON a.id = n.award_id
                           WHERE a.slug = 'rising-star'
                             AND n.club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId})
                             AND n.season BETWEEN ${lo} AND ${hi}
                             AND n.player_id IS NOT NULL AND n.link_status_value IN ('unique', 'resolved'))`;
    }
    case 'rising_star_nominee_in_season': {
      const seasonYear = requireInt(axis, 'season', 'Season');
      return sql`p.id IN (SELECT n.player_id FROM award_nominations n
                            JOIN awards a ON a.id = n.award_id
                           WHERE a.slug = 'rising-star' AND n.season = ${seasonYear}
                             AND n.player_id IS NOT NULL AND n.link_status_value IN ('unique', 'resolved'))`;
    }

    // -- Draft & recruitment -- draft_picks_link_ck (migration 019)
    // already guarantees link_status_value IN ('unique','resolved')
    // implies player_id IS NOT NULL, so that check is not repeated here.
    // draftType/signingKind are bound values from a fixed, hand-verified
    // vocabulary (GRID_DRAFT_TYPES/GRID_SIGNING_KINDS); like club/venue
    // ids, an unrecognised value is just safe SQL that matches nothing,
    // not an identifier that needs an isXxx() check. --------------------
    case 'drafted_by_club': {
      const orgId = requireInt(axis, 'club', 'Club');
      return sql`p.id IN (SELECT dp.player_id FROM draft_picks dp
                            WHERE dp.link_status_value IN ('unique', 'resolved')
                              AND dp.club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId}))`;
    }
    case 'draft_pick_between': {
      const [lo, hi] = orderedRange(axis, 'from', 'From pick', 'to', 'To pick');
      return sql`p.id IN (SELECT player_id FROM draft_picks
                            WHERE link_status_value IN ('unique', 'resolved')
                              AND pick_number BETWEEN ${lo} AND ${hi})`;
    }
    case 'draft_year_between': {
      const [lo, hi] = orderedRange(axis, 'from', 'From year', 'to', 'To year');
      return sql`p.id IN (SELECT player_id FROM draft_picks
                            WHERE link_status_value IN ('unique', 'resolved')
                              AND draft_year BETWEEN ${lo} AND ${hi})`;
    }
    case 'draft_type_is': {
      const draftTypeValue = requireParam(axis, 'draftType', 'Draft type');
      return sql`p.id IN (SELECT player_id FROM draft_picks
                            WHERE link_status_value IN ('unique', 'resolved') AND draft_type = ${draftTypeValue})`;
    }
    case 'drafted_by_club_never_played': {
      const orgId = requireInt(axis, 'club', 'Club');
      return sql`p.id IN (SELECT dp.player_id FROM draft_picks dp
                            WHERE dp.link_status_value IN ('unique', 'resolved')
                              AND dp.club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId})
                              AND NOT EXISTS (
                                SELECT 1 FROM player_clubs pc
                                 WHERE pc.player_id = dp.player_id
                                   AND pc.club_id IN (SELECT id FROM clubs WHERE organization_id = ${orgId})
                              ))`;
    }
    case 'recruited_via': {
      const signingKindValue = requireParam(axis, 'signingKind', 'Recruited from');
      return sql`p.id IN (SELECT player_id FROM draft_picks
                            WHERE link_status_value IN ('unique', 'resolved') AND signing_kind = ${signingKindValue})`;
    }
    case 'traded_min_times': {
      const n = requireInt(axis, 'times', 'Times');
      return sql`p.id IN (SELECT player_id FROM draft_picks
                            WHERE link_status_value IN ('unique', 'resolved') AND draft_kind = 'trade'
                           GROUP BY player_id HAVING count(*) >= ${n})`;
    }

    default:
      throw new Error(`Builder "${axis.builder}" has no compiler.`);
  }
}

const GRID_ORDER_SQL: Record<GridOrder, string> = {
  games_asc: 'c.games ASC, p.sort_name',
  games_desc: 'c.games DESC, p.sort_name',
  debut_asc: 'c.debut_season ASC NULLS LAST, p.sort_name',
  debut_desc: 'c.debut_season DESC NULLS LAST, p.sort_name',
};

/** AND-folds any number of axes into one WHERE fragment. `TRUE` for zero axes, same convention as filters.ts's allOf. */
function andAxes(axes: readonly GridAxisState[]): SqlFragment {
  if (axes.length === 0) return sql`TRUE`;
  return axes.map((axis) => compileAxis(axis)).reduce((acc, fragment) => sql`${acc} AND ${fragment}`);
}

export type GridCellSummary = {
  eligible: number;
  top: {
    id: number;
    slug: string;
    displayName: string;
    debutSeason: number | null;
    finalSeason: number | null;
    games: number;
  } | null;
};

/** Eligible count plus the single top-ranked answer, for one cell of the board. */
export async function solveCellSummary(
  row: GridAxisState,
  col: GridAxisState,
  order: GridOrder,
): Promise<GridCellSummary> {
  const where = andAxes([row, col]);

  const rows = await sql<{
    id: number; slug: string; displayName: string;
    debutSeason: number | null; finalSeason: number | null; games: number; total: string;
  }[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           c.debut_season AS "debutSeason", c.final_season AS "finalSeason", c.games,
           count(*) OVER () AS total
      FROM players p JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${where}
     ORDER BY ${sql.unsafe(GRID_ORDER_SQL[order])}
     LIMIT 1
  `;
  const [top] = rows;
  if (!top) return { eligible: 0, top: null };
  return {
    eligible: Number(top.total),
    top: {
      id: top.id, slug: top.slug, displayName: top.displayName,
      debutSeason: top.debutSeason, finalSeason: top.finalSeason, games: top.games,
    },
  };
}

export type GridCellRow = {
  id: number;
  slug: string;
  displayName: string;
  debutSeason: number | null;
  finalSeason: number | null;
  games: number;
  goals: number;
};

/**
 * The ranked list for any number of AND-folded axes, paged. The grid
 * solver itself always calls this with exactly two (a row and a column);
 * the natural-language engine's player_career compiler (db/queries/nl/
 * player-career.ts) is the reason this takes an array rather than a
 * fixed pair -- "300 games, no premiership, played a grand final" is
 * three predicates ANDed the same way two are.
 */
export async function solvePredicates(
  axes: readonly GridAxisState[],
  order: GridOrder,
  options: { limit: number; offset: number },
): Promise<{ rows: GridCellRow[]; total: number }> {
  const where = andAxes(axes);
  const limit = Math.min(Math.max(1, options.limit), GRID_LIMITS.maxRowsPerCell);
  const offset = Math.max(0, options.offset);

  const rows = await sql<(GridCellRow & { total: string })[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           c.debut_season AS "debutSeason", c.final_season AS "finalSeason",
           c.games, c.goals,
           count(*) OVER () AS total
      FROM players p JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${where}
     ORDER BY ${sql.unsafe(GRID_ORDER_SQL[order])}
     LIMIT ${limit} OFFSET ${offset}
  `;
  if (rows.length > 0) {
    return { rows: rows.map(({ total: _total, ...rest }) => rest), total: Number(rows[0].total) };
  }

  // Same reason as getPlayerMatches/listPlayers: a window count cannot
  // survive an empty page (an offset past the end, or eligible=0 outright).
  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total
      FROM players p JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${where}
  `;
  return { rows: [], total: Number(counted.total) };
}

/** The ranked list for one grid-solver cell (a row axis and a column axis), paged -- for the drill-down section. */
export async function solveCellRows(
  row: GridAxisState,
  col: GridAxisState,
  order: GridOrder,
  options: { limit: number; offset: number },
): Promise<{ rows: GridCellRow[]; total: number }> {
  return solvePredicates([row, col], order, options);
}
