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

import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
import { seedWildcardFinalSeason, type WildcardFixture } from './wildcard-final-fixture';

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

describe('All-Australian final team versus 40-man squad (ISSUE-118 reopened)', () => {
  const team = (params: Record<string, string> = {}): GridAxisState => ({ builder: 'all_australian_team', params });
  const anyPlayer: GridAxisState = { builder: 'career_games_min', params: { games: '0' } };

  it('the final team is the all-australian award alone, never the squad rows', async () => {
    const [truth] = await sql<{ team: number; squadOnly: number; squadMembers: number; squadFirst: number | null }[]>`
      WITH linked AS (
        SELECT w.player_id, w.season, a.slug FROM award_winners w JOIN awards a ON a.id = w.award_id
         WHERE a.slug IN ('all-australian', 'all-australian-squad')
           AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved')
      ), first_squad AS (SELECT min(season) AS season FROM linked WHERE slug = 'all-australian-squad')
      SELECT (SELECT count(DISTINCT player_id) FROM linked WHERE slug = 'all-australian')::int AS team,
             (SELECT count(DISTINCT player_id) FROM linked WHERE slug = 'all-australian-squad'
               AND player_id NOT IN (SELECT player_id FROM linked WHERE slug = 'all-australian'))::int AS "squadOnly",
             (SELECT count(DISTINCT player_id) FROM linked
               WHERE slug = 'all-australian-squad'
                  OR (slug = 'all-australian' AND season >= (SELECT season FROM first_squad)))::int AS "squadMembers",
             (SELECT season FROM first_squad)::int AS "squadFirst"
    `;
    expect(truth.team).toBeGreaterThan(0);
    expect(truth.squadOnly).toBeGreaterThan(0);
    expect(truth.squadFirst).toBe(2007);
    const teamSummary = await solveCellSummary(team(), anyPlayer, 'games_asc');
    expect(teamSummary.eligible).toBe(truth.team);
    const squad = await solveCellSummary({ builder: 'all_australian_squad_member', params: {} }, anyPlayer, 'games_asc');
    expect(squad.eligible).toBe(truth.squadMembers);
    // The two sets differ in both directions: pre-2007 final teams are not squad members, squad-only players are not final-team members.
    expect(squad.eligible).not.toBe(teamSummary.eligible);
  });

  it('repeat selections count distinct seasons, so a two-row 1984 selection is one honour', async () => {
    const doubles = await sql<{ playerId: number; rows: number; seasons: number }[]>`
      SELECT w.player_id AS "playerId", count(*)::int AS rows, count(DISTINCT w.season)::int AS seasons
        FROM award_winners w JOIN awards a ON a.id = w.award_id
       WHERE a.slug = 'all-australian' AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved')
       GROUP BY w.player_id HAVING count(*) > count(DISTINCT w.season)
    `;
    // The 1984 team lists nine players under both club and state.
    expect(doubles.length).toBeGreaterThan(0);
    const [truth] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT w.player_id FROM award_winners w JOIN awards a ON a.id = w.award_id
         WHERE a.slug = 'all-australian' AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved')
         GROUP BY w.player_id HAVING count(DISTINCT w.season) >= 2) t
    `;
    const twice: GridAxisState = { builder: 'all_australian_team_min_times', params: { times: '2' } };
    expect((await solveCellSummary(twice, anyPlayer, 'games_asc')).eligible).toBe(truth.n);
    // A player whose only repeat is the same season twice must not qualify.
    const singleSeason = doubles.filter((r) => r.seasons === 1);
    if (singleSeason.length > 0) {
      const page = await solveCellRows(twice, anyPlayer, 'games_asc', { limit: GRID_LIMITS.maxRowsPerCell, offset: 0 });
      const ids = new Set(page.rows.map((r) => r.id));
      for (const r of singleSeason) expect(ids.has(r.playerId), String(r.playerId)).toBe(false);
    }
  });
});

describe('height builders (ISSUE-118 reopened)', () => {
  const anyPlayer: GridAxisState = { builder: 'career_games_min', params: { games: '0' } };

  it('an unknown height never qualifies on either side of the bound', async () => {
    const [truth] = await sql<{ known: number; tall: number; short: number }[]>`
      SELECT count(height_cm)::int AS known,
             count(*) FILTER (WHERE height_cm >= 195)::int AS tall,
             count(*) FILTER (WHERE height_cm <= 180)::int AS short
        FROM players
    `;
    const tall = await solveCellSummary({ builder: 'height_min', params: { cm: '195' } }, anyPlayer, 'games_asc');
    const short = await solveCellSummary({ builder: 'height_max', params: { cm: '180' } }, anyPlayer, 'games_asc');
    expect(tall.eligible).toBe(truth.tall);
    expect(short.eligible).toBe(truth.short);
    // Every player with a recorded height is on exactly one side of a 180/181 split; nobody without one is on either.
    const under181 = await solveCellSummary({ builder: 'height_max', params: { cm: '180' } }, anyPlayer, 'games_asc');
    const over180 = await solveCellSummary({ builder: 'height_min', params: { cm: '181' } }, anyPlayer, 'games_asc');
    expect(under181.eligible + over180.eligible).toBe(truth.known);
  });
});

describe('grid solver correctness', () => {
  it('solves the mapped ISSUE-076 won-final grid within the four-second safety margin', async () => {
    const [identity] = await sql<{
      playerId: number; playerName: string;
      fitzroyId: number; fitzroySlug: string;
      gwsId: number; gwsSlug: string;
      venueId: number; venueLegacyName: string; venueName: string;
    }[]>`
      WITH cerra AS (
        SELECT ei.player_id
          FROM external_identities ei
          JOIN sources s ON s.id = ei.source_id
         WHERE s.key = 'afltables'
           AND ei.external_id = 'players/A/Adam_Cerra.html'
           AND ei.status IN ('unique', 'resolved')
      ), fitzroy AS (
        SELECT id, slug FROM club_organizations WHERE slug = 'fitzroy'
      ), gws AS (
        SELECT id, slug FROM club_organizations WHERE slug = 'greater-western-sydney'
      ), mcg AS (
        SELECT id, legacy_name, canonical_name FROM venues WHERE legacy_name = 'M.C.G.'
      )
      SELECT cerra.player_id AS "playerId", p.display_name AS "playerName",
             fitzroy.id AS "fitzroyId", fitzroy.slug AS "fitzroySlug",
             gws.id AS "gwsId", gws.slug AS "gwsSlug",
             mcg.id AS "venueId", mcg.legacy_name AS "venueLegacyName",
             mcg.canonical_name AS "venueName"
        FROM cerra
        JOIN players p ON p.id = cerra.player_id
        CROSS JOIN fitzroy
        CROSS JOIN gws
        CROSS JOIN mcg
    `;
    expect(identity).toMatchObject({
      playerName: 'Adam Cerra',
      fitzroySlug: 'fitzroy',
      gwsSlug: 'greater-western-sydney',
      venueLegacyName: 'M.C.G.',
      venueName: 'Melbourne Cricket Ground',
    });
    expect(identity.playerId).toBeGreaterThan(0);
    expect(identity.fitzroyId).toBeGreaterThan(0);
    expect(identity.gwsId).toBeGreaterThan(0);
    expect(identity.venueId).toBeGreaterThan(0);

    const rows = [
      { builder: 'games_at_multiple_clubs_min', params: { games: '50', clubs: '2' } },
      { builder: 'teammate_of', params: { player: String(identity.playerId) } },
      { builder: 'single_game_stat_min', params: { stat: 'kicks', x: '20' } },
    ] as const satisfies readonly GridAxisState[];
    const commonCols = [
      { builder: 'played_for_club', params: { club: String(identity.fitzroyId) } },
      { builder: 'played_for_club', params: { club: String(identity.gwsId) } },
    ] as const satisfies readonly GridAxisState[];
    const wonCols = [
      ...commonCols,
      { builder: 'won_final_at_venue', params: { venue: String(identity.venueId) } },
    ] as const satisfies readonly GridAxisState[];
    const started = performance.now();
    const wonCells = await Promise.all(rows.map((row) => Promise.all(
      wonCols.map((col) => solveCellSummary(row, col, 'games_asc')),
    )));
    const elapsedMs = performance.now() - started;

    expect(elapsedMs).toBeLessThan(4_000);

    const independentOracle = await sql<{
      rowIndex: number;
      eligible: number;
      topId: number | null;
      topName: string | null;
    }[]>`
      WITH qualifying_organization_stints AS (
        SELECT pc.player_id, c.organization_id
          FROM player_clubs pc
          JOIN clubs c ON c.id = pc.club_id
         GROUP BY pc.player_id, c.organization_id
        HAVING sum(pc.games) >= 50
      ), multi_club_players AS (
        SELECT player_id
          FROM qualifying_organization_stints
         GROUP BY player_id
        HAVING count(*) >= 2
      ), cerra_seasons AS (
        SELECT club_id, season
          FROM player_club_season_stats
         WHERE player_id = ${identity.playerId}
      ), cerra_teammates AS (
        SELECT DISTINCT pcs.player_id
          FROM player_club_season_stats pcs
          JOIN cerra_seasons cs
            ON cs.club_id = pcs.club_id
           AND cs.season = pcs.season
         WHERE pcs.player_id <> ${identity.playerId}
      ), twenty_kick_players AS (
        SELECT DISTINCT player_id
          FROM player_match_stats
         WHERE kicks >= 20
      ), mcg_final_winners AS (
        SELECT DISTINCT pms.player_id
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
         WHERE m.venue_id = ${identity.venueId}
           AND m.is_final
           AND m.winner_club_id = pms.club_id
      ), row_memberships AS (
        SELECT 0 AS row_index, player_id FROM multi_club_players
        UNION ALL
        SELECT 1 AS row_index, player_id FROM cerra_teammates
        UNION ALL
        SELECT 2 AS row_index, player_id FROM twenty_kick_players
      ), eligible_players AS (
        SELECT rm.row_index, rm.player_id
          FROM row_memberships rm
          JOIN mcg_final_winners winners ON winners.player_id = rm.player_id
      ), row_keys(row_index) AS (
        VALUES (0), (1), (2)
      ), eligible_counts AS (
        SELECT row_index, count(*)::int AS eligible
          FROM eligible_players
         GROUP BY row_index
      )
      SELECT keys.row_index AS "rowIndex",
             coalesce(counts.eligible, 0) AS eligible,
             top_player.id AS "topId",
             top_player.display_name AS "topName"
        FROM row_keys keys
        LEFT JOIN eligible_counts counts USING (row_index)
        LEFT JOIN LATERAL (
          SELECT p.id, p.display_name
            FROM eligible_players eligible
            JOIN player_career_stats career ON career.player_id = eligible.player_id
            JOIN players p ON p.id = eligible.player_id
           WHERE eligible.row_index = keys.row_index
           ORDER BY career.games ASC, p.sort_name
           LIMIT 1
        ) top_player ON true
       ORDER BY keys.row_index
    `;

    expect(independentOracle).toHaveLength(rows.length);
    for (const expected of independentOracle) {
      const actual = wonCells[expected.rowIndex][2];
      expect(actual.eligible).toBe(expected.eligible);
      expect(actual.top?.id ?? null).toBe(expected.topId);
      expect(actual.top?.displayName ?? null).toBe(expected.topName);
      if (expected.eligible === 0) {
        expect(expected.topId).toBeNull();
        expect(expected.topName).toBeNull();
      } else {
        expect(expected.topId).not.toBeNull();
        expect(expected.topName).not.toBeNull();
      }
    }
  });

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

  it('teammate_of includes a player independently known to share a club in a season', async () => {
    // Anchored on one long-career player first so the discovery query is
    // an index seek rather than an unbounded self-join -- see the
    // identical reasoning in tests/integration/player-compare.test.ts.
    const [anchor] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM player_career_stats ORDER BY games DESC LIMIT 1
    `;
    const [pairRow] = await sql<{ other: number }[]>`
      SELECT pcs2.player_id AS other
        FROM player_club_season_stats pcs1
        JOIN player_club_season_stats pcs2
          ON pcs2.season = pcs1.season AND pcs2.club_id = pcs1.club_id AND pcs2.player_id <> pcs1.player_id
       WHERE pcs1.player_id = ${anchor.playerId}
       GROUP BY pcs2.player_id
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

  it('career_games_max is inclusive (<=) of the threshold', async () => {
    const [sample] = await sql<{ games: number }[]>`
      SELECT games FROM player_career_stats LIMIT 1
    `;
    expect(sample).toBeDefined();

    const summary = await solveCellSummary(
      { builder: 'career_games_max', params: { games: String(sample.games) } },
      { builder: 'career_games_min', params: { games: String(sample.games) } },
      'games_asc',
    );
    expect(summary.eligible).toBeGreaterThan(0);
  });

  it('single_game_stat_min correctly returns 0 for a player whose matches predate stat recording (NULL semantics)', async () => {
    // 30+ disposals shouldn't silently include players who played before disposals were recorded.
    // We force this by intersecting with 'career_games_min: 0' and testing a known historic player who
    // has no recorded disposals. Here we test a generic case where a historic decade shouldn't match.
    const summary = await solveCellSummary(
      { builder: 'single_game_stat_min', params: { stat: 'disposals', x: '30' } },
      { builder: 'played_in_decade', params: { decade: '1890' } },
      'games_asc',
    );
    // Since disposals were not recorded in the 1890s, they are NULL. NULL >= 30 is false.
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

  it('solves the three ISSUE-103 finals-win cells under one second with an independent oracle', async () => {
    const [environment] = await sql<{ database: string; statementTimeout: string }[]>`
      SELECT current_database() AS database,
             current_setting('statement_timeout') AS "statementTimeout"
    `;
    expect(environment.database).toBe('afldb_test');
    expect(environment.statementTimeout).toBe('5s');

    const cases: Array<{
      cell: string;
      row: GridAxisState;
      col: GridAxisState;
    }> = [
      {
        cell: 'won_x_games_1',
        row: { builder: 'won_a_final', params: {} },
        col: { builder: 'career_games_min', params: { games: '1' } },
      },
      {
        cell: 'never_won_x_games_1',
        row: { builder: 'never_won_a_final', params: {} },
        col: { builder: 'career_games_min', params: { games: '1' } },
      },
      {
        cell: 'won_x_never_won',
        row: { builder: 'won_a_final', params: {} },
        col: { builder: 'never_won_a_final', params: {} },
      },
    ];

    const actual = new Map<string, Awaited<ReturnType<typeof solveCellSummary>>>();
    for (const cell of cases) {
      const started = performance.now();
      const summary = await solveCellSummary(cell.row, cell.col, 'games_asc');
      const elapsedMs = performance.now() - started;
      expect(elapsedMs, `${cell.cell} took ${elapsedMs.toFixed(1)} ms`).toBeLessThan(1000);
      actual.set(cell.cell, summary);
    }

    // Structurally independent oracle: derive the unique winning-final set
    // from base participation/match facts, derive its complement with a left
    // anti join, then intersect those independent sets for the impossible
    // third cell. This does not call compileAxis/solveCellSummary or reuse the
    // generated production predicate.
    const expected = await sql<{
      cell: string;
      eligible: string;
      topId: number | null;
      topName: string | null;
    }[]>`
      WITH winning_final_players AS (
        SELECT pms.player_id
          FROM player_match_stats pms
          JOIN matches m
            ON m.id = pms.match_id
           AND m.winner_club_id = pms.club_id
         WHERE m.is_final
         GROUP BY pms.player_id
      ),
      never_winning_final_players AS (
        SELECT p.id AS player_id
          FROM players p
          LEFT JOIN winning_final_players winners ON winners.player_id = p.id
         WHERE winners.player_id IS NULL
      ),
      cell_members AS (
        SELECT 'won_x_games_1'::text AS cell,
               p.id AS player_id, p.display_name, p.sort_name, career.games
          FROM winning_final_players winners
          JOIN players p ON p.id = winners.player_id
          JOIN player_career_stats career ON career.player_id = p.id
         WHERE career.games >= 1
        UNION ALL
        SELECT 'never_won_x_games_1',
               p.id, p.display_name, p.sort_name, career.games
          FROM never_winning_final_players never_winners
          JOIN players p ON p.id = never_winners.player_id
          JOIN player_career_stats career ON career.player_id = p.id
         WHERE career.games >= 1
        UNION ALL
        SELECT 'won_x_never_won',
               p.id, p.display_name, p.sort_name, career.games
          FROM winning_final_players winners
          JOIN never_winning_final_players never_winners USING (player_id)
          JOIN players p ON p.id = winners.player_id
          JOIN player_career_stats career ON career.player_id = p.id
      ),
      cell_keys(cell, ordinal) AS (
        VALUES ('won_x_games_1'::text, 1),
               ('never_won_x_games_1'::text, 2),
               ('won_x_never_won'::text, 3)
      )
      SELECT keys.cell,
             count(members.player_id)::text AS eligible,
             (array_agg(members.player_id ORDER BY members.games, members.sort_name)
               FILTER (WHERE members.player_id IS NOT NULL))[1] AS "topId",
             (array_agg(members.display_name ORDER BY members.games, members.sort_name)
               FILTER (WHERE members.player_id IS NOT NULL))[1] AS "topName"
        FROM cell_keys keys
        LEFT JOIN cell_members members ON members.cell = keys.cell
       GROUP BY keys.cell, keys.ordinal
       ORDER BY keys.ordinal
    `;

    expect(expected).toHaveLength(cases.length);
    for (const oracle of expected) {
      const summary = actual.get(oracle.cell);
      expect(summary, oracle.cell).toBeDefined();
      expect(summary!.eligible, oracle.cell).toBe(Number(oracle.eligible));
      expect(summary!.top?.id ?? null, oracle.cell).toBe(oracle.topId);
      expect(summary!.top?.displayName ?? null, oracle.cell).toBe(oracle.topName);
    }
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

/**
 * AFLDB-ISSUE-129 §11 T11 — the Grid Solver's finals criteria.
 *
 * Every affirmative finals builder reads `matches.is_finals_series`, so a
 * player whose only game is a Wildcard Final satisfies none of them — not even
 * "won a final", which the fixture makes the hard case by putting that player
 * on the WINNING side. The `grand_final_*` builders read `round_type` directly
 * and are untouched by the new enum value.
 */
describe('AFLDB-ISSUE-129 wildcard finals semantics (grid solver)', () => {
  let fixture: WildcardFixture;

  /** The fixture season alone, used as the partner axis so a cell isolates it. */
  let seasonAxis: GridAxisState;

  beforeAll(async () => {
    fixture = await seedWildcardFinalSeason(2097);
    seasonAxis = {
      builder: 'played_between_seasons',
      params: { from: String(fixture.season), to: String(fixture.season) },
    };
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  async function playerIdsFor(axis: GridAxisState): Promise<number[]> {
    const { rows } = await solveCellRows(axis, seasonAxis, 'games_asc',
      { limit: GRID_LIMITS.maxRowsPerCell, offset: 0 });
    return rows.map((row) => row.id);
  }

  it('the fixture season is isolated: only the two fixture players are in the cell', async () => {
    const ids = await playerIdsFor(fillerAxis('career_games_min'));
    expect(ids.sort()).toEqual(
      [fixture.wildcardOnlyPlayerId, fixture.finalsSeriesPlayerId].sort(),
    );
  });

  it.each([
    ['played_in_a_final', {}],
    ['won_a_final', {}],
    ['finals_games_min', { games: '1' }],
    ['final_game_stat_min', { stat: 'disposals', x: '1' }],
    ['played_a_grand_final', {}],
    ['finals_wins_min', { x: '1' }],
  ] as const)('a wildcard-only player does not satisfy "%s"', async (builder, params) => {
    const ids = await playerIdsFor({ builder, params: { ...params } });
    expect(ids).not.toContain(fixture.wildcardOnlyPlayerId);
  });

  it.each([
    ['played_in_a_final', {}],
    ['finals_games_min', { games: '1' }],
    ['final_game_stat_min', { stat: 'disposals', x: '1' }],
  ] as const)('an elimination-final player still satisfies "%s"', async (builder, params) => {
    const ids = await playerIdsFor({ builder, params: { ...params } });
    expect(ids).toContain(fixture.finalsSeriesPlayerId);
  });

  it('"never played finals" now includes the wildcard-only player', async () => {
    const ids = await playerIdsFor(fillerAxis('never_played_finals'));
    expect(ids).toContain(fixture.wildcardOnlyPlayerId);
    expect(ids).not.toContain(fixture.finalsSeriesPlayerId);
  });

  it('the grand_final_* criteria are untouched by the new enum value', async () => {
    const played = await playerIdsFor({ builder: 'played_a_grand_final', params: {} });
    expect(played).toHaveLength(0);
    const never = await playerIdsFor({ builder: 'never_played_grand_final', params: {} });
    expect(never.sort()).toEqual(
      [fixture.wildcardOnlyPlayerId, fixture.finalsSeriesPlayerId].sort(),
    );
  });
});
