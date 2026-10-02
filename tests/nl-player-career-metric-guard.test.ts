/**
 * AFLDB-ISSUE-256 -- the player_career compiler's own fail-closed guard.
 * validatePlan refuses an unsupported career metric (tests/nl-plan.test.ts),
 * but answerPlayerCareer must not depend on that: an unknown metric, or an
 * entry whose statKey is not a GRID_STATS key, has to stop with an explicit
 * error before GRID_STATS[...] is dereferenced (a TypeError) or the key
 * reaches sql.unsafe as a column that does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // Every fragment and every awaited statement is an empty array, so a
  // supported plan compiles and "returns" no rows without a database.
  const sql = Object.assign(vi.fn(() => []), { unsafe: vi.fn(() => []) });
  return { sql };
});

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({ sql: mocks.sql }));

import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { NL_METRICS, type NlQueryPlan } from '@/search/nl/plan';

const UNSUPPORTED = ['time_on_ground', 'centre_bounce_attendances', 'disposal_efficiency', 'score_involvements'];
const RICHMOND = { organizationId: 1, slug: 'richmond', name: 'Richmond' };

function careerPlan(overrides: Partial<NlQueryPlan>): NlQueryPlan {
  return {
    v: 1,
    grain: 'player_career',
    metric: 'games',
    agg: { kind: 'max' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 25,
    ...overrides,
  };
}

const SHAPES: [string, Partial<NlQueryPlan>][] = [
  ['unscoped', {}],
  ['club-scoped', { scope: { clubFor: RICHMOND } }],
  ['period split', { periodSplit: 'Q1' }],
];

function unsafeArgs(): unknown[] {
  return mocks.sql.unsafe.mock.calls.map((call) => (call as unknown[])[0]);
}

async function rejection(plan: NlQueryPlan): Promise<unknown> {
  try {
    await answerPlayerCareer(plan, 25);
  } catch (error) {
    return error;
  }
  throw new Error(`expected "${plan.metric}" to be refused`);
}

beforeEach(() => {
  mocks.sql.mockClear();
  mocks.sql.unsafe.mockClear();
});

describe('answerPlayerCareer: unknown metric fails closed', () => {
  for (const metric of UNSUPPORTED) {
    it.each(SHAPES)(`${metric} (%s) is refused explicitly, not as a TypeError`, async (_label, shape) => {
      const error = await rejection(careerPlan({ metric, ...shape }));
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe(`player_career metric "${metric}" is not recognised.`);
      expect(unsafeArgs()).not.toContain(metric);
    });
  }
});

describe('answerPlayerCareer: a metric entry with a non-GRID statKey fails closed', () => {
  const PROBE = '__issue256_probe';
  const metrics = NL_METRICS.player_career as Record<string, unknown>;

  afterEach(() => {
    delete metrics[PROBE];
  });

  for (const statKey of UNSUPPORTED) {
    it.each(SHAPES)(`statKey ${statKey} (%s) never reaches GRID_STATS or sql.unsafe`, async (_label, shape) => {
      metrics[PROBE] = { kind: 'column', key: PROBE, label: 'Probe', column: statKey, statKey };
      const error = await rejection(careerPlan({ metric: PROBE, ...shape }));
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe(`player_career metric "${PROBE}" has no stored statistic.`);
      expect(unsafeArgs()).not.toContain(statKey);
    });
  }
});

describe('answerPlayerCareer: supported live career metrics still compile', () => {
  it.each([
    'inside_50s', 'clearances', 'goal_assists', 'frees_for', 'frees_against', 'contested', 'uncontested',
  ])('%s compiles unscoped and club-scoped against its own column', async (metric) => {
    for (const [, shape] of SHAPES.slice(0, 2)) {
      await expect(answerPlayerCareer(careerPlan({ metric, ...shape }), 25))
        .resolves.toEqual({ kind: 'player_career', lead: null, rows: [], total: 0 });
    }
    expect(unsafeArgs()).toContain(metric);
  });
});
