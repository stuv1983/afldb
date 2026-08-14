import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MATCH_SORT,
  MATCH_FIELDS,
  MATCH_LIMITS,
  buildMatchQueryString,
  describeMatchQuery,
  matchFieldValue,
  parseMatchSearchQuery,
} from '@/search/match-spec';

describe('parseMatchSearchQuery', () => {
  it('parses a range filter', () => {
    const { query } = parseMatchSearchQuery({ margin_min: '1', margin_max: '5' });
    expect(query.filters).toEqual([{ field: 'margin', min: 1, max: 5 }]);
  });

  it('ignores unknown parameters rather than failing', () => {
    const { query, errors } = parseMatchSearchQuery({ nonsense_min: '5', margin_min: '10' });
    expect(query.filters).toEqual([{ field: 'margin', min: 10 }]);
    expect(errors).toEqual([]);
  });

  it('reports an inverted range instead of running it', () => {
    const { query, errors } = parseMatchSearchQuery({ margin_min: '50', margin_max: '10' });
    expect(query.filters).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('falls back to the default sort for an unknown sort key', () => {
    const { query } = parseMatchSearchQuery({ sort: 'margin; DROP TABLE matches;--' });
    expect(query.sort).toBe(DEFAULT_MATCH_SORT);
  });

  it('drops club values that are not slug-shaped', () => {
    // Anything with quoting or whitespace is discarded outright; what
    // survives is only ever [a-z0-9-], which resolves to a club or to
    // nothing.
    const { query } = parseMatchSearchQuery({
      club: "collingwood'; DROP TABLE matches;--,carlton",
    });
    expect(query.clubSlugs).toEqual(['carlton']);
  });

  it('keeps a slug that matches no club rather than erroring', () => {
    const { query, errors } = parseMatchSearchQuery({ club: 'not-a-club' });
    expect(query.clubSlugs).toEqual(['not-a-club']);
    expect(errors).toEqual([]);
  });
});

describe('clamping is visible rather than silent', () => {
  it('says so when a bound is above the field maximum', () => {
    // The form echoed 999 while the query ran at 400, so the page showed
    // one search and described another.
    const { query, notices } = parseMatchSearchQuery({ margin_min: '999' });
    expect(query.filters[0].min).toBe(MATCH_FIELDS.margin.max);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('400');
  });

  it('says nothing when the value is already in range', () => {
    const { notices } = parseMatchSearchQuery({ margin_min: '5' });
    expect(notices).toEqual([]);
  });

  it('reports a page beyond the cap', () => {
    const { query, notices } = parseMatchSearchQuery({ page: '9999' });
    expect(query.page).toBe(MATCH_LIMITS.maxPage);
    expect(notices).toHaveLength(1);
  });

  it('reports clubs dropped past the limit', () => {
    const { query, notices } = parseMatchSearchQuery({
      club: 'collingwood,carlton,essendon',
    });
    expect(query.clubSlugs).toHaveLength(MATCH_LIMITS.maxClubFilters);
    expect(notices).toHaveLength(1);
  });
});

describe('form state follows the parsed query', () => {
  it('shows the clamped value, not the raw one', () => {
    const { query } = parseMatchSearchQuery({ margin_min: '999' });
    expect(matchFieldValue(query, 'margin', 'min')).toBe('400');
  });

  it('is empty for a field with no filter', () => {
    const { query } = parseMatchSearchQuery({});
    expect(matchFieldValue(query, 'margin', 'min')).toBe('');
  });
});

describe('multiple clubs survive a round trip', () => {
  it('accepts a comma-separated list', () => {
    const { query } = parseMatchSearchQuery({ club: 'collingwood,carlton' });
    expect(query.clubSlugs).toEqual(['collingwood', 'carlton']);
  });

  it('accepts a repeated parameter, as a multiple-select posts it', () => {
    const { query } = parseMatchSearchQuery({ club: ['collingwood', 'carlton'] });
    expect(query.clubSlugs).toEqual(['collingwood', 'carlton']);
  });

  it('de-duplicates', () => {
    const { query } = parseMatchSearchQuery({ club: 'carlton,carlton' });
    expect(query.clubSlugs).toEqual(['carlton']);
  });

  it('keeps both clubs in the canonical URL', () => {
    const { query } = parseMatchSearchQuery({ club: 'collingwood,carlton' });
    const rebuilt = parseMatchSearchQuery(
      Object.fromEntries(new URLSearchParams(buildMatchQueryString(query))),
    );
    expect(rebuilt.query.clubSlugs).toEqual(['collingwood', 'carlton']);
  });
});

describe('buildMatchQueryString', () => {
  it('round-trips a full query', () => {
    const { query } = parseMatchSearchQuery({
      margin_min: '1', margin_max: '5', low_score_min: '100',
      outcome: 'decided', match_type: 'finals', sort: 'margin_asc', page: '3',
    });
    const rebuilt = parseMatchSearchQuery(
      Object.fromEntries(new URLSearchParams(buildMatchQueryString(query))),
    );
    expect(rebuilt.query).toEqual(query);
  });

  it('omits defaults so the shareable URL stays short', () => {
    const { query } = parseMatchSearchQuery({ margin_max: '5' });
    const built = buildMatchQueryString(query);
    expect(built).not.toContain('outcome');
    expect(built).not.toContain('match_type');
    expect(built).not.toContain('page');
  });
});

describe('describeMatchQuery', () => {
  it('describes a two-sided range', () => {
    const { query } = parseMatchSearchQuery({ margin_min: '1', margin_max: '5' });
    expect(describeMatchQuery(query)).toEqual(['Margin (points) 1–5']);
  });

  it('describes each active filter, not just the first', () => {
    const { query } = parseMatchSearchQuery({
      margin_max: '5', low_score_min: '100', outcome: 'decided', match_type: 'finals',
    });
    expect(describeMatchQuery(query)).toHaveLength(4);
  });
});
