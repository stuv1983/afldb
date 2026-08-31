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

  describe('metric conditions (AFLDB-ISSUE-110)', () => {
    it.each([
      ['player_game single', { grain: 'player_game', metric: 'goals', mode: 'single' }],
      ['player_game sum', { grain: 'player_game', metric: 'disposals', mode: 'sum' }],
      ['player_season', { grain: 'player_season', metric: 'goals' }],
    ] as const)('accepts a %s list qualified by a metric condition', (_label, shape) => {
      for (const op of ['gte', 'lte', 'gt', 'lt', 'eq'] as const) {
        const result = validatePlan(basePlan({
          ...shape, agg: { kind: 'list' }, limit: 100, metricCondition: { op, value: 5 },
        }));
        expect('error' in result, `${_label} ${op}`).toBe(false);
      }
    });

    it('rejects a metric condition on a grain whose compiler cannot consume it', () => {
      expect(validatePlan(basePlan({
        metricCondition: { op: 'gte', value: 5 }, agg: { kind: 'list' }, metric: null,
        careerConditions: [{ kind: 'column', column: 'games', op: 'gte', value: 1 }],
      }))).toHaveProperty('error');
      expect(validatePlan(basePlan({
        grain: 'team_match', metric: 'win_margin',
        metricCondition: { op: 'gte', value: 5 },
      }))).toHaveProperty('error');
    });

    it('rejects a malformed comparator or value', () => {
      expect(validatePlan(basePlan({
        grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'list' },
        metricCondition: { op: 'between' as never, value: 5 },
      }))).toHaveProperty('error');
      expect(validatePlan(basePlan({
        grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'list' },
        metricCondition: { op: 'gte', value: Number.NaN },
      }))).toHaveProperty('error');
      expect(validatePlan(basePlan({
        grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'list' },
        metricCondition: { op: 'gte', value: -1 },
      }))).toHaveProperty('error');
    });

    it('rejects a ranked aggregation alongside a metric condition', () => {
      expect(validatePlan(basePlan({
        grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'max' },
        metricCondition: { op: 'gte', value: 5 },
      }))).toHaveProperty('error');
    });

    it('still requires mode on a player_game metric-condition plan', () => {
      expect(validatePlan(basePlan({
        grain: 'player_game', metric: 'goals', agg: { kind: 'list' },
        metricCondition: { op: 'gte', value: 5 },
      }))).toHaveProperty('error');
    });

    it('fails a player game/season list with no threshold closed instead of collapsing it to a leader', () => {
      expect(validatePlan(basePlan({ grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'list' } })))
        .toEqual({ error: 'Listing player results needs a qualifying threshold.' });
      expect(validatePlan(basePlan({ grain: 'player_season', metric: 'goals', agg: { kind: 'list' } })))
        .toEqual({ error: 'Listing player results needs a qualifying threshold.' });
    });

    it('rejects a metric condition smuggled into a head-to-head plan', () => {
      expect(validatePlan(basePlan({
        grain: 'head_to_head', metric: null, agg: { kind: 'count' },
        headToHead: { kind: 'record' },
        scope: {
          matchup: {
            clubA: { organizationId: 1, slug: 'a', name: 'A' },
            clubB: { organizationId: 2, slug: 'b', name: 'B' },
          },
        },
        metricCondition: { op: 'gte', value: 1 },
      }))).toHaveProperty('error');
    });

    it('describes the applied threshold in the plan trace', () => {
      const plan = validatePlan(basePlan({
        grain: 'player_game', metric: 'disposals', mode: 'sum', agg: { kind: 'list' }, limit: 100,
        metricCondition: { op: 'lte', value: 25 },
      }));
      if ('error' in plan) throw new Error(plan.error);
      expect(describePlan(plan)).toContain('Condition: disposals at most 25.');
    });
  });

  describe('career-grain scope backstop (AFLDB-ISSUE-110 revision)', () => {
    const SCOPE_ERROR = 'A career question cannot be scoped to a venue, opponent, match type, or round.';
    const SEASON_ERROR = 'A career question cannot be restricted to a season range.';
    const carlton = { organizationId: 2, slug: 'carlton', name: 'Carlton' };

    it('rejects a career-condition plan carrying opponent scope its compiler cannot consume', () => {
      // The exact scope-discarding shape: "players with more than 100
      // games against Carlton" used to validate and answer whole-career
      // games with the opponent silently ignored.
      expect(validatePlan(basePlan({
        metric: null, agg: { kind: 'list' },
        careerConditions: [{ kind: 'column', column: 'games', op: 'gt', value: 100 }],
        scope: { clubAgainst: carlton },
      }))).toEqual({ error: SCOPE_ERROR });
    });

    it('rejects venue, match-type, and round scope on any career plan', () => {
      expect(validatePlan(basePlan({ scope: { venue: { id: 1, slug: 'mcg', name: 'MCG' } } })))
        .toEqual({ error: SCOPE_ERROR });
      expect(validatePlan(basePlan({ scope: { matchType: 'finals' } })))
        .toEqual({ error: SCOPE_ERROR });
      expect(validatePlan(basePlan({ scope: { roundNumber: 5 } })))
        .toEqual({ error: SCOPE_ERROR });
    });

    it('rejects season bounds on every non-predicate career execution path', () => {
      expect(validatePlan(basePlan({
        metric: null, agg: { kind: 'list' },
        careerConditions: [{ kind: 'column', column: 'goals', op: 'gt', value: 500 }],
        scope: { seasonMin: 2000 },
      }))).toEqual({ error: SEASON_ERROR });
      expect(validatePlan(basePlan({
        metric: 'goals', agg: { kind: 'max' },
        scope: { seasonMin: 2000 },
      }))).toEqual({ error: SEASON_ERROR });
      expect(validatePlan(basePlan({
        metric: 'goals', agg: { kind: 'max' },
        scope: { seasonMax: 1999 },
      }))).toEqual({ error: SEASON_ERROR });
      expect(validatePlan(basePlan({
        metric: 'goals', agg: { kind: 'max' },
        scope: { seasonMin: 2000, seasonMax: 2000 },
      }))).toEqual({ error: SEASON_ERROR });
    });

    it('still accepts unscoped all-time, condition-list, and clubFor career shapes', () => {
      expect('error' in validatePlan(basePlan({
        metric: 'goals', agg: { kind: 'max' }, scope: {},
      }))).toBe(false);
      expect('error' in validatePlan(basePlan({
        metric: null, agg: { kind: 'list' },
        careerConditions: [{ kind: 'column', column: 'goals', op: 'gt', value: 500 }],
      }))).toBe(false);
      expect('error' in validatePlan(basePlan({
        metric: 'games', agg: { kind: 'max' },
        scope: { clubFor: carlton },
      }))).toBe(false);
    });
  });

  describe('season-grain scope backstop (AFLDB-ISSUE-110 final review)', () => {
    // answerPlayerSeason consumes player/playerIdIn/season-range/clubFor/
    // metricCondition and nothing else in match scope: a player_season
    // plan carrying any of these four would validate and then silently
    // answer the whole-season question with the scope discarded.
    const SCOPE_ERROR = 'A season total cannot be scoped to a venue, opponent, match type, or round.';
    const carlton = { organizationId: 2, slug: 'carlton', name: 'Carlton' };
    const seasonThreshold = (scope: NlQueryPlan['scope']) => basePlan({
      grain: 'player_season', metric: 'disposals', agg: { kind: 'list' },
      metricCondition: { op: 'gt', value: 20 },
      scope,
    });

    it('rejects opponent scope on a season threshold list its executor cannot consume', () => {
      // The exact HIGH-finding shape: "players with more than 20
      // disposals in a season against Carlton" must not become
      // whole-season disposals against every opponent.
      expect(validatePlan(seasonThreshold({ clubAgainst: carlton }))).toEqual({ error: SCOPE_ERROR });
    });

    it('rejects venue, match-type, and round scope on a season threshold list', () => {
      expect(validatePlan(seasonThreshold({ venue: { id: 30, slug: 'mcg', name: 'MCG' } })))
        .toEqual({ error: SCOPE_ERROR });
      expect(validatePlan(seasonThreshold({ matchType: 'grand_final' }))).toEqual({ error: SCOPE_ERROR });
      expect(validatePlan(seasonThreshold({ roundNumber: 5 }))).toEqual({ error: SCOPE_ERROR });
    });

    it('rejects the same scope on a ranked season leaderboard, not just threshold lists', () => {
      expect(validatePlan(basePlan({
        grain: 'player_season', metric: 'goals', agg: { kind: 'max' },
        scope: { matchType: 'finals' },
      }))).toEqual({ error: SCOPE_ERROR });
      expect(validatePlan(basePlan({
        grain: 'player_season', metric: 'goals', agg: { kind: 'max' },
        scope: { clubAgainst: carlton },
      }))).toEqual({ error: SCOPE_ERROR });
    });

    it('still accepts the season shapes the executor genuinely consumes', () => {
      expect('error' in validatePlan(seasonThreshold({}))).toBe(false);
      expect('error' in validatePlan(seasonThreshold({ seasonMin: 1989, seasonMax: 1989 }))).toBe(false);
      expect('error' in validatePlan(seasonThreshold({ clubFor: carlton }))).toBe(false);
      expect('error' in validatePlan(basePlan({
        grain: 'player_season', metric: 'goals', agg: { kind: 'max' },
        scope: { clubFor: carlton, seasonMin: 2017, seasonMax: 2017 },
      }))).toBe(false);
    });
  });

  describe('player-season tie policy (AFLDB-ISSUE-110)', () => {
    it('keeps the executor-supported all-ties policy valid', () => {
      expect(validatePlan(basePlan({
        grain: 'player_season', metric: 'goals', agg: { kind: 'max' }, tiePolicy: 'all',
      }))).not.toHaveProperty('error');
    });

    it('rejects first-tie selection until the player-season executor supports it', () => {
      expect(validatePlan(basePlan({
        grain: 'player_season', metric: 'goals', agg: { kind: 'max' }, tiePolicy: 'first',
      }))).toEqual({ error: 'Player-season questions do not support first-tie selection.' });
    });
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
