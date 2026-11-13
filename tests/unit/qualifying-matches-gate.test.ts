import { describe, expect, it } from 'vitest';
import { validateQualifyingMatchesRequest } from '@/search/nl/qualifying-matches-gate';
import { encodePlanToken, type NlQueryPlan } from '@/search/nl/plan';

describe('qualifying-matches-gate', () => {
  const base: NlQueryPlan = {
    v: 1, grain: 'team_match', metric: null, agg: { kind: 'list' }, tiePolicy: 'all', limit: 50,
    scope: {},
    careerConditions: [], careerPredicates: [], clubSeasonConditions: [],
    havingClause: { metric: 'wins', op: 'gte', value: 1 },
  };

  it('rejects a syntactically valid team_aggregate token that contains a resultFilter', () => {
    const plan: NlQueryPlan = { ...base, resultFilter: 'won' };
    const token = encodePlanToken(plan);
    const result = validateQualifyingMatchesRequest(token, 'richmond');
    expect(result).toEqual({ error: 'unsupported_result_filter' });
  });

  it('rejects an invalid token', () => {
    const result = validateQualifyingMatchesRequest('INVALID_TOKEN', 'richmond');
    expect(result).toEqual({ error: 'invalid_token' });
  });

  it('accepts a valid supported team_aggregate request', () => {
    const token = encodePlanToken(base);
    const result = validateQualifyingMatchesRequest(token, 'richmond');
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.clubParam).toBe('richmond');
      expect(result.rawPlan.grain).toBe('team_match');
    }
  });
});

// AFLDB-ISSUE-359 (SRCH-6): a crafted plan token is a bad request, never a throw
// (a missing `scope` was an uncaught TypeError, i.e. a 500) and never a value
// PostgreSQL rejects (a string `seasonMin` failed there with 22P02, also a 500).
describe('qualifying-matches-gate: crafted tokens are refused up front', () => {
  const base = {
    v: 1, grain: 'team_match', metric: null, agg: { kind: 'list' }, tiePolicy: 'all', limit: 50,
    scope: {} as Record<string, unknown>,
    careerConditions: [], careerPredicates: [], clubSeasonConditions: [],
    havingClause: { metric: 'wins', op: 'gte', value: 1 },
  };
  const token = (plan: unknown) => encodePlanToken(plan as NlQueryPlan);

  it('does not throw for a token missing scope, and says invalid_plan', () => {
    const noScope = { ...base, scope: undefined }; // JSON omits undefined, so the token has no scope
    expect(() => validateQualifyingMatchesRequest(token(noScope), 'richmond')).not.toThrow();
    expect(validateQualifyingMatchesRequest(token(noScope), 'richmond')).toEqual({ error: 'invalid_plan' });
  });

  it('does not throw for a token missing careerConditions', () => {
    const noConditions = { ...base, careerConditions: undefined };
    expect(validateQualifyingMatchesRequest(token(noConditions), 'richmond')).toEqual({ error: 'invalid_plan' });
  });

  it.each([
    ['a string seasonMin', { seasonMin: 'abc' }],
    ['an injection-shaped seasonMin', { seasonMin: '1990; select 1' }],
    ['a fractional seasonMin', { seasonMin: 1990.5 }],
    ['a seasonMax beyond int4', { seasonMax: 2 ** 31 }],
    ['a string roundNumber', { roundNumber: '5' }],
    ['an unknown matchType', { matchType: 'nonsense' }],
    ['a club with a string organizationId', { clubFor: { organizationId: 'x', slug: 'x', name: 'x' } }],
    ['a matchup missing one club', { matchup: { clubA: { organizationId: 1, slug: 'a', name: 'a' } } }],
    ['a venue with a string id', { venue: { id: 'x', slug: 'x', name: 'x' } }],
  ])('refuses %s as invalid_plan', (_label, scope) => {
    expect(validateQualifyingMatchesRequest(token({ ...base, scope }), 'richmond')).toEqual({ error: 'invalid_plan' });
  });

  it('still accepts a fully typed scope', () => {
    const scope = {
      seasonMin: 1990, seasonMax: 1999, roundNumber: 5, matchType: 'home_and_away',
      clubAgainst: { organizationId: 2, slug: 'carlton', name: 'Carlton' },
      venue: { id: 1, slug: 'mcg', name: 'MCG' },
    };
    const result = validateQualifyingMatchesRequest(token({ ...base, scope }), 'richmond');
    expect('error' in result).toBe(false);
  });
});
