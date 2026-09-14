/**
 * AFLDB-ISSUE-170 Stage 2A — the URL contract of /coaches/compare.
 *
 * Database-free by construction, mirroring tests/club-comparison.test.ts:
 * these are statements about what a URL means. Route-state resolution
 * against real coach rows is proved separately in
 * tests/integration/coach-comparison-route.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  COACH_COMPARE_PATH,
  canonicalCoachComparePath,
  canonicalPairOrder,
  coachComparePath,
  swapCoachComparePath,
} from '@/lib/coach-comparison-url';

describe('AFLDB-ISSUE-170 Stage 2A: shareable current-state URLs', () => {
  it('carries the pair in the order it was asked for', () => {
    expect(coachComparePath({ a: 5, b: 12 })).toBe('/coaches/compare?a=5&b=12');
  });

  it('carries only the side that is chosen', () => {
    expect(coachComparePath({ a: 5 })).toBe('/coaches/compare?a=5');
    expect(coachComparePath({ b: 12 })).toBe('/coaches/compare?b=12');
  });

  it('is the bare surface when nothing is selected', () => {
    expect(coachComparePath({})).toBe(COACH_COMPARE_PATH);
    expect(coachComparePath({ a: null, b: null })).toBe(COACH_COMPARE_PATH);
  });
});

describe('AFLDB-ISSUE-170 Stage 2A: swap', () => {
  it('reverses the coaches and nothing else', () => {
    expect(swapCoachComparePath({ a: 5, b: 12 })).toBe('/coaches/compare?a=12&b=5');
  });

  it('is its own inverse', () => {
    const state = { a: 5, b: 12 };
    expect(swapCoachComparePath({ a: state.b, b: state.a })).toBe(coachComparePath(state));
  });

  it('swaps a half-selection too', () => {
    expect(swapCoachComparePath({ a: 5 })).toBe('/coaches/compare?b=5');
  });
});

describe('AFLDB-ISSUE-170 Stage 2A: SEO canonical URL', () => {
  it('orders the pair by id ascending whichever way it was requested', () => {
    const canonical = '/coaches/compare?a=5&b=12';
    expect(canonicalCoachComparePath(5, 12)).toBe(canonical);
    expect(canonicalCoachComparePath(12, 5)).toBe(canonical);
  });

  it('canonicalises to the bare surface when the pair is incomplete', () => {
    expect(canonicalCoachComparePath(5, null)).toBe(COACH_COMPARE_PATH);
    expect(canonicalCoachComparePath(undefined, 12)).toBe(COACH_COMPARE_PATH);
    expect(canonicalCoachComparePath(null, null)).toBe(COACH_COMPARE_PATH);
  });

  it('orders a tied id pair stably', () => {
    expect(canonicalPairOrder(5, 5)).toEqual([5, 5]);
  });
});
