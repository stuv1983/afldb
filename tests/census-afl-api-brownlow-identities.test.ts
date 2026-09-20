/**
 * AFLDB-ISSUE-228 §9.10 — regression coverage for the two confirmed stale
 * diagnostics in `tools/current-season/census-afl-api-brownlow-identities.ts`.
 *
 * DB-free: both functions under test are pure, extracted exactly as
 * `resolvePlayerCached` was extracted from the sibling audit tool
 * (`tests/audit-afl-api-brownlow-canonical-equality.test.ts`), so no
 * postgres client is opened here.
 */
import { describe, expect, it } from 'vitest';

import {
  bucketSummaryHeading,
  shouldRunFirstMatchCheck,
} from '../tools/current-season/census-afl-api-brownlow-identities';

describe('bucketSummaryHeading (AFLDB-ISSUE-228 census provider count)', () => {
  it('reports the measured 2022 provider population (207), not the stale hard-coded 2025 count (188)', () => {
    expect(bucketSummaryHeading(207)).toBe('=== Bucket summary (207 distinct provider players) ===');
  });

  it('is dynamic across any measured population, including the 2025 figure it used to hard-code', () => {
    expect(bucketSummaryHeading(188)).toBe('=== Bucket summary (188 distinct provider players) ===');
    expect(bucketSummaryHeading(0)).toBe('=== Bucket summary (0 distinct provider players) ===');
  });
});

describe('shouldRunFirstMatchCheck (AFLDB-ISSUE-228 first-match diagnostic gate)', () => {
  it('runs only for season 2025, the season FIRST_MATCH_CHECK_IDS was captured from', () => {
    expect(shouldRunFirstMatchCheck(2025)).toBe(true);
  });

  it('is skipped for 2022 and every other non-2025 season', () => {
    expect(shouldRunFirstMatchCheck(2022)).toBe(false);
    expect(shouldRunFirstMatchCheck(2023)).toBe(false);
    expect(shouldRunFirstMatchCheck(2024)).toBe(false);
    expect(shouldRunFirstMatchCheck(2026)).toBe(false);
  });
});
