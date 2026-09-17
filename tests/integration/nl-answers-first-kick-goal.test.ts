/**
 * The first-kick-goal family against the real `afldb_test` database
 * (AFLDB-ISSUE-152 Phase E).
 *
 * This suite exists because the family had never been executed against
 * data at all (Finding F4): `player_achievements` was empty in
 * `afldb_test`, so every first-kick-goal assertion in the repository was a
 * parse-shape assertion. The curated extract is now loaded by the
 * supported loader (D11), and each answer below is compared against
 * INDEPENDENTLY HAND-WRITTEN SQL -- two code paths agreeing is evidence,
 * one code path agreeing with itself is not -- and, where the public
 * records board answers the same question, against that board as well.
 *
 * The two rules this suite exists to protect:
 *
 *  - NL counts LINKED rows only, so its answer is deliberately a subset of
 *    /records/first-kick-goal, which lists unlinked rows too;
 *  - "only career GOAL" and "never kicked again" are different claims
 *    (no_further_career_goals vs no_further_career_kicks) and must never
 *    return the same population.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { getFirstKickGoalList, getFirstKickGoalSummary } from '@/db/queries/player-achievements';
import { validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlPlayerCareerRow } from '@/search/nl/answer-types';

afterAll(async () => {
  await sql.end();
});

/**
 * The D11 load measured on 2026-09-08, recorded here as the fixture
 * contract. A reload that changes these numbers must be a deliberate
 * decision, not a silent one, which is why they are asserted once rather
 * than woven through every other test.
 */
const M_E1 = {
  total: 334,
  linked: 330,
  multiKick: 44,
  maxConsecutive: 6,
  onlyCareerGoal: 23,
  noFurtherKicks: 4,
  minSeason: 1911,
  maxSeason: 2026,
} as const;

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
    limit: 500,
    ...overrides,
  };
  const validated = validatePlan(raw);
  if ('error' in validated) throw new Error(`test plan failed validation: ${validated.error}`);
  return validated;
}

async function career(p: NlQueryPlan, limit = 500): Promise<{
  lead: NlPlayerCareerRow | null; rows: NlPlayerCareerRow[]; total: number;
}> {
  const payload: NlAnswerPayload = await answerPlayerCareer(p, limit);
  if (payload.kind !== 'player_career') throw new Error(`expected player_career, got ${payload.kind}`);
  return payload;
}

/** One hand-written scalar, written against the tables directly. */
async function scalar(query: Promise<{ n: string | number }[]>): Promise<number> {
  const [row] = await query;
  return Number(row?.n ?? 0);
}

const CONSECUTIVE = (kicks: number) => ({
  builder: 'first_kick_goal_consecutive_min', params: { kicks: String(kicks) },
});
const ONLY_GOAL = { builder: 'first_kick_goal_only_career_goal', params: {} };
const HOLDER = { builder: 'first_kick_goal_player', params: {} };

// ---------------------------------------------------------------- the fixture

