/**
 * player_game and player_season grains: every answer checked against an
 * independently hand-written SQL query, the same discipline
 * nl-answers.test.ts applies to player_career. Real ids (players, clubs,
 * venues, seasons) are dynamically discovered from the test database
 * rather than hardcoded, the same convention grid-solver.test.ts uses --
 * this suite runs against afldb_test, whose seed data is not this file's
 * business to assume the shape of.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerPlayerGame } from '@/db/queries/nl/player-game';
import { answerPlayerSeason } from '@/db/queries/nl/player-season';
import { validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type {
  NlAnswerPayload, NlPlayerGameRow, NlPlayerSeasonRow,
} from '@/search/nl/answer-types';

afterAll(async () => {
  await sql.end();
});

function basePlan(overrides: Partial<NlQueryPlan>): NlQueryPlan {
  const raw: NlQueryPlan = {
    v: 1,
    grain: 'player_game',
    metric: 'goals',
    mode: 'single',
    agg: { kind: 'max' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 25,
    ...overrides,
  };
  const validated = validatePlan(raw);
  if ('error' in validated) throw new Error(`test plan failed validation: ${validated.error}`);
  return validated;
}

/** Every plan built here is player_game; narrows the payload once per call site instead of at every property access. */
async function game(overrides: Partial<NlQueryPlan>, limit = 25): Promise<{ lead: NlPlayerGameRow | null; rows: NlPlayerGameRow[]; total: number }> {
  const payload: NlAnswerPayload = await answerPlayerGame(basePlan(overrides), limit);
  if (payload.kind !== 'player_game') throw new Error(`expected player_game, got ${payload.kind}`);
  return payload;
}

/** Every plan built here is player_season. */
async function season(overrides: Partial<NlQueryPlan>, limit = 25): Promise<{ lead: NlPlayerSeasonRow | null; rows: NlPlayerSeasonRow[]; total: number }> {
  const payload: NlAnswerPayload = await answerPlayerSeason(
    basePlan({ grain: 'player_season', mode: undefined, ...overrides }),
    limit,
  );
  if (payload.kind !== 'player_season') throw new Error(`expected player_season, got ${payload.kind}`);
  return payload;
}

