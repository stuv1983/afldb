import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateQualifyingMatchesRequest } from '@/search/nl/qualifying-matches-gate';
import { encodePlanToken, type NlQueryPlan } from '@/search/nl/plan';
import QualifyingMatchesPage from '@/app/search/qualifying-matches/page';

// The route test below renders the real page with the database query layer replaced by a
// counter: a refused token must be a 404 that never reaches the query.
const drill = vi.hoisted(() => ({ calls: 0, notFound: 0 }));
vi.mock('@/db/queries/nl/team-match', () => ({
  answerTeamAggregateDrilldown: () => { drill.calls += 1; return Promise.resolve({ rows: [], total: 0 }); },
}));
vi.mock('next/navigation', () => ({
  notFound: () => { drill.notFound += 1; throw new Error('NEXT_NOT_FOUND'); },
}));

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

  // Review B-04: validatePlan accepts any finite matchFilter.value and any integer
  // havingClause.value; the drill-down binds both against integer expressions, so 1.5
  // failed in PostgreSQL (22P02) and 3e10 / 1e300 failed (22003), both a 500.
  const matchFilter = { metric: 'win_margin', op: 'gte', value: 10 };
  it.each([
    ['a fractional matchFilter.value', { matchFilter: { ...matchFilter, value: 1.5 } }],
    ['a matchFilter.value beyond int4 (3e10)', { matchFilter: { ...matchFilter, value: 3e10 } }],
    ['a matchFilter.value of 1e300', { matchFilter: { ...matchFilter, value: 1e300 } }],
    ['a string matchFilter.value', { matchFilter: { ...matchFilter, value: '10' } }],
    ['a fractional havingClause.value', { havingClause: { metric: 'wins', op: 'gte', value: 1.5 } }],
    ['a havingClause.value beyond int4 (3e10)', { havingClause: { metric: 'wins', op: 'gte', value: 3e10 } }],
    ['a havingClause.value of 1e300', { havingClause: { metric: 'wins', op: 'gte', value: 1e300 } }],
    ['a havingClause that is not an object', { havingClause: 'wins' }],
  ])('refuses %s as invalid_plan', (_label, patch) => {
    const result = validateQualifyingMatchesRequest(token({ ...base, ...patch }), 'richmond');
    expect(result).toEqual({ error: 'invalid_plan' });
  });

  it('still accepts int4-range matchFilter and havingClause values', () => {
    const plan = {
      ...base,
      havingClause: { metric: 'wins', op: 'gte', value: 2_147_483_647 },
      matchFilter: { ...matchFilter, value: 2_147_483_647 },
    };
    expect('error' in validateQualifyingMatchesRequest(token(plan), 'richmond')).toBe(false);
    const ordinary = { ...base, matchFilter };
    expect('error' in validateQualifyingMatchesRequest(token(ordinary), 'richmond')).toBe(false);
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

// Review B-04 at the route: /search/qualifying-matches?plan=<crafted>&club=... is a 404 and the
// drill-down query is never issued (so PostgreSQL never sees the out-of-range value).
describe('qualifying-matches route: crafted numeric tokens are a 404, never a query', () => {
  beforeEach(() => { drill.calls = 0; drill.notFound = 0; });
  const plan = {
    v: 1, grain: 'team_match', metric: null, agg: { kind: 'list' }, tiePolicy: 'all', limit: 50,
    scope: {}, careerConditions: [], careerPredicates: [], clubSeasonConditions: [],
    havingClause: { metric: 'wins', op: 'gte', value: 1 },
  };
  const render = (p: unknown) => QualifyingMatchesPage({
    searchParams: Promise.resolve({ plan: encodePlanToken(p as NlQueryPlan), club: 'richmond' }),
  });

  it.each([
    ['matchFilter 1.5', { ...plan, matchFilter: { metric: 'win_margin', op: 'gte', value: 1.5 } }],
    ['matchFilter 3e10', { ...plan, matchFilter: { metric: 'win_margin', op: 'gte', value: 3e10 } }],
    ['havingClause 1e300', { ...plan, havingClause: { metric: 'wins', op: 'gte', value: 1e300 } }],
  ])('%s -> not found, no query', async (_label, crafted) => {
    await expect(render(crafted)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(drill.notFound).toBe(1);
    expect(drill.calls).toBe(0);
  });

  it('an ordinary token still reaches the query', async () => {
    await render({ ...plan, matchFilter: { metric: 'win_margin', op: 'gte', value: 10 } });
    expect(drill.calls).toBe(1);
    expect(drill.notFound).toBe(0);
  });
});
