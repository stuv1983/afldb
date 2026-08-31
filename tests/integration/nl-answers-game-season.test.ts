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

// answerNlQuestion's telemetry write (logNlSearch) runs detached outside a
// request scope; point the lazy auth pool at afldb_test so those rows land
// in the test database, the same redirect email-intake.test.ts uses.
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

import { sql } from '@/db/client';
import { answerNlQuestion } from '@/db/queries/nl/answer';
import { answerPlayerGame } from '@/db/queries/nl/player-game';
import { answerPlayerSeason } from '@/db/queries/nl/player-season';
import { validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type {
  NlAnswerPayload, NlPlayerGameRow, NlPlayerSeasonRow,
} from '@/search/nl/answer-types';

const E2E_RUN_TAG = 'issue-110-revision-e2e-test';

afterAll(async () => {
  // Waits out any detached telemetry write still in flight, then removes
  // this run's tagged rows so repeated runs don't accumulate telemetry.
  // end() must reach the real pooled client, not the lazy authSql Proxy
  // (datasets.test.ts explains the `this`-binding hazard).
  await globalThis.__afldbAuthSql?.end({ timeout: 5 });
  await sql`DELETE FROM nl_search_log WHERE run_tag = ${E2E_RUN_TAG}`;
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

describe('AFLDB-ISSUE-110 metric thresholds are actually applied', () => {
  it('a single-game gte threshold returns every qualifying performance, not one ranked leader', async () => {
    // The second-highest distinct single-game goals value: guarantees at
    // least two qualifying performances, so the old list-to-rank-one
    // collapse (which returned only the leader) fails this test.
    const [second] = await sql<{ value: number }[]>`
      SELECT DISTINCT goals AS value FROM player_match_stats
       WHERE goals IS NOT NULL ORDER BY goals DESC OFFSET 1 LIMIT 1
    `;
    const { rows, total } = await game({
      metric: 'goals', agg: { kind: 'list' }, limit: 100,
      metricCondition: { op: 'gte', value: second.value },
    }, 100);

    const expected = await sql<{ playerId: number; matchId: number; goals: number }[]>`
      SELECT player_id AS "playerId", match_id AS "matchId", goals
        FROM player_match_stats WHERE goals >= ${second.value}
    `;
    expect(expected.length).toBeGreaterThan(1);
    expect(total).toBe(expected.length);
    expect(rows).toHaveLength(Math.min(expected.length, 100));
    for (const row of rows) {
      expect(row.value).not.toBeNull();
      expect(row.value!).toBeGreaterThanOrEqual(second.value);
      expect(expected.some((e) => e.playerId === row.playerId && e.matchId === row.matchId)).toBe(true);
    }
  });

  it('a single-game lte threshold excludes the non-qualifying record holder', async () => {
    const [pick] = await sql<{ season: number; max: number }[]>`
      SELECT m.season, max(s.goals) AS max
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE s.goals IS NOT NULL
       GROUP BY m.season ORDER BY count(*) DESC LIMIT 1
    `;
    const bound = pick.max - 1;
    const { rows, total } = await game({
      metric: 'goals', agg: { kind: 'list' }, limit: 100,
      scope: { seasonMin: pick.season, seasonMax: pick.season },
      metricCondition: { op: 'lte', value: bound },
    }, 100);

    const [expected] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE m.season = ${pick.season} AND s.goals <= ${bound}
    `;
    expect(expected.count).toBeGreaterThan(1);
    expect(total).toBe(expected.count);
    // NULL is "not recorded", never zero: no NULL row can qualify, and
    // the season's record performance is above the bound and excluded.
    expect(rows.every((r) => r.value !== null && r.value <= bound)).toBe(true);
  });

  it('a scoped-sum threshold qualifies the aggregate after aggregation, per player', async () => {
    const [org] = await sql<{ id: number }[]>`SELECT id FROM club_organizations ORDER BY id LIMIT 1`;
    const totals = await sql<{ playerId: number; value: number }[]>`
      SELECT s.player_id AS "playerId", sum(s.goals)::int AS value
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE (CASE WHEN m.home_club_id = s.club_id THEN m.away_club_id ELSE m.home_club_id END)
               IN (SELECT id FROM clubs WHERE organization_id = ${org.id})
         AND s.goals IS NOT NULL
       GROUP BY s.player_id
       ORDER BY value DESC
    `;
    expect(totals.length).toBeGreaterThan(3);
    const bound = totals[2].value; // at least three qualifying players
    const expectedIds = totals.filter((t) => t.value >= bound).map((t) => t.playerId);

    const { rows, total } = await game({
      metric: 'goals', agg: { kind: 'list' }, mode: 'sum', limit: 100,
      scope: { clubAgainst: { organizationId: org.id, slug: 'x', name: 'x' } },
      metricCondition: { op: 'gte', value: bound },
    }, 100);

    expect(total).toBe(expectedIds.length);
    expect(new Set(rows.map((r) => r.playerId))).toEqual(new Set(expectedIds.slice(0, 100)));
    expect(rows.every((r) => r.value !== null && r.value >= bound)).toBe(true);
  });

  it('a season-aggregate threshold matches a hand-written filter over season totals', async () => {
    const [yr] = await sql<{ season: number }[]>`
      SELECT season FROM player_season_stats WHERE goals IS NOT NULL
       GROUP BY season ORDER BY count(*) DESC LIMIT 1
    `;
    const [third] = await sql<{ value: number }[]>`
      SELECT DISTINCT goals AS value FROM player_season_stats
       WHERE season = ${yr.season} AND goals IS NOT NULL
       ORDER BY goals DESC OFFSET 2 LIMIT 1
    `;
    const { rows, total } = await season({
      metric: 'goals', agg: { kind: 'list' }, limit: 100,
      scope: { seasonMin: yr.season, seasonMax: yr.season },
      metricCondition: { op: 'gt', value: third.value },
    }, 100);

    const expected = await sql<{ playerId: number; goals: number }[]>`
      SELECT player_id AS "playerId", goals FROM player_season_stats
       WHERE season = ${yr.season} AND goals > ${third.value}
       ORDER BY goals DESC
    `;
    expect(expected.length).toBeGreaterThan(1);
    expect(total).toBe(expected.length);
    expect(new Set(rows.map((r) => r.playerId))).toEqual(new Set(expected.map((e) => e.playerId)));
    expect(rows.every((r) => r.value !== null && r.value > third.value)).toBe(true);
  });

  it('a strict less-than threshold excludes the boundary value itself', async () => {
    // lt was the one comparator the suite did not prove against SQL. The
    // bound is the season's record value, so lt excludes the record rows
    // that lte would include -- the strict boundary is what's under test.
    const [pick] = await sql<{ season: number; max: number }[]>`
      SELECT m.season, max(s.goals) AS max
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE s.goals IS NOT NULL
       GROUP BY m.season ORDER BY count(*) DESC LIMIT 1
    `;
    const { rows, total } = await game({
      metric: 'goals', agg: { kind: 'list' }, limit: 100,
      scope: { seasonMin: pick.season, seasonMax: pick.season },
      metricCondition: { op: 'lt', value: pick.max },
    }, 100);

    const [expected] = await sql<{ strict: number; inclusive: number }[]>`
      SELECT count(*) FILTER (WHERE s.goals < ${pick.max})::int AS strict,
             count(*) FILTER (WHERE s.goals <= ${pick.max})::int AS inclusive
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE m.season = ${pick.season} AND s.goals IS NOT NULL
    `;
    expect(expected.strict).toBeGreaterThan(0);
    expect(expected.strict).toBeLessThan(expected.inclusive); // < genuinely excludes the boundary
    expect(total).toBe(expected.strict);
    expect(rows.every((r) => r.value !== null && r.value < pick.max)).toBe(true);
  });

  it('a capped threshold list with ties returns identical row identities and order on repeated execution', async () => {
    // A common exact value gives well over 100 tied qualifying rows, so
    // the 100-row display cap is exercised and only the deterministic
    // final tie-breakers (matchDate, matchId, playerId) decide which rows
    // appear and in what order.
    const [pick] = await sql<{ goals: number }[]>`
      SELECT goals FROM player_match_stats
       WHERE goals IS NOT NULL AND goals > 0
       GROUP BY goals HAVING count(*) > 150
       ORDER BY goals DESC LIMIT 1
    `;
    const overrides = {
      metric: 'goals', agg: { kind: 'list' }, limit: 100,
      metricCondition: { op: 'eq', value: pick.goals },
    } as const;
    const first = await game(overrides, 100);
    const second = await game(overrides, 100);

    expect(first.total).toBeGreaterThan(100);
    expect(first.rows).toHaveLength(100);
    const identity = (r: { playerId: number; matchId: number | null }) => `${r.playerId}:${r.matchId}`;
    expect(second.rows.map(identity)).toEqual(first.rows.map(identity));
    expect(second.total).toBe(first.total);
  });

  it('an exact-value season threshold returns exactly the eq set', async () => {
    const [pick] = await sql<{ season: number; goals: number; count: number }[]>`
      SELECT season, goals, count(*)::int AS count FROM player_season_stats
       WHERE goals IS NOT NULL AND goals > 0
       GROUP BY season, goals HAVING count(*) >= 2
       ORDER BY goals DESC LIMIT 1
    `;
    const { rows, total } = await season({
      metric: 'goals', agg: { kind: 'list' }, limit: 100,
      scope: { seasonMin: pick.season, seasonMax: pick.season },
      metricCondition: { op: 'eq', value: pick.goals },
    }, 100);
    expect(total).toBe(pick.count);
    expect(rows.every((r) => r.value === pick.goals)).toBe(true);
  });
});

describe('AFLDB-ISSUE-110 end-to-end natural-language threshold proof', () => {
  const RUN_TAG = E2E_RUN_TAG;

  it('answers an exact question through parser -> validation -> execution -> description', async () => {
    // The bound is the second-highest distinct single-game goals value, so
    // several performances qualify and the old rank-one collapse (or a
    // dropped predicate) cannot produce the same rows/total/headline.
    const [second] = await sql<{ value: number }[]>`
      SELECT DISTINCT goals AS value FROM player_match_stats
       WHERE goals IS NOT NULL ORDER BY goals DESC OFFSET 1 LIMIT 1
    `;
    const answer = await answerNlQuestion(`players with at least ${second.value} goals in a game`, null, RUN_TAG);
    expect(answer).not.toBeNull();
    if (!answer || answer.payload.kind !== 'player_game') throw new Error('expected a player_game answer');

    const expected = await sql<{ playerId: number; matchId: number }[]>`
      SELECT player_id AS "playerId", match_id AS "matchId"
        FROM player_match_stats WHERE goals >= ${second.value}
    `;
    expect(expected.length).toBeGreaterThan(1);
    expect(answer.payload.total).toBe(expected.length);
    expect(answer.payload.rows).toHaveLength(Math.min(expected.length, 100));
    for (const row of answer.payload.rows) {
      expect(row.value !== null && row.value >= second.value).toBe(true);
      expect(expected.some((e) => e.playerId === row.playerId && e.matchId === row.matchId)).toBe(true);
    }
    expect(answer.headline).toBe(
      `${expected.length.toLocaleString('en-AU')} qualifying ${expected.length === 1 ? 'performance' : 'performances'}`,
    );
    expect(answer.interpretation).toBe(`Single-game goals at least ${second.value.toLocaleString('en-AU')}.`);
  });

  it('answers the review\'s exact opponent-scoped wording without discarding the opponent', async () => {
    // "players with more than 2 goals against Carlton" is the HIGH
    // scope-discarding wording: it must qualify each player's aggregate
    // goals AGAINST CARLTON, never whole-career goals.
    const [carlton] = await sql<{ id: number }[]>`SELECT id FROM club_organizations WHERE slug = 'carlton'`;
    const answer = await answerNlQuestion('players with more than 2 goals against Carlton', null, RUN_TAG);
    expect(answer).not.toBeNull();
    if (!answer || answer.payload.kind !== 'player_game') throw new Error('expected a player_game answer');

    const truth = await sql<{ playerId: number; value: number }[]>`
      SELECT s.player_id AS "playerId", sum(s.goals)::int AS value
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE (CASE WHEN m.home_club_id = s.club_id THEN m.away_club_id ELSE m.home_club_id END)
               IN (SELECT id FROM clubs WHERE organization_id = ${carlton.id})
         AND s.goals IS NOT NULL
       GROUP BY s.player_id
      HAVING sum(s.goals) > 2
    `;
    expect(truth.length).toBeGreaterThan(1);
    expect(answer.payload.total).toBe(truth.length);
    const truthIds = new Set(truth.map((t) => t.playerId));
    for (const row of answer.payload.rows) {
      expect(row.value !== null && row.value > 2).toBe(true);
      expect(truthIds.has(row.playerId)).toBe(true);
      expect(row.games).not.toBeNull(); // sum-mode rows: a scoped total, not one match
    }
    expect(answer.headline).toBe(
      `${truth.length.toLocaleString('en-AU')} ${truth.length === 1 ? 'player qualifies' : 'players qualify'}`,
    );
    expect(answer.interpretation).toBe('Total goals more than 2 across the matches in scope.');
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
