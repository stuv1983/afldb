import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { NlAnswerSection } from '@/components/NlAnswerSection';
import { getQualifyingMatchesHref } from '@/search/nl/qualifying-matches-href';
import type { NlAnswer } from '@/search/nl/answer-types';

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

describe('NlAnswerSection player-career rendering', () => {
  it('renders the player and Games value for a single unranked match', () => {
    const answer: NlAnswer = {
      headline: '1 player matches',
      interpretation: 'Players matching every condition for Collingwood.',
      caveats: [],
      coverageNote: null,
      explain: ['Club: Collingwood.', 'Condition: games for Collingwood exactly 200.'],
      planToken: 'test-plan',
      clientRef: '00000000-0000-4000-8000-000000000000',
      payload: {
        kind: 'player_career',
        lead: {
          playerId: 7872,
          slug: 'josh-fraser',
          displayName: 'Josh Fraser',
          value: null,
          games: 200,
          debutSeason: 2000,
          finalSeason: 2012,
          clubNames: 'Collingwood, Gold Coast',
        },
        rows: [{
          playerId: 7872,
          slug: 'josh-fraser',
          displayName: 'Josh Fraser',
          value: null,
          games: 200,
          debutSeason: 2000,
          finalSeason: 2012,
          clubNames: 'Collingwood, Gold Coast',
        }],
        total: 1,
      },
    };

    const html = renderToStaticMarkup(NlAnswerSection({ answer }));
    expect(html).toContain('Every matching player');
    expect(html).toContain('Josh Fraser');
    expect(html).toContain('>Games</th>');
    expect(html).toContain('>200</td>');
  });
});
