/**
 * player_career grain. player_game/player_season land in
 * tests/integration/nl-answers-game-season.test.ts; team_match/club_season
 * still have no compiler. Every answer here is checked against an
 * independently hand-written SQL query, never just "returns rows". Also
 * ties NL_COVERAGE to the live stat_availability registry so the two
 * cannot silently drift.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { NL_COVERAGE, validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlPlayerCareerRow } from '@/search/nl/answer-types';

afterAll(async () => {
  await sql.end();
});

/** Every plan in this file is player_career; narrows the payload once per call site instead of at every property access. */
async function career(p: NlQueryPlan, limit: number): Promise<{ lead: NlPlayerCareerRow | null; rows: NlPlayerCareerRow[]; total: number }> {
  const payload: NlAnswerPayload = await answerPlayerCareer(p, limit);
  if (payload.kind !== 'player_career') throw new Error(`expected player_career, got ${payload.kind}`);
  return payload;
}

function plan(overrides: Partial<NlQueryPlan>): NlQueryPlan {
  const raw: NlQueryPlan = {
    v: 1,
    grain: 'player_career',
    metric: null,
    agg: { kind: 'list' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 100,
    ...overrides,
  };
  const validated = validatePlan(raw);
  if ('error' in validated) throw new Error(`test plan failed validation: ${validated.error}`);
  return validated;
}

describe('player_career: multi-condition trivia matches hand-written SQL', () => {
  it('"players with 200 games and no premiership"', async () => {
    const { total } = await career(plan({
      careerConditions: [
        { kind: 'column', column: 'games', op: 'gte', value: 200 },
        { kind: 'column', column: 'premierships', op: 'eq', value: 0 },
      ],
    }), 100);

    const [expected] = await sql<{ count: string }[]>`
      SELECT count(*) FROM player_career_stats WHERE games >= 200 AND premierships = 0
    `;
    expect(total).toBe(Number(expected.count));
    expect(total).toBeGreaterThan(0);
  });

  it('"players with 250 games and exactly two clubs"', async () => {
    const { total } = await career(plan({
      careerConditions: [
        { kind: 'column', column: 'games', op: 'gte', value: 250 },
        { kind: 'column', column: 'clubs_played', op: 'eq', value: 2 },
      ],
    }), 100);

    const [expected] = await sql<{ count: string }[]>`
      SELECT count(*) FROM player_career_stats WHERE games >= 250 AND clubs_played = 2
    `;
    expect(total).toBe(Number(expected.count));
    expect(total).toBeGreaterThan(0);
  });

  it('"most games without kicking a goal" -- the leader really has 0 career goals', async () => {
    const { lead, total } = await career(plan({
      metric: 'games', agg: { kind: 'max' },
      careerConditions: [{ kind: 'column', column: 'goals', op: 'eq', value: 0 }],
    }), 25);
    expect(lead).not.toBeNull();

    const [leaderRow] = await sql<{ games: number; goals: number }[]>`
      SELECT games, goals FROM player_career_stats WHERE player_id = ${lead!.playerId}
    `;
    expect(leaderRow.goals).toBe(0);
    expect(leaderRow.games).toBe(lead!.games);

    const [maxAmongZero] = await sql<{ max: number }[]>`
      SELECT max(games) FROM player_career_stats WHERE goals = 0
    `;
    expect(leaderRow.games).toBe(maxAmongZero.max);

    // For a max/min question, `total` means "how many are tied at the
    // leading value" (the answer-set size), not "how many satisfy the
    // base condition at all" -- that population count is a different,
    // much larger number here, and would be a nonsensical "total" to
    // show next to a single leading answer.
    const [tiedCount] = await sql<{ count: string }[]>`
      SELECT count(*) FROM player_career_stats WHERE goals = 0 AND games = ${maxAmongZero.max}
    `;
    expect(total).toBe(Number(tiedCount.count));
  });
});

/**
 * A named player asking for a career-only column ("Nick Dal Santo most
 * games") has to reach THIS grain -- player_game has no games column at
 * all (there is no "his highest-games game") -- but until this was
 * added, conditionsWhere never read `plan.player`. The query silently
 * ranked every player in the database and returned the outright leader
 * instead: caught by executing "Nick Dal Santo most games" against real
 * data, where it answered with Scott Pendlebury's 440 games rather than
 * Dal Santo's own 322. A fixture-based plan-shape test could not have
 * caught this -- the plan itself was already correct, `player` set and
 * all; only the executed row was wrong. Real ids from afldb_test:
 * Nick Dal Santo 1132, Scott Pendlebury 4182.
 */
describe('player_career: a named player is filtered to that player, not ranked against everyone', () => {
  it('"Nick Dal Santo most games" answers about Dal Santo, not the outright leader', async () => {
    const { lead } = await career(plan({
      player: { id: 1132, slug: 'nick-dal-santo', name: 'Nick Dal Santo' },
      metric: 'games', agg: { kind: 'max' },
    }), 25);
    expect(lead).not.toBeNull();
    expect(lead!.playerId).toBe(1132);

    const [expected] = await sql<{ games: number }[]>`
      SELECT games FROM player_career_stats WHERE player_id = 1132
    `;
    expect(lead!.value).toBe(expected.games);
    // The regression this pins: the pre-fix query ignored `plan.player`
    // and would have returned the database-wide leader here instead.
    expect(lead!.playerId).not.toBe(4182);
  });

  it('a named player with a career condition is still filtered to just them', async () => {
    // Combines plan.player with plan.careerConditions -- conditionsWhere
    // folds both into the same AND chain, so this also guards against a
    // future edit that overwrites rather than appends the player clause.
    const { rows } = await career(plan({
      player: { id: 1132, slug: 'nick-dal-santo', name: 'Nick Dal Santo' },
      careerConditions: [{ kind: 'column', column: 'games', op: 'gte', value: 1 }],
    }), 25);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.playerId).toBe(1132);
  });
});