describe('the loaded curated extract (D11 / M-E1)', () => {
  it('matches the measurement the corpus thresholds were finalised from', async () => {
    const [row] = await sql<{
      total: string; linked: string; multi_kick: string; max_consecutive: number;
      only_career_goal: string; no_further_kicks: string; min_season: number; max_season: number;
    }[]>`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE player_id IS NOT NULL
                                AND link_status_value IN ('unique','resolved')) AS linked,
             count(*) FILTER (WHERE consecutive_goal_kicks > 1) AS multi_kick,
             max(consecutive_goal_kicks) AS max_consecutive,
             count(*) FILTER (WHERE no_further_career_goals) AS only_career_goal,
             count(*) FILTER (WHERE no_further_career_kicks) AS no_further_kicks,
             min(season) AS min_season, max(season) AS max_season
        FROM player_achievements WHERE achievement_type = 'first_kick_goal'
    `;
    expect(Number(row.total)).toBe(M_E1.total);
    expect(Number(row.linked)).toBe(M_E1.linked);
    expect(Number(row.multi_kick)).toBe(M_E1.multiKick);
    expect(Number(row.max_consecutive)).toBe(M_E1.maxConsecutive);
    expect(Number(row.only_career_goal)).toBe(M_E1.onlyCareerGoal);
    expect(Number(row.no_further_kicks)).toBe(M_E1.noFurtherKicks);
    expect(Number(row.min_season)).toBe(M_E1.minSeason);
    expect(Number(row.max_season)).toBe(M_E1.maxSeason);
  });

  /**
   * R6, the invariant §17.5's composition argument rests on: two IN
   * subqueries over player_achievements cannot combine DIFFERENT rows,
   * because there is at most one first-kick-goal row per person for this
   * source (player_achievements_source_uq over the tracked manifest).
   * Asserted against the data rather than argued from the schema.
   */
  it('holds at most one first-kick-goal row per linked player', async () => {
    const duplicated = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM (
        SELECT player_id FROM player_achievements
         WHERE achievement_type = 'first_kick_goal' AND player_id IS NOT NULL
         GROUP BY player_id HAVING count(*) > 1
      ) d
    `);
    expect(duplicated).toBe(0);
  });
});

// ------------------------------------------------------------ W1 - W5, E1-E6

describe('the already-supported subfamilies, now proven against data', () => {
  it('W1 "players who kicked a goal with their first kick" == the linked population', async () => {
    const { total } = await career(plan({ careerPredicates: [HOLDER] }));

    // Independently written: EXISTS over the same universe the answer
    // draws from (players with a career-stats row), not the compiler's IN.
    const expected = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE EXISTS (SELECT 1 FROM player_achievements a
                      WHERE a.player_id = p.id AND a.achievement_type = 'first_kick_goal'
                        AND a.link_status_value IN ('unique','resolved'))
    `);
    expect(total).toBe(expected);
    // And it is the linked total from M-E1: a difference would mean a
    // linked achievement whose player has no career-stats row at all.
    expect(total).toBe(M_E1.linked);
  });

  it('W2 a named holder answers about that player alone', async () => {
    const [holder] = await sql<{ id: number; slug: string; name: string }[]>`
      SELECT p.id, p.slug, p.display_name AS name
        FROM player_achievements a JOIN players p ON p.id = a.player_id
       WHERE a.achievement_type = 'first_kick_goal'
         AND a.link_status_value IN ('unique','resolved')
       ORDER BY a.season LIMIT 1
    `;
    expect(holder).toBeTruthy();

    const { rows, total } = await career(plan({ player: holder, careerPredicates: [HOLDER] }));
    expect(total).toBe(1);
    expect(rows.map((r) => r.playerId)).toEqual([holder.id]);
  });

  it('W3 a non-holder answers 0 rows, with the player still pinned', async () => {
    const [other] = await sql<{ id: number; slug: string; name: string }[]>`
      SELECT p.id, p.slug, p.display_name AS name
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE NOT EXISTS (SELECT 1 FROM player_achievements a
                          WHERE a.player_id = p.id AND a.achievement_type = 'first_kick_goal')
       ORDER BY c.games DESC LIMIT 1
    `;
    const p = plan({ player: other, careerPredicates: [HOLDER] });
    expect(p.player?.id).toBe(other.id);
    expect((await career(p)).total).toBe(0);
  });

  it('W4 a club filter matches the records board, filtered to linked rows', async () => {
    const [club] = await sql<{ organization_id: number; slug: string; n: string }[]>`
      SELECT cl.organization_id, min(cl.slug) AS slug, count(*) AS n
        FROM player_achievements a JOIN clubs cl ON cl.id = a.club_id
       WHERE a.achievement_type = 'first_kick_goal'
         AND a.player_id IS NOT NULL AND a.link_status_value IN ('unique','resolved')
       GROUP BY cl.organization_id ORDER BY count(*) DESC, cl.organization_id LIMIT 1
    `;
    const { total } = await career(plan({
      careerPredicates: [{ builder: 'first_kick_goal_for_club', params: { club: String(club.organization_id) } }],
      scope: { clubFor: { organizationId: club.organization_id, slug: club.slug, name: club.slug } },
    }));

    expect(total).toBe(Number(club.n));
    // The public board answers the same question over a wider population:
    // NL is that answer minus the rows the board shows as unlinked.
    const board = await getFirstKickGoalList({ club: club.slug });
    const boardLinked = board.filter((r) => r.playerId !== null && ['unique', 'resolved'].includes(r.linkStatus));
    expect(total).toBe(boardLinked.length);
  });

  it('W5 a decade filter uses the season the feat happened in', async () => {
    const { total } = await career(plan({
      careerPredicates: [{ builder: 'first_kick_goal_between', params: { from: '1940', to: '1949' } }],
      scope: { seasonMin: 1940, seasonMax: 1949 },
    }));

    expect(total).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(DISTINCT a.player_id) AS n FROM player_achievements a
       WHERE a.achievement_type = 'first_kick_goal'
         AND a.player_id IS NOT NULL AND a.link_status_value IN ('unique','resolved')
         AND a.season BETWEEN 1940 AND 1949
    `));
    expect(total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- E7: W6, W7

describe('E7 — a goal with each of their first N kicks', () => {
  it.each([2, 3, 4, 6])('N = %s matches consecutive_goal_kicks >= N, linked only', async (kicks) => {
    const { total } = await career(plan({ careerPredicates: [CONSECUTIVE(kicks)] }));

    expect(total).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(DISTINCT a.player_id) AS n FROM player_achievements a
       WHERE a.achievement_type = 'first_kick_goal'
         AND a.player_id IS NOT NULL AND a.link_status_value IN ('unique','resolved')
         AND a.consecutive_goal_kicks >= ${kicks}
    `));
    // Every one of these is a real, non-empty population on the loaded
    // extract (max_consecutive = 6), so an empty answer here is a defect,
    // not a data fact.
    expect(total).toBeGreaterThan(0);
  });

  it('W6 N = 2 is the records board\'s own multi-kick feature, filtered to linked', async () => {
    const { total } = await career(plan({ careerPredicates: [CONSECUTIVE(2)] }));
    const board = await getFirstKickGoalList({ feature: 'multi-kick' });
    const boardLinked = board.filter((r) => r.playerId !== null && ['unique', 'resolved'].includes(r.linkStatus));
    expect(total).toBe(boardLinked.length);
  });

  it('W7 N = max + 1 is a measured empty, not a silently wider answer', async () => {
    const { total, rows } = await career(plan({ careerPredicates: [CONSECUTIVE(M_E1.maxConsecutive + 1)] }));
    expect(total).toBe(0);
    expect(rows).toEqual([]);
    expect(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_achievements
       WHERE achievement_type = 'first_kick_goal'
         AND consecutive_goal_kicks >= ${M_E1.maxConsecutive + 1}
    `)).toBe(0);
  });

  it('the bound is strictly narrowing: N = 6 is a subset of N = 2 is a subset of the family', async () => {
    const six = await career(plan({ careerPredicates: [CONSECUTIVE(6)] }));
    const two = await career(plan({ careerPredicates: [CONSECUTIVE(2)] }));
    const all = await career(plan({ careerPredicates: [HOLDER] }));
    expect(six.total).toBeLessThan(two.total);
    expect(two.total).toBeLessThan(all.total);
    const twoIds = new Set(two.rows.map((r) => r.playerId));
    for (const row of six.rows) expect(twoIds.has(row.playerId), row.displayName).toBe(true);
  });
});

// ------------------------------------------------------------ E8: W8, W11, W12

describe('E8 — the first-kick goal was their only career goal', () => {
  it('W8 matches no_further_career_goals, linked only, and the board\'s own feature', async () => {
    const { total } = await career(plan({ careerPredicates: [ONLY_GOAL] }));

    expect(total).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(DISTINCT a.player_id) AS n FROM player_achievements a
       WHERE a.achievement_type = 'first_kick_goal'
         AND a.player_id IS NOT NULL AND a.link_status_value IN ('unique','resolved')
         AND a.no_further_career_goals
    `));
    expect(total).toBeGreaterThan(0);

    const board = await getFirstKickGoalList({ feature: 'only-career-goal' });
    const boardLinked = board.filter((r) => r.playerId !== null && ['unique', 'resolved'].includes(r.linkStatus));
    expect(total).toBe(boardLinked.length);
  });

  /**
   * W11. The whole reason E9 stays declined: `no_further_career_goals` and
   * `no_further_career_kicks` are different claims about different things.
   * On the loaded extract they are 23 and 4 rows, so the inequality is
   * measured, not argued.
   */
  it('W11 is not the kick-level claim E9 declines', async () => {
    const goals = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_achievements
       WHERE achievement_type = 'first_kick_goal' AND no_further_career_goals
    `);
    const kicks = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_achievements
       WHERE achievement_type = 'first_kick_goal' AND no_further_career_kicks
    `);
    expect(goals).not.toBe(kicks);
    expect(goals).toBe(M_E1.onlyCareerGoal);
    expect(kicks).toBe(M_E1.noFurtherKicks);
  });

  it('W12 the NL totals are the board summary minus its unlinked rows', async () => {
    const summary = await getFirstKickGoalSummary();
    expect(summary.total).toBe(M_E1.total);
    expect(summary.unlinked).toBe(M_E1.total - M_E1.linked);

    const multiKickUnlinked = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_achievements
       WHERE achievement_type = 'first_kick_goal' AND consecutive_goal_kicks > 1
         AND NOT (player_id IS NOT NULL AND link_status_value IN ('unique','resolved'))
    `);
    const onlyGoalUnlinked = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_achievements
       WHERE achievement_type = 'first_kick_goal' AND no_further_career_goals
         AND NOT (player_id IS NOT NULL AND link_status_value IN ('unique','resolved'))
    `);

    expect((await career(plan({ careerPredicates: [CONSECUTIVE(2)] }))).total)
      .toBe(summary.multiKick - multiKickUnlinked);
    expect((await career(plan({ careerPredicates: [ONLY_GOAL] }))).total)
      .toBe(summary.onlyCareerGoal - onlyGoalUnlinked);
  });
});

