/**
 * Runs against real data. The "every builder compiles" loop is the
 * single most likely maintenance bug in a catalogue-of-functions design
 * like this one: a new entry in GRID_BUILDERS with no matching case in
 * grid-solver.ts's compileAxis would otherwise only be discovered by a
 * super admin clicking into it on the live site. The rest cross-check the
 * compiler against either a hand-written equivalent query or a real,
 * dynamically-discovered pair of players -- never a hardcoded name.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { solveCellRows, solveCellSummary } from '@/db/queries/grid-solver';
import { getPlayerOverlapSummary } from '@/db/queries/player-compare';
import {
  GRID_BUILDER_KEYS,
  GRID_BUILDERS,
  GRID_LIMITS,
  isAxisComplete,
  type GridAxisState,
} from '@/search/grid-solver-spec';

afterAll(async () => {
  await sql.end();
});

/** Syntactically valid params for any builder -- real ids are not needed: every param lands as a bound literal inside a WHERE clause, never an identifier, so a nonexistent id is safe SQL that just matches nothing. */
function fillerAxis(builderKey: string): GridAxisState {
  const def = GRID_BUILDERS[builderKey];
  const params: Record<string, string> = {};
  for (const p of def.params) {
    params[p.key] = p.kind === 'stat' ? 'disposals' : '1';
  }
  return { builder: builderKey, params };
}

describe('every grid builder compiles and solves', () => {
  const partner = fillerAxis('career_games_min');

  it.each(GRID_BUILDER_KEYS)('solves a cell using "%s" without throwing', async (builderKey) => {
    const axis = fillerAxis(builderKey);
    expect(isAxisComplete(axis), builderKey).toBe(true);
    const summary = await solveCellSummary(axis, partner, 'games_asc');
    expect(summary.eligible, builderKey).toBeGreaterThanOrEqual(0);
  });
});

