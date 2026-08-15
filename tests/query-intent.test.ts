import { describe, expect, it } from 'vitest';

import {
  type IntentClub,
  extractQuerySignals,
  resolveIntent,
} from '@/search/query-intent';

const CLUBS: IntentClub[] = [
  { slug: 'richmond', name: 'Richmond' },
  { slug: 'st-kilda', name: 'St Kilda' },
  { slug: 'essendon', name: 'Essendon' },
];

function intentFor(
  query: string,
  ctx: Parameters<typeof resolveIntent>[2] = {},
): ReturnType<typeof resolveIntent> {
  const signals = extractQuerySignals(query, CLUBS);
  return resolveIntent(query, signals, ctx);
}

describe('extractQuerySignals', () => {
  it('finds a club by whole-word match and strips it from the topic words', () => {
    const signals = extractQuerySignals('brownlow winner richmond', CLUBS);
    expect(signals.club).toEqual({ slug: 'richmond', name: 'Richmond' });
    expect(signals.topicWords).toBe('brownlow winner');
  });

  it('does not match a club name inside another word', () => {
    // "Essendon" should not match "essendonfc" or similar run-together text.
    const signals = extractQuerySignals('essendonfc history', CLUBS);
    expect(signals.club).toBeNull();
  });

  it('finds a plausible season year and rejects out-of-range numbers', () => {
    expect(extractQuerySignals('1989 grand final', CLUBS).year).toBe(1989);
    expect(extractQuerySignals('round 5 3000', CLUBS).year).toBeNull();
  });

  it('finds a multi-word club name', () => {
    const signals = extractQuerySignals('brownlow st kilda', CLUBS);
    expect(signals.club?.slug).toBe('st-kilda');
    expect(signals.topicWords).toBe('brownlow');
  });
});

describe('resolveIntent — Brownlow', () => {
  it('routes a plain brownlow query to the dedicated page', () => {
    expect(intentFor('brownlow')).toEqual({
      href: '/brownlow',
      label: 'Brownlow Medal',
      detail: 'Every winner and the full vote history, from 1924.',
    });
  });

  it('routes a club-qualified query to winners by season, filtered', () => {
    const match = intentFor('brownlow winner richmond');
    expect(match?.href).toBe('/brownlow?club=richmond#brownlow-winners');
    expect(match?.label).toContain('Richmond');
  });

  it('routes a "leaders"/"career" query to the career leaders table', () => {
    const match = intentFor('brownlow career votes leader');
    expect(match?.href).toBe('/brownlow#brownlow-leaders');
  });

  it('routes via the awards-table hit even without the word "brownlow"', () => {
    // searchAwards() rewrites the Brownlow Medal award row's slug to
    // '/brownlow' (see searchAwards in db/queries/search.ts); the intent
    // parser recognises that rewritten slug as equivalent to the keyword.
    const match = intentFor('fairest and best richmond', {
      bestAward: { slug: '/brownlow', title: 'Brownlow Medal', score: 1000 },
    });
    expect(match?.href).toBe('/brownlow?club=richmond#brownlow-winners');
  });

  it('adds a season range when a year is present with no club', () => {
    const match = intentFor('brownlow 1989');
    expect(match?.href).toBe('/brownlow?season_min=1989&season_max=1989#brownlow-winners');
  });
});

describe('resolveIntent — Draft', () => {
  it('treats a bare club as "drafted to"', () => {
    const match = intentFor('draft richmond 2015');
    expect(match?.href).toBe('/draft?year=2015&club=richmond');
  });

  it('treats "from"/"out of" wording as the feeder club', () => {
    const match = intentFor('draft picks from essendon');
    expect(match?.href).toBe('/draft?origin=Essendon');
  });

  it('reads a feeder club straight off the query, since most are not AFL clubs', () => {
    // Claremont is a WAFL club — it isn't in the `clubs` table at all, so
    // this only works by parsing "from <text>" directly, not via `club`.
    const match = intentFor('draft picks from claremont');
    expect(match?.href).toBe('/draft?origin=Claremont');
  });

  it('falls back to a bare link when no club or year is present', () => {
    expect(intentFor('draft')?.href).toBe('/draft');
  });
});

describe('resolveIntent — records and awards', () => {
  it('links a confident record match with a club to the filtered category page', () => {
    const match = intentFor('most goals richmond', {
      bestRecord: { slug: 'most-goals', title: 'Most Goals', score: 1000 },
    });
    expect(match?.href).toBe('/records/most-goals?club=richmond');
  });

  it('ignores a weak record match even with a club present', () => {
    const match = intentFor('some vague phrase richmond', {
      bestRecord: { slug: 'most-goals', title: 'Most Goals', score: 250 },
    });
    expect(match).toBeNull();
  });

  it('links a confident non-Brownlow award match with a club', () => {
    const match = intentFor('coleman medal essendon', {
      bestAward: { slug: 'coleman', title: 'Coleman Medal', score: 1000 },
    });
    expect(match?.href).toBe('/awards/coleman?club=essendon');
  });

  it('does not fire a record/award match without a club', () => {
    const match = intentFor('most goals', {
      bestRecord: { slug: 'most-goals', title: 'Most Goals', score: 1000 },
    });
    expect(match).toBeNull();
  });
});

describe('resolveIntent — no match', () => {
  it('returns null for a query the registry does not recognise', () => {
    expect(intentFor('michael tuck')).toBeNull();
  });

  it('returns null for an empty query', () => {
    expect(intentFor('')).toBeNull();
  });
});