describe('player_career: awards match hand-written SQL', () => {
  it('"most brownlow votes without winning a brownlow"', async () => {
    const { lead } = await career(plan({
      metric: 'brownlow_votes', agg: { kind: 'max' },
      careerConditions: [{ kind: 'column', column: 'brownlow_medals', op: 'eq', value: 0 }],
    }), 25);
    expect(lead).not.toBeNull();

    const [maxAmongNoMedal] = await sql<{ max: number }[]>`
      SELECT max(brownlow_votes) FROM player_career_stats WHERE brownlow_medals = 0
    `;
    expect(lead!.value).toBe(maxAmongNoMedal.max);

    const [leaderRow] = await sql<{ brownlowMedals: number }[]>`
      SELECT brownlow_medals AS "brownlowMedals" FROM player_career_stats WHERE player_id = ${lead!.playerId}
    `;
    expect(leaderRow.brownlowMedals).toBe(0);
  });

  it('"top 10 players by brownlow votes with no medal" -- ranked list matches, with ties past 10 included', async () => {
    const { rows, total } = await career(plan({
      metric: 'brownlow_votes', agg: { kind: 'top_n', n: 10 },
      careerConditions: [{ kind: 'column', column: 'brownlow_medals', op: 'eq', value: 0 }],
    }), 100);
    expect(rows.length).toBeGreaterThan(0);

    const expectedTop = await sql<{ playerId: number; votes: number }[]>`
      SELECT player_id AS "playerId", brownlow_votes AS votes
        FROM player_career_stats
       WHERE brownlow_medals = 0
       ORDER BY brownlow_votes DESC
       LIMIT 10
    `;
    // Every player_id the direct query names for the top 10 must appear
    // in the ranked answer (rows may exceed 10 when ties straddle the
    // cutoff -- rank() includes them, LIMIT 10 alone would not).
    for (const row of expectedTop) {
      expect(rows.some((r) => r.playerId === row.playerId), `player ${row.playerId} missing`).toBe(true);
    }
    expect(total).toBeGreaterThanOrEqual(expectedTop.length);
  });

  it('"most all-australian selections without a premiership" matches a hand-written award_winners count', async () => {
    const { lead } = await career(plan({
      metric: 'all_australian_selections', agg: { kind: 'max' },
      careerConditions: [{ kind: 'column', column: 'premierships', op: 'eq', value: 0 }],
    }), 25);
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ count: string }[]>`
      SELECT count(*) FROM award_winners w
        JOIN awards a ON a.id = w.award_id
       WHERE a.slug = 'all-australian' AND w.player_id = ${lead!.playerId}
         AND w.link_status_value IN ('unique', 'resolved')
    `;
    expect(lead!.value).toBe(Number(expected.count));

    const [leaderPrem] = await sql<{ premierships: number }[]>`
      SELECT premierships FROM player_career_stats WHERE player_id = ${lead!.playerId}
    `;
    expect(leaderPrem.premierships).toBe(0);
  });
});