describe('grid solver correctness', () => {
  it('22Under22 selection matches linked rows from the fixed award series', async () => {
    const summary = await solveCellSummary(
      { builder: 'under_22_selection', params: {} },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    );
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(DISTINCT w.player_id)
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
       WHERE a.slug = '22-under-22'
         AND w.player_id IS NOT NULL
         AND w.link_status_value IN ('unique', 'resolved')
    `;
    expect(summary.eligible).toBe(Number(expected.count));
  });

  it('career_games_min(200) AND career_games_min(0) matches a hand-written equivalent count', async () => {
    const summary = await solveCellSummary(
      { builder: 'career_games_min', params: { games: '200' } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    );
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(*) FROM player_career_stats WHERE games >= 200
    `;
    expect(summary.eligible).toBe(Number(expected.count));
  });

  it('no premiership player is also flagged as never having played a final', async () => {
    // A logical invariant of the data, not an arbitrary check: winning a
    // premiership means winning a Grand Final, which is itself a final.
    const summary = await solveCellSummary(
      { builder: 'premiership_player', params: {} },
      { builder: 'never_played_finals', params: {} },
      'games_asc',
    );
    expect(summary.eligible).toBe(0);
  });

  it('teammate_of includes a player independently known to share a club in a match', async () => {
    // Anchored on one long-career player first so the discovery query is
    // an index seek rather than an unbounded self-join -- see the
    // identical reasoning in tests/integration/player-compare.test.ts.
    const [anchor] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM player_career_stats ORDER BY games DESC LIMIT 1
    `;
    const [pairRow] = await sql<{ other: number }[]>`
      SELECT pms2.player_id AS other
        FROM player_match_stats pms1
        JOIN player_match_stats pms2
          ON pms2.match_id = pms1.match_id AND pms2.club_id = pms1.club_id AND pms2.player_id <> pms1.player_id
       WHERE pms1.player_id = ${anchor.playerId}
       GROUP BY pms2.player_id
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    expect(pairRow, `no teammate of player ${anchor.playerId} was found`).toBeDefined();

    const { rows } = await solveCellRows(
      { builder: 'teammate_of', params: { player: String(pairRow.other) } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
      { limit: GRID_LIMITS.maxRowsPerCell, offset: 0 },
    );
    expect(rows.some((r) => r.id === anchor.playerId)).toBe(true);

    // Cross-checked against the query Phase 2's Player Compare already
    // ships: the anchor and its teammate must actually show up as
    // teammates there too.
    const overlap = await getPlayerOverlapSummary(anchor.playerId, pairRow.other);
    expect(overlap.together).toBeGreaterThan(0);
  });

  it('solveCellRows returns exactly min(eligible, limit) rows for a real cell', async () => {
    const row: GridAxisState = { builder: 'brownlow_medallist', params: {} };
    const col: GridAxisState = { builder: 'career_games_min', params: { games: '0' } };
    const summary = await solveCellSummary(row, col, 'games_asc');
    const { rows, total } = await solveCellRows(row, col, 'games_asc', { limit: GRID_LIMITS.maxRowsPerCell, offset: 0 });
    expect(total).toBe(summary.eligible);
    expect(rows.length).toBe(Math.min(summary.eligible, GRID_LIMITS.maxRowsPerCell));
  });

  it('rejects an incomplete axis rather than silently matching everything', async () => {
    await expect(solveCellSummary(
      { builder: 'played_for_club', params: {} },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    )).rejects.toThrow();
  });

  it('career_stat_total_min on a live_only stat (clangers) matches a hand-written SUM', async () => {
    // clangers has no precomputed career total (unlike the original 7
    // GRID_STATS), so this exercises careerStatValueExpr's live-SUM branch.
    const summary = await solveCellSummary(
      { builder: 'career_stat_total_min', params: { stat: 'clangers', x: '300' } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    );
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(*) FROM (
        SELECT player_id FROM player_match_stats GROUP BY player_id HAVING sum(clangers) >= 300
      ) t
    `;
    expect(summary.eligible).toBe(Number(expected.count));
  });

  it('no minor_premiership_season player is also flagged never_minor_premier', async () => {
    const summary = await solveCellSummary(
      { builder: 'minor_premiership_season', params: {} },
      { builder: 'never_minor_premier', params: {} },
      'games_asc',
    );
    expect(summary.eligible).toBe(0);
  });

  it('no won_a_final player is also flagged never_won_a_final', async () => {
    const summary = await solveCellSummary(
      { builder: 'won_a_final', params: {} },
      { builder: 'never_won_a_final', params: {} },
      'games_asc',
    );
    expect(summary.eligible).toBe(0);
  });

  it('lost_grand_final_against finds a real losing-side player against a real winning-side player', async () => {
    const [gf] = await sql<{ matchId: number; winnerClubId: number }[]>`
      SELECT id AS "matchId", winner_club_id AS "winnerClubId"
        FROM matches WHERE round_type = 'grand_final' AND winner_club_id IS NOT NULL
       ORDER BY season DESC LIMIT 1
    `;
    expect(gf, 'no decided grand final found in the test data').toBeDefined();
    const [winner] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM player_match_stats
       WHERE match_id = ${gf.matchId} AND club_id = ${gf.winnerClubId} LIMIT 1
    `;
    const [loser] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM player_match_stats
       WHERE match_id = ${gf.matchId} AND club_id <> ${gf.winnerClubId} LIMIT 1
    `;
    const { rows } = await solveCellRows(
      { builder: 'lost_grand_final_against', params: { player: String(winner.playerId) } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
      { limit: GRID_LIMITS.maxRowsPerCell, offset: 0 },
    );
    expect(rows.some((r) => r.id === loser.playerId)).toBe(true);
  });

  it('brownlow_top_finish(1) matches a hand-written equivalent count', async () => {
    const summary = await solveCellSummary(
      { builder: 'brownlow_top_finish', params: { place: '1' } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    );
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(DISTINCT player_id) FROM brownlow_season_votes WHERE eligible_rank <= 1
    `;
    expect(summary.eligible).toBe(Number(expected.count));
  });

  it('drafted_by_club_never_played matches a hand-written equivalent for a real club', async () => {
    const [org] = await sql<{ id: number }[]>`SELECT id FROM club_organizations ORDER BY id LIMIT 1`;
    expect(org, 'no club_organizations row found').toBeDefined();
    const summary = await solveCellSummary(
      { builder: 'drafted_by_club_never_played', params: { club: String(org.id) } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    );
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(*) FROM (
        SELECT dp.player_id FROM draft_picks dp
         WHERE dp.link_status_value IN ('unique', 'resolved')
           AND dp.club_id IN (SELECT id FROM clubs WHERE organization_id = ${org.id})
           AND NOT EXISTS (
             SELECT 1 FROM player_clubs pc WHERE pc.player_id = dp.player_id
               AND pc.club_id IN (SELECT id FROM clubs WHERE organization_id = ${org.id})
           )
      ) t
    `;
    expect(summary.eligible).toBe(Number(expected.count));
  });

  it('games_at_multiple_clubs_min never matches a one-organization career', async () => {
    // The regression this guards: player_clubs is one row per HISTORICAL
    // identity, so counted per identity a rename (North Melbourne <->
    // Kangaroos) made 27 one-club careers look like multi-club ones.
    // clubs_played counts organizations, so the intersection must be empty.
    const summary = await solveCellSummary(
      { builder: 'games_at_multiple_clubs_min', params: { games: '1', clubs: '2' } },
      { builder: 'one_club_player', params: {} },
      'games_asc',
    );
    expect(summary.eligible).toBe(0);
  });

  it('goals_at_multiple_clubs_min never matches a one-organization career', async () => {
    const summary = await solveCellSummary(
      { builder: 'goals_at_multiple_clubs_min', params: { goals: '1', clubs: '2' } },
      { builder: 'one_club_player', params: {} },
      'games_asc',
    );
    expect(summary.eligible).toBe(0);
  });

  it('finals_clubs_min(2) never matches a one-organization career', async () => {
    const summary = await solveCellSummary(
      { builder: 'finals_clubs_min', params: { clubs: '2' } },
      { builder: 'one_club_player', params: {} },
      'games_asc',
    );
    expect(summary.eligible).toBe(0);
  });

  it('games_at_one_club_min counts a whole organization stint across a rename', async () => {
    const summary = await solveCellSummary(
      { builder: 'games_at_one_club_min', params: { games: '250' } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    );
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(DISTINCT player_id) FROM (
        SELECT pc.player_id
          FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
         GROUP BY pc.player_id, cl.organization_id
        HAVING sum(pc.games) >= 250
      ) t
    `;
    expect(summary.eligible).toBe(Number(expected.count));
  });

  it('season_draws_min(2) matches a hand-written equivalent count', async () => {
    const summary = await solveCellSummary(
      { builder: 'season_draws_min', params: { times: '2' } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    );
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(DISTINCT player_id) FROM player_season_stats WHERE draws >= 2
    `;
    expect(summary.eligible).toBe(Number(expected.count));
  });

  it('drawn_matches_min(1) matches a hand-written equivalent count', async () => {
    const summary = await solveCellSummary(
      { builder: 'drawn_matches_min', params: { times: '1' } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
    );
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(DISTINCT pms.player_id) FROM player_match_stats pms
        JOIN matches m ON m.id = pms.match_id
       WHERE m.result = 'draw'
    `;
    expect(summary.eligible).toBe(Number(expected.count));
  });

  it('club_season_stat_leader(goals) rows really did lead a club-season in goals', async () => {
    const { rows } = await solveCellRows(
      { builder: 'club_season_stat_leader', params: { stat: 'goals' } },
      { builder: 'career_games_min', params: { games: '0' } },
      'games_asc',
      { limit: 5, offset: 0 },
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const [led] = await sql<{ found: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM player_club_season_stats pcs
           WHERE pcs.player_id = ${r.id}
             AND NOT EXISTS (
               SELECT 1 FROM player_club_season_stats pcs2
                WHERE pcs2.season = pcs.season AND pcs2.club_id = pcs.club_id AND pcs2.goals > pcs.goals
             )
        ) AS found
      `;
      expect(led.found, `player ${r.id} (${r.displayName})`).toBe(true);
    }
  });
});
