import { describe, expect, it } from 'vitest';

import {
  decodePlanToken,
  describePlan,
  encodePlanToken,
  NL_LIMITS,
  validatePlan,
  type NlQueryPlan,
} from '@/search/nl/plan';

function basePlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
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

describe('validatePlan', () => {
  it('accepts a well-formed plan unchanged (aside from clamping)', () => {
    const result = validatePlan(basePlan());
    expect('error' in result).toBe(false);
  });

  it('rejects an unknown grain', () => {
    const result = validatePlan({ ...basePlan(), grain: 'nonsense' as never });
    expect(result).toHaveProperty('error');
  });

  it('rejects a metric not in the grain\'s allowlist', () => {
    const result = validatePlan(basePlan({ metric: 'win_margin' })); // team_match metric, wrong grain
    expect(result).toHaveProperty('error');
  });

  it('requires mode on a player_game plan, and forbids it elsewhere', () => {
    const noMode = validatePlan(basePlan({ grain: 'player_game', metric: 'goals' }));
    expect(noMode).toHaveProperty('error');

    const wrongGrainMode = validatePlan(basePlan({ mode: 'single' }));
    expect(wrongGrainMode).toHaveProperty('error');

    const ok = validatePlan(basePlan({ grain: 'player_game', metric: 'goals', mode: 'single' }));
    expect('error' in ok).toBe(false);
  });

  it('rejects career conditions on a non-career grain', () => {
    const result = validatePlan(basePlan({
      grain: 'player_game', metric: 'goals', mode: 'single',
      careerConditions: [{ kind: 'column', column: 'games', op: 'gte', value: 100 }],
    }));
    expect(result).toHaveProperty('error');
  });

  it('caps the number of career conditions and predicates', () => {
    const tooMany = validatePlan(basePlan({
      careerConditions: Array.from({ length: NL_LIMITS.maxCareerConditions + 1 }, () => (
        { kind: 'column' as const, column: 'games' as const, op: 'gte' as const, value: 1 }
      )),
    }));
    expect(tooMany).toHaveProperty('error');
  });

  it('rejects an unknown career column, award key or grid builder', () => {
    expect(validatePlan(basePlan({
      careerConditions: [{ kind: 'column', column: 'not_a_column' as never, op: 'eq', value: 0 }],
    }))).toHaveProperty('error');

    expect(validatePlan(basePlan({
      careerConditions: [{ kind: 'award_count', awardKey: 'not_an_award' as never, op: 'gte', value: 1 }],
    }))).toHaveProperty('error');

    expect(validatePlan(basePlan({
      careerPredicates: [{ builder: 'not_a_real_builder', params: {} }],
    }))).toHaveProperty('error');
  });

  it('accepts a real award condition and a real grid predicate', () => {
    const award = validatePlan(basePlan({
      metric: 'all_australian_selections',
      careerConditions: [{ kind: 'award_count', awardKey: 'all_australian', op: 'gte', value: 5 }],
    }));
    expect('error' in award).toBe(false);

    const predicate = validatePlan(basePlan({
      careerPredicates: [{ builder: 'premierships_min', params: { times: '3' } }],
    }));
    expect('error' in predicate).toBe(false);
  });

  it('rejects a boundary on a non-career grain, and an unknown boundary shape', () => {
    expect(validatePlan(basePlan({
      grain: 'player_game', metric: 'goals', mode: 'single',
      boundary: { event: 'debut', where: 'grand_final' },
    }))).toHaveProperty('error');

    expect(validatePlan(basePlan({
      boundary: { event: 'nonsense' as never, where: 'grand_final' },
    }))).toHaveProperty('error');
  });

  it('rejects a malformed entity reference', () => {
    expect(validatePlan(basePlan({
      scope: { clubFor: { organizationId: 0, slug: 'x', name: 'X' } },
    }))).toHaveProperty('error');

    expect(validatePlan(basePlan({
      scope: { venue: { id: -1, slug: 'x', name: 'X' } },
    }))).toHaveProperty('error');
  });

  it('rejects an unknown match type', () => {
    expect(validatePlan(basePlan({ scope: { matchType: 'nonsense' as never } }))).toHaveProperty('error');
  });

  it('rejects an out-of-range or backwards season', () => {
    expect(validatePlan(basePlan({ scope: { seasonMin: 1800 } }))).toHaveProperty('error');
    expect(validatePlan(basePlan({ scope: { seasonMax: 2200 } }))).toHaveProperty('error');
    expect(validatePlan(basePlan({ scope: { seasonMin: 2000, seasonMax: 1990 } }))).toHaveProperty('error');
  });

  it('declines an era-limited metric whose coverage starts after the requested range', () => {
    const result = validatePlan(basePlan({
      grain: 'player_game', metric: 'tackles', mode: 'single',
      scope: { seasonMin: 1950, seasonMax: 1960 },
    }));
    expect(result).toHaveProperty('error');
    if ('error' in result) expect(result.error).toMatch(/1987/);
  });

  it('allows an era-limited metric when the range overlaps its coverage', () => {
    const result = validatePlan(basePlan({
      grain: 'player_game', metric: 'tackles', mode: 'single',
      scope: { seasonMin: 1980, seasonMax: 1990 },
    }));
    expect('error' in result).toBe(false);
  });

  it('clamps top_n to the configured maximum rather than rejecting it', () => {
    const result = validatePlan(basePlan({ agg: { kind: 'top_n', n: 999 } }));
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.agg).toEqual({ kind: 'top_n', n: NL_LIMITS.maxTopN });
  });

  it('rejects a non-positive top_n', () => {
    expect(validatePlan(basePlan({ agg: { kind: 'top_n', n: 0 } }))).toHaveProperty('error');
  });

  it('clamps limit to the tied-rows cap for max/min, and the list cap for top_n/list', () => {
    const maxPlan = validatePlan(basePlan({ agg: { kind: 'max' }, limit: 9999 }));
    if (!('error' in maxPlan)) expect(maxPlan.limit).toBe(NL_LIMITS.maxTiedRows);

    const listPlan = validatePlan(basePlan({ agg: { kind: 'list' }, limit: 9999 }));
    if (!('error' in listPlan)) expect(listPlan.limit).toBe(NL_LIMITS.maxListRows);
  });

  it('accepts only executable grouped team-result shapes', () => {
    const grouped = basePlan({
      grain: 'team_match', metric: null, agg: { kind: 'list' },
      havingClause: { metric: 'losses', op: 'gte', value: 5 },
      matchFilter: { metric: 'loss_margin', op: 'gt', value: 100 },
    });
    expect(validatePlan(grouped)).not.toHaveProperty('error');
    expect(validatePlan({ ...grouped, agg: { kind: 'max' } })).toHaveProperty('error');
    expect(validatePlan({ ...grouped, grain: 'club_season' })).toHaveProperty('error');
    expect(validatePlan({
      ...grouped,
      havingClause: { metric: 'wins', op: 'gte', value: 5 },
    })).toHaveProperty('error');
  });

  it('rejects plan fields on grains whose compilers cannot consume them', () => {
    expect(validatePlan(basePlan({
      grain: 'player_season', metric: 'goals', periodSplit: 'Q1',
    }))).toEqual({ error: 'Quarter-by-quarter player statistics are not currently available to rank.' });
    expect(validatePlan(basePlan({
      streakDefinition: { kind: 'win' },
    }))).toHaveProperty('error');
    expect(validatePlan(basePlan({
      grain: 'player_game', metric: 'goals', mode: 'single', debutGame: true,
    }))).not.toHaveProperty('error');
    expect(validatePlan(basePlan({ debutGame: true }))).toHaveProperty('error');
  });

  it('limits period splits to meaningful team scoring metrics', () => {
    expect(validatePlan(basePlan({
      grain: 'team_match', metric: 'team_score', periodSplit: 'H2',
    }))).not.toHaveProperty('error');
    expect(validatePlan(basePlan({
      grain: 'team_match', metric: 'attendance', periodSplit: 'Q1',
    }))).toHaveProperty('error');
  });

  it('never throws on a wildly malformed plan', () => {
    expect(() => validatePlan({} as NlQueryPlan)).not.toThrow();
  });
});