// ------------------------------------------------------------- W9, W10, W13

describe('composition and the link boundary', () => {
  it('W9 E7 + club is the single ANDed query, not two independent ones', async () => {
    const [club] = await sql<{ organization_id: number; slug: string; n: string }[]>`
      SELECT cl.organization_id, min(cl.slug) AS slug, count(*) AS n
        FROM player_achievements a JOIN clubs cl ON cl.id = a.club_id
       WHERE a.achievement_type = 'first_kick_goal'
         AND a.player_id IS NOT NULL AND a.link_status_value IN ('unique','resolved')
         AND a.consecutive_goal_kicks >= 2
       GROUP BY cl.organization_id ORDER BY count(*) DESC, cl.organization_id LIMIT 1
    `;
    const { total } = await career(plan({
      careerPredicates: [
        { builder: 'first_kick_goal_for_club', params: { club: String(club.organization_id) } },
        CONSECUTIVE(2),
      ],
      scope: { clubFor: { organizationId: club.organization_id, slug: club.slug, name: club.slug } },
    }));

    // One hand-written query with BOTH conditions on the SAME row -- which
    // is the claim §17.5 makes and R6 proves: one row per player means two
    // IN subqueries cannot combine different rows.
    expect(total).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(DISTINCT a.player_id) AS n
        FROM player_achievements a JOIN clubs cl ON cl.id = a.club_id
       WHERE a.achievement_type = 'first_kick_goal'
         AND a.player_id IS NOT NULL AND a.link_status_value IN ('unique','resolved')
         AND cl.organization_id = ${club.organization_id}
         AND a.consecutive_goal_kicks >= 2
    `));
    expect(total).toBe(Number(club.n));
  });

  it('W10 E8 + a season range narrows both ways', async () => {
    const { total } = await career(plan({
      careerPredicates: [
        { builder: 'first_kick_goal_between', params: { from: '1911', to: '1970' } },
        ONLY_GOAL,
      ],
      scope: { seasonMin: 1911, seasonMax: 1970 },
    }));

    expect(total).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(DISTINCT a.player_id) AS n FROM player_achievements a
       WHERE a.achievement_type = 'first_kick_goal'
         AND a.player_id IS NOT NULL AND a.link_status_value IN ('unique','resolved')
         AND a.season BETWEEN 1911 AND 1970
         AND a.no_further_career_goals
    `));
    const unscoped = await career(plan({ careerPredicates: [ONLY_GOAL] }));
    expect(total).toBeLessThanOrEqual(unscoped.total);
  });

  /**
   * W13. Four rows of the curated extract are deliberately not linked to a
   * canonical player. Every one of them is absent from every NL answer,
   * which is exactly why the answer states the boundary in its own
   * sentence rather than implying completeness.
   */
  it('W13 no unlinked row reaches an NL answer', async () => {
    const unlinked = await sql<{ id: number; player_id: number | null; name: string }[]>`
      SELECT id, player_id, player_name_clean AS name FROM player_achievements
       WHERE achievement_type = 'first_kick_goal'
         AND NOT (player_id IS NOT NULL AND link_status_value IN ('unique','resolved'))
       ORDER BY id
    `;
    expect(unlinked).toHaveLength(M_E1.total - M_E1.linked);

    const { rows, total } = await career(plan({ careerPredicates: [HOLDER] }));
    expect(total).toBe(M_E1.linked);
    const answered = new Set(rows.map((r) => r.playerId));
    for (const row of unlinked) {
      if (row.player_id !== null) expect(answered.has(row.player_id), row.name).toBe(false);
    }
    // The board is wider by exactly those rows -- stated, never absorbed.
    const board = await getFirstKickGoalList();
    expect(board.length - unlinked.length).toBe(total);
  });
});
