import { describe, expect, it } from 'vitest';

import { describeAnswer } from '@/search/nl/describe';
import type { NlHeadToHeadRow } from '@/search/nl/answer-types';
import type { NlQueryPlan } from '@/search/nl/plan';

const row: NlHeadToHeadRow = {
  clubAId: 1, clubAName: 'Richmond', clubASlug: 'richmond',
  clubBId: 2, clubBName: 'Carlton', clubBSlug: 'carlton',
  clubAWins: 108, clubBWins: 128, draws: 4, total: 240,
  lastMatchId: 99, lastMatchDate: new Date('2025-07-01'), lastMatchSeason: 2025,
  lastMatchRoundType: 'home_and_away', lastMatchRoundNumber: 16,
  lastDrawMatchId: 50, lastDrawDate: new Date('2017-06-01'), lastDrawSeason: 2017,
  lastDrawRoundType: 'home_and_away', lastDrawRoundNumber: 14,
};

function plan(kind: NonNullable<NlQueryPlan['headToHead']>['kind']): NlQueryPlan {
  return {
    v: 1, grain: 'head_to_head', metric: null, agg: { kind: 'count' },
    scope: {
      matchup: {
        clubA: { organizationId: 1, name: 'Richmond', slug: 'richmond' },
        clubB: { organizationId: 2, name: 'Carlton', slug: 'carlton' },
      },
    },
    careerConditions: [], careerPredicates: [], clubSeasonConditions: [],
    headToHead: { kind }, tiePolicy: 'all', limit: 25,
  };
}

describe('head-to-head answer descriptions', () => {
  it('describes the complete record from typed counts', () => {
    const result = describeAnswer(plan('record'), { kind: 'head_to_head', row });
    expect(result.headline).toBe('Richmond 108–128 Carlton');
    expect(result.interpretation).toBe('4 draws; 240 matches.');
  });

  it('describes win comparison, draw count and last draw distinctly', () => {
    expect(describeAnswer(plan('compare_wins'), { kind: 'head_to_head', row }).headline)
      .toBe('Carlton has won more — 108 to 128');
    expect(describeAnswer(plan('draw_count'), { kind: 'head_to_head', row }).headline).toBe('4 draws');
    expect(describeAnswer(plan('last_draw'), { kind: 'head_to_head', row }).interpretation)
      .toBe('2017 home and away 14.');
  });
});