describe('describePlan', () => {
  it('produces a non-empty, ordered trace including every set field', () => {
    const plan = basePlan({
      grain: 'player_game', mode: 'single', metric: 'disposals',
      agg: { kind: 'top_n', n: 5 },
      player: { id: 1, slug: 'dustin-martin', name: 'Dustin Martin' },
      scope: {
        clubAgainst: { organizationId: 2, slug: 'carlton', name: 'Carlton' },
        venue: { id: 1, slug: 'mcg', name: 'Melbourne Cricket Ground' },
        seasonMin: 1980,
      },
    });
    const lines = describePlan(plan);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.some((l) => l.includes('Dustin Martin'))).toBe(true);
    expect(lines.some((l) => l.includes('Carlton'))).toBe(true);
    expect(lines.some((l) => l.includes('Melbourne Cricket Ground'))).toBe(true);
    expect(lines.some((l) => l.includes('1980'))).toBe(true);
  });

  it('describes career conditions and predicates in plain words', () => {
    const plan = basePlan({
      metric: null,
      careerConditions: [{ kind: 'column', column: 'premierships', op: 'eq', value: 0 }],
      careerPredicates: [{ builder: 'played_a_grand_final', params: {} }],
    });
    const lines = describePlan(plan);
    expect(lines.some((l) => /premierships.*exactly 0/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes('Played a grand final'))).toBe(true);
  });

  it('uses the answer grain in tie prose and describes grouped counts without a fake metric', () => {
    const matchLines = describePlan(basePlan({ grain: 'team_match', metric: 'team_score' }));
    expect(matchLines).toContain('Ties: every match sharing the value is included.');
    expect(matchLines.join(' ')).not.toContain('every player');

    const groupedLines = describePlan(basePlan({
      grain: 'team_match', metric: null, agg: { kind: 'list' },
      havingClause: { metric: 'wins', op: 'gt', value: 3 },
    }));
    expect(groupedLines).toContain('Grouped clubs by wins and kept counts more than 3.');
    expect(groupedLines.some((line) => line.startsWith('Ties:'))).toBe(false);
  });
});

describe('plan token round-trip', () => {
  it('encodes and decodes a plan losslessly', () => {
    const plan = basePlan({
      grain: 'team_match', metric: 'win_margin',
      scope: { clubFor: { organizationId: 1, slug: 'richmond', name: 'Richmond' } },
    });
    const token = encodePlanToken(plan);
    const decoded = decodePlanToken(token);
    expect(decoded).toEqual(plan);
  });

  it('returns null for garbage input rather than throwing', () => {
    expect(decodePlanToken('not-valid-base64!!!')).toBeNull();
    expect(decodePlanToken('')).toBeNull();
  });
});