describe('player_game mode "single" matches hand-written SQL', () => {
  it('"most goals in a game" (unscoped) matches a hand-written MAX over player_match_stats', async () => {
    const { lead } = await game({ metric: 'goals', agg: { kind: 'max' } });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: number }[]>`SELECT max(goals) AS max FROM player_match_stats`;
    expect(lead!.value).toBe(expected.max);
    expect(lead!.games).toBeNull(); // single-game row, not a scoped sum
  });

  it('a player-scoped question ("dusty\'s highest disposal game") matches a hand-written MAX for that player', async () => {
    const [anchor] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM player_career_stats WHERE disposals IS NOT NULL
       ORDER BY disposals DESC LIMIT 1
    `;
    const { lead } = await game({
      metric: 'disposals', agg: { kind: 'max' },
      player: { id: anchor.playerId, slug: 'x', name: 'x' },
    });
    expect(lead).not.toBeNull();
    expect(lead!.playerId).toBe(anchor.playerId);

    const [expected] = await sql<{ max: number }[]>`
      SELECT max(disposals) AS max FROM player_match_stats WHERE player_id = ${anchor.playerId}
    `;
    expect(lead!.value).toBe(expected.max);
  });

  it('a venue + grand-final scoped question matches a hand-written MAX joined on matches', async () => {
    const [gf] = await sql<{ venueId: number }[]>`
      SELECT venue_id AS "venueId" FROM matches
       WHERE round_type = 'grand_final' AND venue_id IS NOT NULL
       GROUP BY venue_id ORDER BY count(*) DESC LIMIT 1
    `;
    const { lead } = await game({
      metric: 'disposals', agg: { kind: 'max' },
      scope: { venue: { id: gf.venueId, slug: 'x', name: 'x' }, matchType: 'grand_final' },
    });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: number }[]>`
      SELECT max(s.disposals) AS max FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE m.venue_id = ${gf.venueId} AND m.round_type = 'grand_final'
    `;
    expect(lead!.value).toBe(expected.max);
  });

  it('"top 5 goals in a game" includes every hand-written top-5, with ties at the cutoff', async () => {
    const { rows } = await game({ metric: 'goals', agg: { kind: 'top_n', n: 5 } }, 100);
    expect(rows.length).toBeGreaterThanOrEqual(5);

    const expectedTop = await sql<{ playerId: number; matchId: number }[]>`
      SELECT player_id AS "playerId", match_id AS "matchId" FROM player_match_stats
       WHERE goals IS NOT NULL ORDER BY goals DESC LIMIT 5
    `;
    for (const e of expectedTop) {
      expect(rows.some((r) => r.playerId === e.playerId && r.matchId === e.matchId),
        `player ${e.playerId} match ${e.matchId} missing`).toBe(true);
    }
  });

  it('round scope is consumed by the compiler and changes the result set', async () => {
    const [pick] = await sql<{ season: number; roundNumber: number }[]>`
      SELECT season, round_number AS "roundNumber" FROM matches
       WHERE round_type = 'home_and_away' AND round_number IS NOT NULL
       GROUP BY season, round_number ORDER BY count(*) DESC LIMIT 1
    `;
    const scoped = await game({
      metric: 'goals', agg: { kind: 'max' },
      scope: {
        seasonMin: pick.season, seasonMax: pick.season,
        roundNumber: pick.roundNumber, matchType: 'home_and_away',
      },
    });
    const [expected] = await sql<{ max: number }[]>`
      SELECT max(s.goals) AS max
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE m.season = ${pick.season} AND m.round_type = 'home_and_away'
         AND m.round_number = ${pick.roundNumber}
    `;
    expect(scoped.lead?.value).toBe(expected.max);
    expect(scoped.rows.every((r) => r.roundNumber === pick.roundNumber)).toBe(true);
  });

  it('debut scope ranks only career_game_no = 1 rows', async () => {
    const { lead } = await game({ metric: 'goals', agg: { kind: 'max' }, debutGame: true });
    expect(lead).not.toBeNull();
    const [expected] = await sql<{ max: number }[]>`
      SELECT max(goals) AS max FROM player_match_stats WHERE career_game_no = 1
    `;
    expect(lead!.value).toBe(expected.max);
  });

  it('clean "Fitzroy v Richmond" scopes the exact match, not just Fitzroy players', async () => {
    const [fitzroy] = await sql<{ id: number }[]>`SELECT id FROM club_organizations WHERE slug = 'fitzroy'`;
    const [richmond] = await sql<{ id: number }[]>`SELECT id FROM club_organizations WHERE slug = 'richmond'`;
    const { lead } = await game({
      metric: 'hitouts',
      agg: { kind: 'max' },
      scope: {
        matchup: {
          clubA: { organizationId: fitzroy.id, slug: 'fitzroy', name: 'Fitzroy' },
          clubB: { organizationId: richmond.id, slug: 'richmond', name: 'Richmond' },
        },
        seasonMin: 1984,
        seasonMax: 1984,
        roundNumber: 3,
        matchType: 'home_and_away',
      },
    });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ playerName: string; hitouts: number }[]>`
      SELECT p.display_name AS "playerName", s.hitouts
        FROM player_match_stats s
        JOIN players p ON p.id = s.player_id
        JOIN matches m ON m.id = s.match_id
        JOIN clubs h ON h.id = m.home_club_id
        JOIN clubs a ON a.id = m.away_club_id
       WHERE m.season = 1984 AND m.round_type = 'home_and_away' AND m.round_number = 3
         AND ((h.organization_id = ${fitzroy.id} AND a.organization_id = ${richmond.id})
           OR (h.organization_id = ${richmond.id} AND a.organization_id = ${fitzroy.id}))
         AND s.hitouts IS NOT NULL
       ORDER BY s.hitouts DESC, p.sort_name
       LIMIT 1
    `;
    expect(lead!.playerName).toBe(expected.playerName);
    expect(lead!.playerName).toBe('Mark Lee');
    expect(lead!.value).toBe(expected.hitouts);
    expect(lead!.value).toBe(33);
  });

  it('bare "v Richmond" still ranks only players opposed to Richmond', async () => {
    const [richmond] = await sql<{ id: number }[]>`SELECT id FROM club_organizations WHERE slug = 'richmond'`;
    const { lead } = await game({
      metric: 'hitouts',
      agg: { kind: 'max' },
      scope: {
        clubAgainst: { organizationId: richmond.id, slug: 'richmond', name: 'Richmond' },
        seasonMin: 1984,
        seasonMax: 1984,
        roundNumber: 3,
        matchType: 'home_and_away',
      },
    });
    expect(lead).not.toBeNull();
    expect(lead!.playerName).toBe('Glenn Coleman');
    expect(lead!.value).toBe(20);
  });
});

describe('player_game mode "sum" matches hand-written SQL', () => {
  it('a player + opponent scoped sum ("dusty total goals against Carlton") matches a hand-written SUM for that one player', async () => {
    const [anchor] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM player_career_stats WHERE goals > 0 ORDER BY goals DESC LIMIT 1
    `;
    const [org] = await sql<{ id: number }[]>`SELECT id FROM club_organizations ORDER BY id LIMIT 1`;
    const { lead } = await game({
      metric: 'goals', agg: { kind: 'max' }, mode: 'sum',
      player: { id: anchor.playerId, slug: 'x', name: 'x' },
      scope: { clubAgainst: { organizationId: org.id, slug: 'x', name: 'x' } },
    });

    const [expected] = await sql<{ total: string | null }[]>`
      SELECT sum(s.goals) AS total
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE s.player_id = ${anchor.playerId}
         AND (CASE WHEN m.home_club_id = s.club_id THEN m.away_club_id ELSE m.home_club_id END)
               IN (SELECT id FROM clubs WHERE organization_id = ${org.id})
         AND s.goals IS NOT NULL
    `;
    if (expected.total === null) {
      expect(lead).toBeNull(); // this player never played that opponent -- a real, legitimate empty answer
    } else {
      expect(lead).not.toBeNull();
      expect(lead!.value).toBe(Number(expected.total));
      expect(lead!.games).not.toBeNull();
    }
  });

  it('"most goals against <club>" matches a hand-written grouped SUM', async () => {
    const [org] = await sql<{ id: number }[]>`SELECT id FROM club_organizations ORDER BY id LIMIT 1`;
    const { lead } = await game({
      metric: 'goals', agg: { kind: 'max' }, mode: 'sum',
      scope: { clubAgainst: { organizationId: org.id, slug: 'x', name: 'x' } },
    });
    expect(lead).not.toBeNull();
    expect(lead!.games).not.toBeNull(); // sum-mode row: a scoped total, not one match

    const [expected] = await sql<{ max: string }[]>`
      SELECT max(total) AS max FROM (
        SELECT s.player_id, sum(s.goals) AS total
          FROM player_match_stats s JOIN matches m ON m.id = s.match_id
         WHERE (CASE WHEN m.home_club_id = s.club_id THEN m.away_club_id ELSE m.home_club_id END)
                 IN (SELECT id FROM clubs WHERE organization_id = ${org.id})
           AND s.goals IS NOT NULL
         GROUP BY s.player_id
      ) t
    `;
    expect(lead!.value).toBe(Number(expected.max));
  });
});

