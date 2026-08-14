import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SORT,
  FIELDS,
  LIMITS,
  buildQueryString,
  parseAdvancedQuery,
} from '@/search/advanced-spec';

describe('parseAdvancedQuery', () => {
  it('parses a range filter', () => {
    const { query } = parseAdvancedQuery({ games_min: '200', games_max: '249' });
    expect(query.filters).toEqual([{ field: 'games', min: 200, max: 249 }]);
  });

  it('ignores unknown parameters rather than failing', () => {
    const { query, errors } = parseAdvancedQuery({ nonsense_min: '5', games_min: '10' });
    expect(query.filters).toEqual([{ field: 'games', min: 10 }]);
    expect(errors).toEqual([]);
  });

  it('clamps values above the field maximum', () => {
    const { query } = parseAdvancedQuery({ games_min: '999999999' });
    expect(query.filters[0].min).toBe(FIELDS.games.max);
  });

  it('reports an inverted range instead of running it', () => {
    const { query, errors } = parseAdvancedQuery({ games_min: '300', games_max: '100' });
    expect(query.filters).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('falls back to the default sort for an unknown sort key', () => {
    const { query } = parseAdvancedQuery({ sort: 'games; DROP TABLE players;--' });
    expect(query.sort).toBe(DEFAULT_SORT);
  });

  it('accepts an allowlisted sort key', () => {
    const { query } = parseAdvancedQuery({ sort: 'brownlow_votes' });
    expect(query.sort).toBe('brownlow_votes');
  });

  it('rejects club slugs that are not slug-shaped', () => {
    const { query } = parseAdvancedQuery({ club: "geelong,'; DROP TABLE players;--" });
    expect(query.clubSlugs).toEqual(['geelong']);
  });

  it('caps the number of club filters', () => {
    const { query } = parseAdvancedQuery({
      club: Array.from({ length: 20 }, (_, i) => `club-${i}`).join(','),
    });
    expect(query.clubSlugs).toHaveLength(LIMITS.maxClubFilters);
  });

  it('bounds page depth', () => {
    const { query } = parseAdvancedQuery({ page: '99999' });
    expect(query.page).toBe(LIMITS.maxPage);
  });

  it('treats a negative page as page 1', () => {
    expect(parseAdvancedQuery({ page: '-5' }).query.page).toBe(1);
  });
});

describe('buildQueryString', () => {
  it('round-trips a query so links stay shareable', () => {
    const original = parseAdvancedQuery({
      games_min: '200', goals_min: '100', finals_min: '15', sort: 'goals',
    }).query;

    const reparsed = parseAdvancedQuery(
      Object.fromEntries(new URLSearchParams(buildQueryString(original))),
    ).query;

    expect(reparsed.filters).toEqual(original.filters);
    expect(reparsed.sort).toBe(original.sort);
  });
});

describe('field allowlist', () => {
  it('exposes no era-limited statistic as a filter', () => {
    // Filtering on a statistic that was not collected before the 1960s
    // would silently exclude early players, implying they recorded none.
    const eraLimited = ['disposals', 'tackles', 'hitouts', 'marks', 'kicks', 'handballs'];
    for (const key of eraLimited) {
      expect(FIELDS[key]).toBeUndefined();
    }
  });

  it('binds every field to a fixed column', () => {
    for (const field of Object.values(FIELDS)) {
      expect(field.column).toMatch(/^c\.[a-z_]+$/);
    }
  });
});
