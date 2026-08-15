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
 * identifier position is the `stat` parameter on the two stat-total
 * builders, and that is checked against GRID_STATS (isGridStatKey) before
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

function requireParam(axis: GridAxisState, key: string, label: string): string {
  const value = axis.params[key];
  if (value === undefined || value.trim() === '') throw new Error(`${label} is required.`);
  return value.trim();
}

function requireInt(axis: GridAxisState, key: string, label: string): number {
  return parseIntParam(requireParam(axis, key, label), label);
}

/**
 * The validated stat key, checked against GRID_STATS before it can ever
 * reach sql.unsafe. Returned as a plain string, not a fragment: each call
 * site builds its own fully-qualified `sql.unsafe('<alias>.<key>')` in one
 * shot, the same way filters.ts's rangeConditions does, rather than
 * splicing an unsafe fragment next to literal template text.
 */
function requireStatKey(axis: GridAxisState): GridStatKey {
  const value = requireParam(axis, 'stat', 'Statistic');
  if (!isGridStatKey(value)) throw new Error(`Unknown statistic: ${value}`);
  return value;
}

/** Ascending [lo, hi], regardless of which order the two params were entered in. */
function orderedRange(axis: GridAxisState, loKey: string, loLabel: string, hiKey: string, hiLabel: string): [number, number] {
  const a = requireInt(axis, loKey, loLabel);
  const b = requireInt(axis, hiKey, hiLabel);
  return a <= b ? [a, b] : [b, a];
}

/**
 * "X+ of a stat in a career", grain-aware: player_career_stats precomputes
 * a real total column for the 8 'always'/'era_limited' stats (goals plus
 * the original 7), so those compare directly against `c`. The other 13
 * 'live_only' stats (migration 007 never precomputed them) fall back to a
 * correlated SUM over player_match_stats, scoped to this player by the
 * existing ix_pms_player index. Shared by career_stat_total_min and any
 * other career-grain "X+ of a stat" builder.
 */
function careerStatAtLeast(statKey: GridStatKey, n: number): SqlFragment {
  if (GRID_STATS[statKey].grain !== 'live_only') {
    return sql`${sql.unsafe(`c.${statKey}`)} >= ${n}`;
  }
  return sql`(SELECT sum(${sql.unsafe(statKey)}) FROM player_match_stats WHERE player_id = p.id) >= ${n}`;
}

/**
 * "X+ of a stat in one season" -- does at least one of the player's
 * (player, season, club) rows clear the threshold. Precomputed stats
 * check the real player_season_stats column directly; live_only stats
 * fall back to grouping player_match_stats by player and season. Both
 * branches keep the existing per-row (not summed-across-clubs) semantics:
 * a player traded mid-season is checked one club-stint at a time, same as
 * the original implementation.
 */
function seasonStatAtLeast(statKey: GridStatKey, n: number): SqlFragment {
  if (GRID_STATS[statKey].grain !== 'live_only') {
    return sql`p.id IN (SELECT player_id FROM player_season_stats WHERE ${sql.unsafe(statKey)} >= ${n})`;
  }
  return sql`p.id IN (SELECT pms.player_id FROM player_match_stats pms
                        JOIN matches m ON m.id = pms.match_id
                       GROUP BY pms.player_id, m.season, pms.club_id
                      HAVING sum(${sql.unsafe(statKey)}) >= ${n})`;
}

// One dispatch per builder is the clearest shape here; splitting it up
// would scatter the catalogue across files for no real benefit.
function compileAxis(axis: GridAxisState): SqlFragment {
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
    case 'games_at_one_club_min': {
      const n = requireInt(axis, 'games', 'Games');
      return sql`p.id IN (SELECT player_id FROM player_clubs WHERE games >= ${n})`;
    }

    // -- Career milestones ----------------------------------------------
    case 'career_games_min':
      return sql`c.games >= ${requireInt(axis, 'games', 'Games')}`;
    case 'career_games_max':
      return sql`c.games < ${requireInt(axis, 'games', 'Games')}`;
    case 'career_goals_min':
      return sql`c.goals >= ${requireInt(axis, 'goals', 'Goals')}`;
    case 'career_stat_total_min':
      return careerStatAtLeast(requireStatKey(axis), requireInt(axis, 'x', 'At least'));

    // -- Season & era -----------------------------------------------------
    case 'debuted_between': {
      const [lo, hi] = orderedRange(axis, 'from', 'From season', 'to', 'To season');
      return sql`c.debut_season BETWEEN ${lo} AND ${hi}`;
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

    // -- Teammates -- the same self-join as getPlayerOverlapSummary
    // in db/queries/player-compare.ts. ------------------------------
    case 'teammate_of': {
      const otherId = requireInt(axis, 'player', 'Player');
      return sql`p.id IN (SELECT pms1.player_id FROM player_match_stats pms1
                            JOIN player_match_stats pms2
                              ON pms2.match_id = pms1.match_id AND pms2.club_id = pms1.club_id
                           WHERE pms2.player_id = ${otherId} AND pms1.player_id <> ${otherId})`;
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
    case 'brownlow_votes_career_min':
      return sql`c.brownlow_votes >= ${requireInt(axis, 'votes', 'Votes')}`;

    // -- Draft & recruitment -- draft_picks_link_ck (migration 019)
    // already guarantees link_status_value IN ('unique','resolved')
    // implies player_id IS NOT NULL, so that check is not repeated here. --
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
  const rowWhere = compileAxis(row);
  const colWhere = compileAxis(col);

  const rows = await sql<{
    id: number; slug: string; displayName: string;
    debutSeason: number | null; finalSeason: number | null; games: number; total: string;
  }[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           c.debut_season AS "debutSeason", c.final_season AS "finalSeason", c.games,
           count(*) OVER () AS total
      FROM players p JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${rowWhere} AND ${colWhere}
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

/** The ranked list for one cell, paged -- for the drill-down section. */
export async function solveCellRows(
  row: GridAxisState,
  col: GridAxisState,
  order: GridOrder,
  options: { limit: number; offset: number },
): Promise<{ rows: GridCellRow[]; total: number }> {
  const rowWhere = compileAxis(row);
  const colWhere = compileAxis(col);
  const limit = Math.min(Math.max(1, options.limit), GRID_LIMITS.maxRowsPerCell);
  const offset = Math.max(0, options.offset);

  const rows = await sql<(GridCellRow & { total: string })[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           c.debut_season AS "debutSeason", c.final_season AS "finalSeason",
           c.games, c.goals,
           count(*) OVER () AS total
      FROM players p JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${rowWhere} AND ${colWhere}
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
     WHERE ${rowWhere} AND ${colWhere}
  `;
  return { rows: [], total: Number(counted.total) };
}