describe('player_season matches hand-written SQL', () => {
  it('"most goals in <season>" matches a hand-written MAX over player_season_stats', async () => {
    const [yr] = await sql<{ season: number }[]>`
      SELECT season FROM player_season_stats GROUP BY season ORDER BY count(*) DESC LIMIT 1
    `;
    const { lead } = await season({
      metric: 'goals', agg: { kind: 'max' },
      scope: { seasonMin: yr.season, seasonMax: yr.season },
    });
    expect(lead).not.toBeNull();
    expect(lead!.season).toBe(yr.season);

    const [expected] = await sql<{ max: number }[]>`
      SELECT max(goals) AS max FROM player_season_stats WHERE season = ${yr.season}
    `;
    expect(lead!.value).toBe(expected.max);
  });

  it('a live_only season metric (clangers, no precomputed column) matches a hand-written SUM grouped by player and season', async () => {
    const [yr] = await sql<{ season: number }[]>`
      SELECT m.season FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
       WHERE pms.clangers IS NOT NULL
       GROUP BY m.season ORDER BY count(*) DESC LIMIT 1
    `;
    const { lead } = await season({
      metric: 'clangers', agg: { kind: 'max' },
      scope: { seasonMin: yr.season, seasonMax: yr.season },
    });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: string }[]>`
      SELECT max(total) AS max FROM (
        SELECT pms.player_id, sum(pms.clangers) AS total
          FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
         WHERE m.season = ${yr.season} AND pms.clangers IS NOT NULL
         GROUP BY pms.player_id
      ) t
    `;
    expect(lead!.value).toBe(Number(expected.max));
  });

  it('a broad live_only season leaderboard pre-aggregates once instead of timing out', async () => {
    const { lead } = await season({
      metric: 'inside_50s', agg: { kind: 'max' },
    });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ playerId: number; season: number; max: string }[]>`
      WITH totals AS (
        SELECT pms.player_id AS "playerId", m.season, sum(pms.inside_50s) AS total
          FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
         WHERE pms.inside_50s IS NOT NULL
         GROUP BY pms.player_id, m.season
      )
      SELECT "playerId", season, total AS max
        FROM totals
       ORDER BY total DESC, season, "playerId"
       LIMIT 1
    `;
    expect(lead!.playerId).toBe(expected.playerId);
    expect(lead!.season).toBe(expected.season);
    expect(lead!.value).toBe(Number(expected.max));
  });

  it('a player-scoped season query answers with a real season row for that player', async () => {
    const [anchor] = await sql<{ playerId: number; season: number; goals: number }[]>`
      SELECT player_id AS "playerId", season, goals FROM player_season_stats
       WHERE goals IS NOT NULL ORDER BY goals DESC LIMIT 1
    `;
    const { lead } = await season({
      metric: 'goals', agg: { kind: 'max' },
      player: { id: anchor.playerId, slug: 'x', name: 'x' },
    });
    expect(lead).not.toBeNull();
    expect(lead!.playerId).toBe(anchor.playerId);
    expect(lead!.value).toBe(anchor.goals);
    expect(lead!.season).toBe(anchor.season);
  });

  it('a club-scoped season question ranks by the WHOLE season total, not a club-split figure', async () => {
    // A (season, club) pair with several players, so the eligibility
    // filter is actually doing something -- membership in
    // player_club_season_stats, ranking on player_season_stats' own
    // player-grain total, per the schema's own "never attribute a season
    // total to one club" rule (migration 015).
    const [pick] = await sql<{ season: number; organizationId: number }[]>`
      SELECT pcs.season, cl.organization_id AS "organizationId"
        FROM player_club_season_stats pcs JOIN clubs cl ON cl.id = pcs.club_id
       GROUP BY pcs.season, cl.organization_id
      HAVING count(*) >= 5
       ORDER BY pcs.season DESC LIMIT 1
    `;
    const { lead } = await season({
      metric: 'goals', agg: { kind: 'max' },
      scope: {
        seasonMin: pick.season, seasonMax: pick.season,
        clubFor: { organizationId: pick.organizationId, slug: 'x', name: 'x' },
      },
    });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: number }[]>`
      SELECT max(s.goals) AS max FROM player_season_stats s
       WHERE s.season = ${pick.season}
         AND s.player_id IN (
           SELECT pcs.player_id FROM player_club_season_stats pcs
            WHERE pcs.season = ${pick.season}
              AND pcs.club_id IN (SELECT id FROM clubs WHERE organization_id = ${pick.organizationId})
         )
    `;
    expect(lead!.value).toBe(expected.max);
  });
});