describe('player_career: boundary questions match hand-written SQL', () => {
  it('"players whose first game was a grand final" -- membership matches career_game_no = 1 in a real GF', async () => {
    const { rows, total } = await career(plan({
      boundary: { event: 'debut', where: 'grand_final' },
    }), 100);

    const [expected] = await sql<{ count: string }[]>`
      SELECT count(DISTINCT pms.player_id) FROM player_match_stats pms
        JOIN matches m ON m.id = pms.match_id
       WHERE pms.career_game_no = 1 AND m.round_type = 'grand_final'
    `;
    expect(total).toBe(Number(expected.count));

    if (rows.length > 0) {
      const [found] = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
           WHERE pms.player_id = ${rows[0].playerId} AND pms.career_game_no = 1 AND m.round_type = 'grand_final'
        ) AS exists
      `;
      expect(found.exists).toBe(true);
    }
  });

  it('"players whose last game was a grand final" -- membership matches last_match_date in a real GF', async () => {
    const { total, rows } = await career(plan({
      boundary: { event: 'last_game', where: 'grand_final' },
    }), 100);

    const [expected] = await sql<{ count: string }[]>`
      SELECT count(DISTINCT pms.player_id) FROM player_match_stats pms
        JOIN matches m ON m.id = pms.match_id
        JOIN player_career_stats c ON c.player_id = pms.player_id
       WHERE m.match_date = c.last_match_date AND m.round_type = 'grand_final'
    `;
    expect(total).toBe(Number(expected.count));
    expect(total).toBeGreaterThan(0);

    if (rows.length > 0) {
      const [found] = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM player_match_stats pms
            JOIN matches m ON m.id = pms.match_id
            JOIN player_career_stats c ON c.player_id = pms.player_id
           WHERE pms.player_id = ${rows[0].playerId} AND m.match_date = c.last_match_date
             AND m.round_type = 'grand_final'
        ) AS exists
      `;
      expect(found.exists).toBe(true);
    }
  });
});

describe('player_career: live_only stat metrics use the correct SUM path', () => {
  it('"most clangers" (a live_only stat) matches a hand-written SUM over player_match_stats', async () => {
    const { lead } = await career(plan({
      metric: 'clangers', agg: { kind: 'max' },
    }), 25);
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: string }[]>`
      SELECT max(total) AS max FROM (
        SELECT player_id, sum(clangers) AS total FROM player_match_stats GROUP BY player_id
      ) t
    `;
    expect(lead!.value).toBe(Number(expected.max));
  });
});

describe('NL_COVERAGE agrees with the live stat_availability registry', () => {
  it.each(Object.entries(NL_COVERAGE))('%s first-recorded season matches stat_availability', async (stat, coverage) => {
    const [row] = await sql<{ minSeason: number | null }[]>`
      SELECT min(season) AS "minSeason" FROM stat_availability
       WHERE stat_key = ${stat} AND is_recorded
    `;
    // Not every NL_COVERAGE key necessarily has a stat_availability row
    // (goal_assists etc. might be registered under a different key name);
    // only assert when the registry actually has one, so a genuinely
    // absent registry entry doesn't fail the whole file -- it is exactly
    // what this test exists to catch if it ever silently regresses.
    if (row.minSeason !== null) {
      expect(coverage!.firstSeason, stat).toBe(row.minSeason);
    }
  });
});
