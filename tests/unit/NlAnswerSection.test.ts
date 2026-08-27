import { describe, expect, it } from 'vitest';
import { getQualifyingMatchesHref } from '@/search/nl/qualifying-matches-href';

describe('NlAnswerSection TeamAggregateTable rendering logic', () => {
  it('returns a drill-down Link href when a usable planToken is provided', () => {
    const href = getQualifyingMatchesHref('TEST_TOKEN', 'richmond');
    expect(href).toBe('/search/qualifying-matches?plan=TEST_TOKEN&club=richmond');
  });

  it('returns null when planToken is missing, representing plain text fallback', () => {
    const href = getQualifyingMatchesHref(null, 'richmond');
    expect(href).toBeNull();

    const undefinedHref = getQualifyingMatchesHref(undefined, 'richmond');
    expect(undefinedHref).toBeNull();
  });
});
