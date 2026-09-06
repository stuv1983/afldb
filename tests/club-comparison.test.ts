/**
 * AFLDB-ISSUE-144 Stage 7 — the URL contract of /clubs/compare.
 *
 * Database-free by construction: these are statements about what a URL
 * means, and the two URLs this surface produces must never be confused.
 * The state resolution that reads canonical rows is proved separately in
 * tests/integration/club-comparison-route.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  CLUB_COMPARE_PATH,
  canonicalClubComparePath,
  canonicalPairOrder,
  clubCompareBaseParams,
  clubComparePath,
  isMatchType,
  swapClubComparePath,
} from '@/lib/club-comparison-url';

describe('AFLDB-ISSUE-144 Stage 7: shareable current-state URLs', () => {
  it('carries the pair in the order it was asked for', () => {
    expect(clubComparePath({ club1: 'brisbane-lions', club2: 'adelaide' }))
      .toBe('/clubs/compare?club1=brisbane-lions&club2=adelaide');
  });

  it('carries match filter and page', () => {
    expect(clubComparePath({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals', page: 3,
    })).toBe('/clubs/compare?club1=carlton&club2=collingwood&matchType=finals&page=3');
  });

  it('carries the era (Club Rivalry Explorer follow-up, FR-2)', () => {
    expect(clubComparePath({
      club1: 'carlton', club2: 'collingwood', era: 1990,
    })).toBe('/clubs/compare?club1=carlton&club2=collingwood&era=1990');
  });

  it('omits the defaults so the shared URL stays the short one', () => {
    expect(clubComparePath({
      club1: 'carlton', club2: 'collingwood', matchType: 'all', page: 1,
    })).toBe('/clubs/compare?club1=carlton&club2=collingwood');
    expect(clubComparePath({
      club1: 'carlton', club2: 'collingwood', era: null,
    })).toBe('/clubs/compare?club1=carlton&club2=collingwood');
  });

  it('is the bare surface when nothing is selected', () => {
    expect(clubComparePath({})).toBe(CLUB_COMPARE_PATH);
  });
});

describe('AFLDB-ISSUE-144 Stage 7: swap', () => {
  const state = {
    club1: 'carlton', club2: 'collingwood', matchType: 'finals' as const, page: 3,
  };

  it('reverses the clubs and nothing else', () => {
    expect(swapClubComparePath(state))
      .toBe('/clubs/compare?club1=collingwood&club2=carlton&matchType=finals&page=3');
  });

  it('preserves the era (Club Rivalry Explorer follow-up, FR-2)', () => {
    expect(swapClubComparePath({ ...state, era: 1990 }))
      .toBe('/clubs/compare?club1=collingwood&club2=carlton&matchType=finals&era=1990&page=3');
  });

  it('is its own inverse', () => {
    expect(swapClubComparePath({ ...state, club1: state.club2, club2: state.club1 }))
      .toBe(clubComparePath(state));
  });
});

describe('AFLDB-ISSUE-144 Stage 7: SEO canonical URL', () => {
  it('orders the pair alphabetically whichever way it was requested', () => {
    const canonical = '/clubs/compare?club1=adelaide&club2=brisbane-lions';
    expect(canonicalClubComparePath('adelaide', 'brisbane-lions')).toBe(canonical);
    expect(canonicalClubComparePath('brisbane-lions', 'adelaide')).toBe(canonical);
  });

  it('omits match filter and page', () => {
    const canonical = canonicalClubComparePath('carlton', 'collingwood');
    expect(canonical).toBe('/clubs/compare?club1=carlton&club2=collingwood');
    expect(canonical).not.toContain('matchType');
    expect(canonical).not.toContain('page');
  });

  it('never invents a pair from an incomplete selection', () => {
    expect(canonicalClubComparePath(null, null)).toBe(CLUB_COMPARE_PATH);
    expect(canonicalClubComparePath('carlton', null)).toBe(CLUB_COMPARE_PATH);
    expect(canonicalClubComparePath(null, 'carlton')).toBe(CLUB_COMPARE_PATH);
  });

  it('sorts independently of presentation order', () => {
    const [lower, higher] = canonicalPairOrder('western-bulldogs', 'essendon');
    expect([lower, higher]).toEqual(['essendon', 'western-bulldogs']);
  });
});

describe('AFLDB-ISSUE-144 Stage 7: match-type recognition', () => {
  it('accepts exactly the three canonical filters', () => {
    expect(isMatchType('all')).toBe(true);
    expect(isMatchType('home-and-away')).toBe(true);
    expect(isMatchType('finals')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMatchType('Finals')).toBe(false);
    expect(isMatchType('practice')).toBe(false);
    expect(isMatchType(undefined)).toBe(false);
  });
});

describe('AFLDB-ISSUE-144 Stage 7: pagination base parameters', () => {
  it('carries the view state the pager must preserve, without the page', () => {
    expect(clubCompareBaseParams({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals', page: 4,
    })).toEqual({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals',
    });
  });

  it('drops the default match filter', () => {
    expect(clubCompareBaseParams({ club1: 'carlton', club2: 'collingwood', matchType: 'all' }))
      .toEqual({
        club1: 'carlton', club2: 'collingwood', matchType: undefined,
      });
  });

  it('carries the era so an era-filtered match history keeps its era across pages', () => {
    expect(clubCompareBaseParams({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals', era: 1990, page: 4,
    })).toEqual({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals', era: '1990',
    });
  });

  it('drops an absent era', () => {
    expect(clubCompareBaseParams({ club1: 'carlton', club2: 'collingwood' }))
      .toEqual({ club1: 'carlton', club2: 'collingwood', matchType: undefined, era: undefined });
  });
});
