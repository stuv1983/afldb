import { describe, expect, it } from 'vitest';

import {
  afterSirenRequiresMatchLink,
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

    // AFLDB-ISSUE-110 findings A and B: a career predicate exempted a plan
    // from both backstops by existing, but a builder consumes only its own
    // parameters. Ownership is per builder, and a field nothing owns fails
    // closed -- it is never folded into a guessed played_for_club reading.
    describe('career predicate field ownership', () => {
      const CLUB_ERROR = 'This kind of career question cannot be limited to one club.';
      const listPlan = { metric: null, agg: { kind: 'list' } } as const;

      it('rejects a season range no predicate consumes', () => {
        expect(validatePlan(basePlan({
          ...listPlan,
          careerPredicates: [{ builder: 'grand_finals_played_min', params: { times: '3' } }],
          scope: { seasonMin: 2000 },
        }))).toEqual({ error: SEASON_ERROR });
        expect(validatePlan(basePlan({
          ...listPlan,
          careerPredicates: [{ builder: 'premierships_min', params: { times: '2' } }],
          scope: { seasonMin: 1990, seasonMax: 1999 },
        }))).toEqual({ error: SEASON_ERROR });
      });

      it('accepts a season range a predicate takes as a builder parameter', () => {
        expect('error' in validatePlan(basePlan({
          ...listPlan,
          careerPredicates: [{ builder: 'debuted_between', params: { from: '1990', to: '1999' } }],
          scope: { seasonMin: 1990, seasonMax: 1999 },
        }))).toBe(false);
        expect('error' in validatePlan(basePlan({
          ...listPlan,
          careerPredicates: [{ builder: 'first_kick_goal_between', params: { from: '1940', to: '1949' } }],
          scope: { seasonMin: 1940, seasonMax: 1949 },
        }))).toBe(false);
      });

      it('rejects a club no predicate consumes, with or without a season range', () => {
        expect(validatePlan(basePlan({
          ...listPlan,
          careerPredicates: [{ builder: 'debuted_between', params: { from: '2000', to: '2100' } }],
          scope: { clubFor: carlton, seasonMin: 2000 },
        }))).toEqual({ error: CLUB_ERROR });
        expect(validatePlan(basePlan({
          ...listPlan,
          careerPredicates: [{ builder: 'grand_finals_played_min', params: { times: '3' } }],
          scope: { clubFor: carlton },
        }))).toEqual({ error: CLUB_ERROR });
      });

      it('accepts a club a predicate takes as a builder parameter', () => {
        expect('error' in validatePlan(basePlan({
          ...listPlan,
          careerPredicates: [
            { builder: 'first_kick_goal_for_club', params: { club: '2' } },
            { builder: 'first_kick_goal_between', params: { from: '1940', to: '1949' } },
          ],
          scope: { clubFor: carlton, seasonMin: 1940, seasonMax: 1949 },
        }))).toBe(false);
      });

      it('leaves the predicate-free club and predicate-only shapes exactly as they were', () => {
        // No predicates: the compiler's own clubFor filter and club-scoped
        // totals own the club, so the supported-metric gate still decides.
        expect('error' in validatePlan(basePlan({
          metric: 'games', agg: { kind: 'max' }, scope: { clubFor: carlton },
        }))).toBe(false);
        expect(validatePlan(basePlan({
          metric: 'premierships', agg: { kind: 'max' }, scope: { clubFor: carlton },
        }))).toEqual({ error: 'This career statistic cannot currently be totalled for one club.' });
        // A predicate with no season range and no club is untouched.
        expect('error' in validatePlan(basePlan({
          ...listPlan,
          careerPredicates: [{ builder: 'grand_finals_played_min', params: { times: '3' } }],
        }))).toBe(false);
      });
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

  it('calls a scoped total a total, not a single-match performance (AFLDB-ISSUE-110)', () => {
    // "most goals for Geelong" elects player_game in SUM mode -- a
    // club-scoped career total. The explain trace is what tells the
    // reader which question was answered, and the flat grain label
    // called it a single-match search while the answer text underneath
    // correctly said "Total across N games in scope".
    const summed = describePlan(basePlan({
      grain: 'player_game', mode: 'sum', metric: 'goals', agg: { kind: 'max' },
      scope: { clubFor: { organizationId: 4, slug: 'geelong', name: 'Geelong' } },
    }));
    expect(summed[0]).toBe('Searched for the highest total goals.');
    expect(summed).toContain('Club: Geelong.');
    expect(summed.join(' ')).not.toContain('single-match');

    const rankedTotals = describePlan(basePlan({
      grain: 'player_game', mode: 'sum', metric: 'goals', agg: { kind: 'top_n', n: 5 },
    }));
    expect(rankedTotals[0]).toBe('Ranked total goals, the top 5.');

    // Single mode is untouched: it really is one performance.
    const single = describePlan(basePlan({
      grain: 'player_game', mode: 'single', metric: 'goals', agg: { kind: 'max' },
    }));
    expect(single[0]).toBe('Searched for the highest single-match goals.');
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

// ------------------------------------- coach_record (AFLDB-ISSUE-152 B)

const HARDWICK = { id: 17, slug: 'damien-hardwick', name: 'Damien Hardwick', playerId: 900, playerSlug: 'damien-hardwick' };
const RICHMOND = { organizationId: 1, slug: 'richmond', name: 'Richmond' };

function coachPlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return basePlan({ grain: 'coach_record', metric: null, agg: { kind: 'list' }, limit: 100, ...overrides });
}

describe('validatePlan: coach_record', () => {
  it('accepts the four whole-vs-scoped shapes plus a league ranking', () => {
    const shapes: [string, Partial<NlQueryPlan>][] = [
      ['a coach\'s whole career', { coach: HARDWICK }],
      ['a coach at one organization', { coach: HARDWICK, scope: { clubFor: RICHMOND } }],
      ['every coach of an organization', { scope: { clubFor: RICHMOND } }],
      ['a league-wide ranking', { metric: 'games', agg: { kind: 'max' } }],
      ['a count of a club\'s coaches', { scope: { clubFor: RICHMOND }, agg: { kind: 'count' } }],
    ];
    for (const [label, shape] of shapes) {
      expect(validatePlan(coachPlan(shape)), label).not.toHaveProperty('error');
    }
  });

  it('accepts every coaching metric and refuses one from another grain', () => {
    for (const metric of ['games', 'wins', 'draws', 'losses', 'finals', 'grand_finals', 'premierships', 'seasons', 'organizations']) {
      expect(validatePlan(coachPlan({ metric, agg: { kind: 'max' } })), metric).not.toHaveProperty('error');
    }
    expect(validatePlan(coachPlan({ metric: 'disposals', agg: { kind: 'max' } }))).toHaveProperty('error');
  });

  it.each([
    ['player', { player: { id: 1, slug: 'p', name: 'P' } }],
    ['playerIdIn', { scope: { playerIdIn: [1, 2] } }],
    ['clubAgainst', { scope: { clubAgainst: RICHMOND } }],
    ['matchup', { scope: { matchup: { clubA: RICHMOND, clubB: { organizationId: 2, slug: 'carlton', name: 'Carlton' } } } }],
    ['venue', { scope: { venue: { id: 1, slug: 'mcg', name: 'MCG' } } }],
    ['matchType', { scope: { matchType: 'finals' as const } }],
    ['roundNumber', { scope: { roundNumber: 5 } }],
    ['careerConditions', { careerConditions: [{ kind: 'column' as const, column: 'games' as const, op: 'gte' as const, value: 100 }] }],
    ['careerPredicates', { careerPredicates: [{ builder: 'premiership_coach', params: {} }] }],
    ['clubSeasonConditions', { clubSeasonConditions: [{ kind: 'premier' as const }] }],
    ['achievementSummary', { achievementSummary: { achievementKey: 'first_kick_goal' as const, kind: 'by_club' as const } }],
    ['headToHead', { headToHead: { kind: 'record' as const } }],
    ['streakDefinition', { streakDefinition: { kind: 'win' as const } }],
    ['periodSplit', { periodSplit: 'Q1' as const }],
    ['scoreCheckpoint', { scoreCheckpoint: 'HT' as const }],
    ['resultFilter', { resultFilter: 'won' as const }],
    ['debutGame', { debutGame: true }],
    ['havingClause', { havingClause: { metric: 'wins' as const, op: 'gte' as const, value: 3 } }],
    ['matchFilter', { matchFilter: { metric: 'win_margin' as const, op: 'gt' as const, value: 50 } }],
    ['boundary', { boundary: { event: 'debut' as const, where: 'grand_final' as const } }],
    ['mode', { mode: 'single' as const }],
  ] as [string, Partial<NlQueryPlan>][])('refuses a coaching plan carrying %s', (_label, shape) => {
    expect(validatePlan(coachPlan({ coach: HARDWICK, ...shape }))).toHaveProperty('error');
  });

  it('allows no metric only for a list or a count', () => {
    expect(validatePlan(coachPlan({ scope: { clubFor: RICHMOND } }))).not.toHaveProperty('error');
    expect(validatePlan(coachPlan({ scope: { clubFor: RICHMOND }, agg: { kind: 'count' } }))).not.toHaveProperty('error');
    expect(validatePlan(coachPlan({ scope: { clubFor: RICHMOND }, agg: { kind: 'max' } }))).toHaveProperty('error');
    expect(validatePlan(coachPlan({ coach: HARDWICK, agg: { kind: 'top_n', n: 3 } }))).toHaveProperty('error');
  });

  it('refuses a bare coaching question with no coach, club or statistic', () => {
    expect(validatePlan(coachPlan({}))).toHaveProperty('error');
  });

  it('refuses a threshold with nothing to qualify, and accepts one on a real metric', () => {
    expect(validatePlan(coachPlan({ metricCondition: { op: 'gte', value: 100 } }))).toHaveProperty('error');
    expect(validatePlan(coachPlan({ metric: 'wins', metricCondition: { op: 'gte', value: 100 } })))
      .not.toHaveProperty('error');
  });

  it('a threshold lists qualifiers rather than ranking one', () => {
    expect(validatePlan(coachPlan({ metric: 'wins', agg: { kind: 'max' }, metricCondition: { op: 'gte', value: 100 } })))
      .toHaveProperty('error');
  });

  it('refuses a win-percentage ranking with no games qualifier, and accepts one with', () => {
    expect(validatePlan(coachPlan({ metric: 'win_pct', agg: { kind: 'max' } }))).toHaveProperty('error');
    expect(validatePlan(coachPlan({ metric: 'win_pct', agg: { kind: 'top_n', n: 10 } }))).toHaveProperty('error');
    expect(validatePlan(coachPlan({ metric: 'win_pct', agg: { kind: 'max' }, coachQualifier: { minGames: 50 } })))
      .not.toHaveProperty('error');
    expect(validatePlan(coachPlan({ metric: 'win_pct', agg: { kind: 'max' }, coachQualifier: { minGames: 0 } })))
      .toHaveProperty('error');
  });

  it('refuses a coach reference or a coaching qualifier on any other grain', () => {
    expect(validatePlan(basePlan({ coach: HARDWICK }))).toHaveProperty('error');
    expect(validatePlan(basePlan({ coachQualifier: { minGames: 50 } }))).toHaveProperty('error');
  });

  it('refuses a coach and a player in the same plan', () => {
    expect(validatePlan(coachPlan({ coach: HARDWICK, player: { id: 1, slug: 'p', name: 'P' } })))
      .toHaveProperty('error');
  });

  it('refuses a season below the 1902 coaching floor whatever the metric', () => {
    expect(validatePlan(coachPlan({ scope: { clubFor: RICHMOND, seasonMin: 1901, seasonMax: 1901 } })))
      .toHaveProperty('error');
    expect(validatePlan(coachPlan({ metric: 'wins', agg: { kind: 'max' }, scope: { seasonMin: 1899, seasonMax: 1901 } })))
      .toHaveProperty('error');
    expect(validatePlan(coachPlan({ scope: { clubFor: RICHMOND, seasonMin: 1902, seasonMax: 1902 } })))
      .not.toHaveProperty('error');
    // No upper bound is encoded: a future season is an empty result, not a refusal.
    expect(validatePlan(coachPlan({ scope: { clubFor: RICHMOND, seasonMin: 2030, seasonMax: 2030 } })))
      .not.toHaveProperty('error');
  });
});

describe('describePlan: coaching', () => {
  it('names the coach and states the win-percentage qualifier verbatim', () => {
    const lines = describePlan(validatePlan(coachPlan({
      coach: HARDWICK, metric: 'win_pct', agg: { kind: 'max' }, coachQualifier: { minGames: 50 },
    })) as NlQueryPlan);
    expect(lines).toContain('Coach: Damien Hardwick.');
    expect(lines).toContain(
      'Best coaching win percentage, minimum 50 games coached. '
      + 'Win percentage counts a draw as half a win — (wins + draws ÷ 2) ÷ games.',
    );
  });

  it('echoes a reader-stated minimum rather than the default', () => {
    const lines = describePlan(validatePlan(coachPlan({
      metric: 'win_pct', agg: { kind: 'max' }, coachQualifier: { minGames: 100 },
    })) as NlQueryPlan);
    expect(lines.some((line) => line.includes('minimum 100 games coached'))).toBe(true);
  });
});

// ------------------------------- after the siren (AFLDB-ISSUE-152 Phase C)

/**
 * The after_siren grain's ownership contract. Every field it refuses is
 * refused BY NAME (the ISSUE-110 discarded-scope rule), and the
 * match-link boundary is D10/§7.1 encoded as one exported predicate that
 * both validatePlan and the compiler read.
 */
function sirenPlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return basePlan({
    grain: 'after_siren',
    metric: 'siren_kicks',
    agg: { kind: 'list' },
    afterSiren: { subject: 'event' },
    ...overrides,
  });
}

describe('validatePlan — after_siren (AFLDB-ISSUE-152 Phase C)', () => {
  it('accepts the plain event list', () => {
    expect(validatePlan(sirenPlan())).not.toHaveProperty('error');
  });

  it('requires the typed descriptor: the grain cannot be reached without one', () => {
    const { afterSiren: _omitted, ...rest } = sirenPlan();
    expect(validatePlan(rest as NlQueryPlan)).toHaveProperty('error');
  });

  it('refuses the descriptor on any other grain', () => {
    expect(validatePlan(basePlan({ afterSiren: { subject: 'event' } }))).toHaveProperty('error');
  });

  it('refuses "siren_kicks" as a metric for any other grain', () => {
    expect(validatePlan(basePlan({ metric: 'siren_kicks' }))).toHaveProperty('error');
  });

  it.each([
    ['coach', { coach: { id: 1, slug: 'x', name: 'X', playerId: null, playerSlug: null } }],
    ['coachQualifier', { coachQualifier: { minGames: 50 } }],
    ['scope.matchup', { scope: { matchup: {
      clubA: { organizationId: 1, slug: 'a', name: 'A' }, clubB: { organizationId: 2, slug: 'b', name: 'B' },
    } } }],
    ['scope.venue', { scope: { venue: { id: 1, slug: 'mcg', name: 'MCG' } } }],
    ['scope.roundNumber', { scope: { roundNumber: 1 } }],
    ['scope.playerIdIn', { scope: { playerIdIn: [1, 2] } }],
    ['careerConditions', { careerConditions: [{ kind: 'column', column: 'games', op: 'gte', value: 1 }] }],
    ['careerPredicates', { careerPredicates: [{ builder: 'premiership_coach', params: {} }] }],
    ['clubSeasonConditions', { clubSeasonConditions: [{ kind: 'premier' }] }],
    ['achievementSummary', { achievementSummary: { achievementKey: 'first_kick_goal', kind: 'by_club' } }],
    ['headToHead', { headToHead: { kind: 'record' } }],
    ['streakDefinition', { streakDefinition: { kind: 'win' } }],
    ['periodSplit', { periodSplit: 'Q1' }],
    ['scoreCheckpoint', { scoreCheckpoint: 'HT' }],
    ['resultFilter', { resultFilter: 'won' }],
    ['debutGame', { debutGame: true }],
    ['havingClause', { havingClause: { metric: 'wins', op: 'gte', value: 1 } }],
    ['matchFilter', { matchFilter: { metric: 'win_margin', op: 'gte', value: 1 } }],
    ['boundary', { boundary: { event: 'debut', where: 'grand_final' } }],
    ['mode', { mode: 'single' }],
  ] as [string, Partial<NlQueryPlan>][])('refuses %s by name', (_label, overrides) => {
    expect(validatePlan(sirenPlan(overrides))).toHaveProperty('error');
  });

  it('refuses min: the set is DEFINED by having at least one after-siren kick (D15)', () => {
    expect(validatePlan(sirenPlan({
      agg: { kind: 'min' }, afterSiren: { subject: 'player' },
    }))).toHaveProperty('error');
  });

  it('accepts max/top_n at player subject, and refuses a player ranking at event subject', () => {
    expect(validatePlan(sirenPlan({
      agg: { kind: 'max' }, afterSiren: { subject: 'player', kickScored: 'goal' },
    }))).not.toHaveProperty('error');
    expect(validatePlan(sirenPlan({ agg: { kind: 'max' } }))).toHaveProperty('error');
  });

  it('a named player takes the event subject; a leaderboard of one is refused', () => {
    const named = { id: 1001, slug: 'barry-hall', name: 'Barry Hall' };
    expect(validatePlan(sirenPlan({ player: named }))).not.toHaveProperty('error');
    expect(validatePlan(sirenPlan({
      player: named, agg: { kind: 'max' }, afterSiren: { subject: 'player' },
    }))).toHaveProperty('error');
  });

  it('a threshold requires the player subject and a list', () => {
    expect(validatePlan(sirenPlan({
      afterSiren: { subject: 'player', kickScored: 'goal' }, metricCondition: { op: 'gte', value: 3 },
    }))).not.toHaveProperty('error');
    expect(validatePlan(sirenPlan({
      metricCondition: { op: 'gte', value: 3 },
    }))).toHaveProperty('error');
  });

  it('refuses an unknown dimension value', () => {
    expect(validatePlan(sirenPlan({
      afterSiren: { subject: 'event', kickScored: 'point' as never },
    }))).toHaveProperty('error');
    expect(validatePlan(sirenPlan({
      afterSiren: { subject: 'event', kickEffect: 'lost' as never },
    }))).toHaveProperty('error');
    expect(validatePlan(sirenPlan({
      afterSiren: { subject: 'event', kickerResult: 'won' as never },
    }))).toHaveProperty('error');
    expect(validatePlan(sirenPlan({
      afterSiren: { subject: 'event', occurrence: 'oldest' as never },
    }))).toHaveProperty('error');
  });

  it('applies the 1913 coverage floor, and does NOT inherit the 1965 "kicks" floor', () => {
    // The measured first event is Billy Schmidt, 1913 -- a metric literally
    // named `kicks` would decline every question about 1913-1964.
    expect(validatePlan(sirenPlan({
      scope: { seasonMin: 1930, seasonMax: 1930 },
    }))).not.toHaveProperty('error');
    expect(validatePlan(sirenPlan({
      scope: { seasonMin: 1900, seasonMax: 1900 },
    }))).toHaveProperty('error');
  });
});

describe('afterSirenRequiresMatchLink (D10 §7.1)', () => {
  it.each([
    ['event list', {}, false],
    ['event count', { agg: { kind: 'count' } }, false],
    ['club scope', { scope: { clubFor: { organizationId: 1, slug: 'r', name: 'R' } } }, false],
    ['opponent scope', { scope: { clubAgainst: { organizationId: 1, slug: 'r', name: 'R' } } }, false],
    ['season scope', { scope: { seasonMin: 2000 } }, false],
    ['kickScored', { afterSiren: { subject: 'event', kickScored: 'goal' } }, false],
    ['kickEffect', { afterSiren: { subject: 'event', kickEffect: 'won' } }, false],
    ['kickerResult', { afterSiren: { subject: 'event', kickerResult: 'loss' } }, false],
    ['player ranking', { agg: { kind: 'max' }, afterSiren: { subject: 'player' } }, false],
    ['finals scope', { scope: { matchType: 'finals' } }, true],
    ['home_and_away scope', { scope: { matchType: 'home_and_away' } }, true],
    ['occurrence first', { afterSiren: { subject: 'event', occurrence: 'first' } }, true],
    ['occurrence most_recent', { afterSiren: { subject: 'event', occurrence: 'most_recent' } }, true],
  ] as [string, Partial<NlQueryPlan>, boolean][])('%s requires a match link: %s', (_label, overrides, expected) => {
    expect(afterSirenRequiresMatchLink(sirenPlan(overrides))).toBe(expected);
  });

  it('premiership_season alone never requires a match link', () => {
    // The four 2026 premiership rows with no match link are counted,
    // listed, attributed and classified -- everything except ordering and
    // finals.
    expect(afterSirenRequiresMatchLink(sirenPlan({ scope: { seasonMin: 2026 } }))).toBe(false);
  });
});

/**
 * AFLDB-ISSUE-152 Phase E. The two modifier builders take neither a club
 * nor a season, so neither joins the owning-builder lists: composed with a
 * scoped builder the scope stays owned by that one, and alone they own
 * nothing at all. No new validation rule was written for this phase -- the
 * assertions below prove the EXISTING gates already fail closed on shapes
 * that had never reached them before.
 */
describe('first-kick-goal modifiers and ownership (AFLDB-ISSUE-152 Phase E)', () => {
  const carlton = { organizationId: 2, slug: 'carlton', name: 'Carlton' };
  const listPlan = { metric: null, agg: { kind: 'list' } } as const;
  const consecutive = { builder: 'first_kick_goal_consecutive_min', params: { kicks: '3' } };
  const onlyGoal = { builder: 'first_kick_goal_only_career_goal', params: {} };
  const forClub = { builder: 'first_kick_goal_for_club', params: { club: '2' } };
  const between = { builder: 'first_kick_goal_between', params: { from: '1940', to: '1949' } };

  it('accepts each modifier on its own', () => {
    expect('error' in validatePlan(basePlan({ ...listPlan, careerPredicates: [consecutive] }))).toBe(false);
    expect('error' in validatePlan(basePlan({ ...listPlan, careerPredicates: [onlyGoal] }))).toBe(false);
  });

  it('accepts the three composed shapes', () => {
    expect('error' in validatePlan(basePlan({
      ...listPlan, careerPredicates: [forClub, consecutive], scope: { clubFor: carlton },
    }))).toBe(false);
    expect('error' in validatePlan(basePlan({
      ...listPlan, careerPredicates: [between, consecutive], scope: { seasonMin: 1940, seasonMax: 1949 },
    }))).toBe(false);
    expect('error' in validatePlan(basePlan({
      ...listPlan,
      careerPredicates: [forClub, between, onlyGoal],
      scope: { clubFor: carlton, seasonMin: 1940, seasonMax: 1949 },
    }))).toBe(false);
  });

  // E-DEC-7 is constructed here rather than typed: a real question naming a
  // season range emits first_kick_goal_between, which owns it. The plan that
  // must still fail closed is the one where nothing does.
  it('refuses a club or a season range that no modifier owns, by name', () => {
    expect(validatePlan(basePlan({
      ...listPlan, careerPredicates: [consecutive], scope: { clubFor: carlton },
    }))).toEqual({ error: 'This kind of career question cannot be limited to one club.' });
    expect(validatePlan(basePlan({
      ...listPlan, careerPredicates: [onlyGoal], scope: { seasonMin: 2000 },
    }))).toEqual({ error: 'A career question cannot be restricted to a season range.' });
  });

  it.each([
    ['venue', { venue: { id: 1, slug: 'mcg', name: 'Melbourne Cricket Ground' } }],
    ['opponent', { clubAgainst: { organizationId: 3, slug: 'collingwood', name: 'Collingwood' } }],
    ['match type', { matchType: 'grand_final' as const }],
  ])('refuses %s scope no predicate can see', (_label, scope) => {
    expect(validatePlan(basePlan({
      ...listPlan, careerPredicates: [consecutive], scope,
    }))).toEqual({ error: 'This kind of question cannot be scoped to a venue, opponent, or match type.' });
  });

  // E-D5: the precedent is label-only (grand_finals_played_min renders
  // "Played in X+ Grand Finals" today), and Phase E keeps it rather than
  // adding parameter interpolation to one builder in isolation.
  it('describes each modifier by its builder label', () => {
    const lines = describePlan(basePlan({
      ...listPlan, careerPredicates: [consecutive, onlyGoal],
    }));
    expect(lines).toContain('Condition: Goal with each of their first X kicks.');
    expect(lines).toContain('Condition: First-kick goal was their only career goal.');
  });
});

/**
 * AFLDB-ISSUE-152 Phase D. The two halves of a per-player relationship
 * question -- the named person and the predicate's bound id -- are one
 * fact, and a plan carrying only one of them is refused: the reference
 * alone names somebody the query never uses, and the predicate alone
 * would answer "brother of 2164" with no way to say whose brothers
 * those are.
 */
describe('validatePlan — family relationships (AFLDB-ISSUE-152 Phase D)', () => {
  const harvey = { id: 2164, slug: 'brent-harvey', name: 'Brent Harvey' };
  const brotherOf = { builder: 'brother_of_player', params: { player: '2164' } };

  function relationshipPlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
    return basePlan({
      metric: null,
      agg: { kind: 'list' },
      careerPredicates: [{ builder: 'has_brother', params: {} }],
      ...overrides,
    });
  }

  it('accepts each population predicate', () => {
    for (const builder of ['has_brother', 'has_afl_father', 'has_afl_son', 'has_afl_parent_or_child', 'father_son_father']) {
      expect(validatePlan(relationshipPlan({ careerPredicates: [{ builder, params: {} }] })), builder)
        .not.toHaveProperty('error');
    }
  });

  it('accepts a per-player question whose halves agree', () => {
    expect(validatePlan(relationshipPlan({ careerPredicates: [brotherOf], relationshipSubject: harvey })))
      .not.toHaveProperty('error');
  });

  it('rejects a per-player predicate with nobody named', () => {
    expect(validatePlan(relationshipPlan({ careerPredicates: [brotherOf] }))).toHaveProperty('error');
  });

  it('rejects a named relative with no predicate to use them', () => {
    expect(validatePlan(relationshipPlan({ relationshipSubject: harvey }))).toHaveProperty('error');
  });

  it('rejects halves that name different people', () => {
    expect(validatePlan(relationshipPlan({
      careerPredicates: [{ builder: 'brother_of_player', params: { player: '9999' } }],
      relationshipSubject: harvey,
    }))).toHaveProperty('error');
  });

  it('rejects a plan that both names a relative and pins a player', () => {
    expect(validatePlan(relationshipPlan({
      careerPredicates: [brotherOf],
      relationshipSubject: harvey,
      player: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' },
    }))).toHaveProperty('error');
  });

  it('rejects a relationship question at any other grain', () => {
    expect(validatePlan(relationshipPlan({
      grain: 'player_season', metric: 'goals', careerPredicates: [brotherOf], relationshipSubject: harvey,
    }))).toHaveProperty('error');
  });

  it('owns neither a club nor a season, so both are refused', () => {
    expect(validatePlan(relationshipPlan({
      scope: { clubFor: { organizationId: 1, slug: 'richmond', name: 'Richmond' } },
    }))).toHaveProperty('error');
    expect(validatePlan(relationshipPlan({ scope: { seasonMin: 2000 } }))).toHaveProperty('error');
  });
});

/**
 * AFLDB-ISSUE-152 Phase F. Ownership, stated as refusals. Every rule
 * here fails CLOSED: nothing is dropped on the way to SQL, and a plan
 * shape the compiler cannot honour is refused rather than answered as a
 * wider question.
 */
describe('validatePlan — played and also coached (AFLDB-ISSUE-152 Phase F)', () => {
  const RICHMOND = { organizationId: 18, slug: 'richmond', name: 'Richmond' };
  const COLLINGWOOD = { organizationId: 4, slug: 'collingwood', name: 'Collingwood' };
  const hasCoached = { builder: 'has_coached', params: {} };
  const coachedRichmond = { builder: 'coached_club', params: { club: '18' } };
  const playedRichmond = { builder: 'played_for_club', params: { club: '18' } };

  function x1(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
    return basePlan({ metric: null, agg: { kind: 'list' }, careerPredicates: [hasCoached], ...overrides });
  }

  function x2(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
    return basePlan({
      metric: null,
      agg: { kind: 'list' },
      careerPredicates: [playedRichmond, coachedRichmond],
      crossDomainClubs: { played: RICHMOND, coached: RICHMOND },
      ...overrides,
    });
  }

  it('accepts X1 and X2 as the parser builds them', () => {
    expect(validatePlan(x1())).not.toHaveProperty('error');
    expect(validatePlan(x2())).not.toHaveProperty('error');
  });

  // V1/V4 -- the existing ownership gate, asserted rather than rewritten.
  it('V1/V4: a club in match scope is refused, because neither builder owns one', () => {
    expect(validatePlan(x1({ scope: { clubFor: RICHMOND } }))).toHaveProperty('error');
    expect(validatePlan(x2({ scope: { clubFor: RICHMOND } }))).toHaveProperty('error');
  });

  // V2/V3 -- the existing career-scope gates.
  it('V2/V3: season, venue, opponent, round and match type are all refused', () => {
    expect(validatePlan(x1({ scope: { seasonMin: 1990, seasonMax: 1999 } }))).toHaveProperty('error');
    expect(validatePlan(x1({ scope: { venue: { id: 1, slug: 'mcg', name: 'MCG' } } }))).toHaveProperty('error');
    expect(validatePlan(x1({ scope: { clubAgainst: COLLINGWOOD } }))).toHaveProperty('error');
    expect(validatePlan(x1({ scope: { roundNumber: 5 } }))).toHaveProperty('error');
    expect(validatePlan(x1({ scope: { matchType: 'finals' } }))).toHaveProperty('error');
  });

  it('V5: the club-scoped and unscoped coaching predicates never coexist', () => {
    expect(validatePlan(x2({
      careerPredicates: [playedRichmond, coachedRichmond, hasCoached],
    }))).toHaveProperty('error');
  });

  it('V9: the composition never leaks into the coach-only grain', () => {
    expect(validatePlan(x1({ grain: 'coach_record', metric: null }))).toHaveProperty('error');
  });

  it('V10: the composition exists at career grain and nowhere else', () => {
    expect(validatePlan(x1({ grain: 'player_season', metric: 'goals' }))).toHaveProperty('error');
    expect(validatePlan(x1({ grain: 'player_game', mode: 'single', metric: 'goals' }))).toHaveProperty('error');
  });

  // V6 -- narrowed by AFLDB-ISSUE-153 Stage 2 to the composition D9 is
  // actually about. The COMPOSED question is still a list and never a
  // ranking; the plain FS1 ranking is now the exact mirror of the shipped
  // father-side rel_024 and must answer, or the son side would be denied a
  // wording the father side is given (decision Q1 consequence 3).
  it('V6: a father–son selection COMPOSED with coaching is a list, never a ranking', () => {
    const fs = { builder: 'father_son_selection', params: {} };
    expect(validatePlan(basePlan({
      metric: 'games', agg: { kind: 'max' }, careerPredicates: [fs, hasCoached],
    }))).toHaveProperty('error');
  });

  it('V6: the UNcomposed father–son selection ranking answers, mirroring the father side', () => {
    const fs = { builder: 'father_son_selection', params: {} };
    expect(validatePlan(basePlan({
      metric: 'games', agg: { kind: 'max' }, careerPredicates: [fs],
    }))).not.toHaveProperty('error');
  });

  // V7 is GONE: D8 is decided (operator decision Q1), so a father–son
  // selection standing on its own is FS1 and answers. The bare and
  // collective forms still decline, but they decline in the parser now,
  // at the narrowed FATHER_SON_RULE_RE guard, which is where the
  // explicit-versus-collective distinction actually lives.
  it('V7 is retired: a father–son selection on its own is FS1 and answers', () => {
    const fs = { builder: 'father_son_selection', params: {} };
    expect(validatePlan(basePlan({
      metric: null, agg: { kind: 'list' }, careerPredicates: [fs],
    }))).not.toHaveProperty('error');
  });

  // V6b. "by club" on a selection question means the SELECTING club, and
  // the generic metric extractor reads it as clubs_played -- the number of
  // clubs the player went on to play for. Refused rather than answered
  // with the plausible wrong number.
  it('V6b: a father–son selection never answers a clubs_played reading of "by club"', () => {
    const fs = { builder: 'father_son_selection', params: {} };
    expect(validatePlan(basePlan({
      metric: 'clubs_played', agg: { kind: 'list' }, careerPredicates: [fs],
    }))).toHaveProperty('error');
  });

  it('the named clubs and the bound ids are one fact, and cannot drift apart', () => {
    // A reference that does not match its builder's parameter would let
    // the sentence say Richmond while the SQL filtered Collingwood.
    expect(validatePlan(x2({
      crossDomainClubs: { played: RICHMOND, coached: COLLINGWOOD },
    }))).toHaveProperty('error');
    // A coached club with no reference could never be named in the answer.
    expect(validatePlan(basePlan({
      metric: null, agg: { kind: 'list' }, careerPredicates: [playedRichmond, coachedRichmond],
    }))).toHaveProperty('error');
    // A reference with no predicates behind it is a club the query never uses.
    expect(validatePlan(basePlan({
      metric: null,
      agg: { kind: 'list' },
      careerPredicates: [hasCoached],
      crossDomainClubs: { played: RICHMOND, coached: RICHMOND },
    }))).toHaveProperty('error');
  });
});

// ------------------------------------------ family (AFLDB-ISSUE-153 Stage 6)

function familyPlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return basePlan({ grain: 'family', metric: 'combined_games', agg: { kind: 'max' }, limit: 50, ...overrides });
}

describe('validatePlan: family', () => {
  it('accepts a ranked plan (C1) for either metric', () => {
    expect(validatePlan(familyPlan())).not.toHaveProperty('error');
    expect(validatePlan(familyPlan({ metric: 'linked_members' }))).not.toHaveProperty('error');
  });

  it('accepts a thresholded list (C5) and refuses a threshold with no list agg', () => {
    expect(validatePlan(familyPlan({
      metric: 'linked_members', agg: { kind: 'list' }, metricCondition: { op: 'gte', value: 3 },
    }))).not.toHaveProperty('error');
    // Same condition, ranked instead of listed: refused, the same rule
    // every other thresholdable grain (player_game/season, coach_record,
    // after_siren) already enforces.
    expect(validatePlan(familyPlan({
      metric: 'linked_members', agg: { kind: 'max' }, metricCondition: { op: 'gte', value: 3 },
    }))).toHaveProperty('error');
  });

  it('refuses a family list with no threshold to qualify against', () => {
    expect(validatePlan(familyPlan({ agg: { kind: 'list' } }))).toHaveProperty('error');
  });

  it('requires a recognised family metric, and refuses a metric from another grain', () => {
    expect(validatePlan(familyPlan({ metric: null }))).toHaveProperty('error');
    expect(validatePlan(familyPlan({ metric: 'games' }))).toHaveProperty('error');
  });

  it.each([
    ['player', { player: { id: 1, slug: 'p', name: 'P' } }],
    ['coach', { coach: HARDWICK }],
    ['playerIdIn', { scope: { playerIdIn: [1, 2] } }],
    ['clubFor', { scope: { clubFor: RICHMOND } }],
    ['clubAgainst', { scope: { clubAgainst: RICHMOND } }],
    ['venue', { scope: { venue: { id: 1, slug: 'mcg', name: 'MCG' } } }],
    ['matchType', { scope: { matchType: 'finals' as const } }],
    ['roundNumber', { scope: { roundNumber: 5 } }],
    ['seasonMin/Max', { scope: { seasonMin: 2000, seasonMax: 2010 } }],
    ['careerConditions', { careerConditions: [{ kind: 'column' as const, column: 'games' as const, op: 'gte' as const, value: 100 }] }],
    ['careerPredicates', { careerPredicates: [{ builder: 'has_brother', params: {} }] }],
    ['clubSeasonConditions', { clubSeasonConditions: [{ kind: 'premier' as const }] }],
    ['achievementSummary', { achievementSummary: { achievementKey: 'first_kick_goal' as const, kind: 'by_club' as const } }],
    ['headToHead', { headToHead: { kind: 'record' as const } }],
    ['streakDefinition', { streakDefinition: { kind: 'win' as const } }],
    ['boundary', { boundary: { event: 'debut' as const, where: 'grand_final' as const } }],
    ['debutGame', { debutGame: true }],
  ] as [string, Partial<NlQueryPlan>][])('refuses a family plan carrying %s -- no club, season, player or career condition applies', (_label, shape) => {
    expect(validatePlan(familyPlan(shape))).toHaveProperty('error');
  });
});
