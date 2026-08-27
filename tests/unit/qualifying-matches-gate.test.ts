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
