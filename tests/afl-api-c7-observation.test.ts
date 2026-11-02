/**
 * AFLDB-ISSUE-316 C7 observer: the pure classifier and the argument parser. The reader's SQL is
 * exercised against an isolated PostgreSQL in tests/integration/afl-api-c7-observation.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  C7_ERROR_COUNTERS, C7_EXIT_CODES, classifyC7, type C7Batch, type C7Facts,
} from '../src/lib/acquisition/afl-api-c7-observation';
import { parseArgs } from '../tools/v2/c7-observe';

const clean = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  seasonFeedMatches: 218, seasonFeedComplete: 1, seasonFeedStatusCounts: { CONCLUDED: 9, SCHEDULED: 209 },
  derivedRecomputeRuns: 1, ...extra,
});
const batch = (over: Partial<C7Batch> = {}): C7Batch => ({
  id: '80', status: 'completed', startedAt: '2027-03-21T18:00:00Z', completedAt: '2027-03-21T18:03:00Z',
  season: 2027, counters: clean(), ...over,
});
const none = { matches: 0, withPeriodScores: 0, withPlayerStatsBothClubs: 0, otherSource: 0 };
const facts = (over: Partial<C7Facts> = {}): C7Facts => ({
  database: 'afldb_prod', season: 2027, since: '2026-11-03T00:00:00.000Z', round: null, expectedConcluded: null,
  batches: [batch()],
  canonical: { matches: 9, withPeriodScores: 9, withPlayerStatsBothClubs: 9, otherSource: 0 },
  afltablesBatchesSince: 0, unit: null, ...over,
});

describe('classifyC7: five distinct outcomes', () => {
  it('NO_BATCH when no settle batch is retained', () => {
    const r = classifyC7(facts({ batches: [], canonical: none }));
    expect(r.verdict).toBe('NO_BATCH');
    expect(C7_EXIT_CODES[r.verdict]).toBe(13);
  });

  it('NO_CONCLUDED_MATCHES: a clean batch, an empty CONCLUDED count and no canonical match', () => {
    const r = classifyC7(facts({
      batches: [batch({ counters: clean({ seasonFeedStatusCounts: { SCHEDULED: 218 } }) })],
      canonical: none,
    }));
    expect(r.verdict).toBe('NO_CONCLUDED_MATCHES');
    expect(r.reasons.join(' ')).toMatch(/nothing to accept yet/);
  });

  it('NO_CONCLUDED_MATCHES is not a failure even when other-source matches exist', () => {
    const r = classifyC7(facts({
      batches: [batch({ counters: clean({ seasonFeedStatusCounts: {} }) })],
      canonical: { ...none, otherSource: 3 },
    }));
    expect(r.verdict).toBe('NO_CONCLUDED_MATCHES');
  });

  it('INCOMPLETE_ACQUISITION when the season feed was not proven complete', () => {
    const r = classifyC7(facts({ batches: [batch({ counters: clean({ seasonFeedComplete: 0 }) })] }));
    expect(r.verdict).toBe('INCOMPLETE_ACQUISITION');
  });

  it('INCOMPLETE_ACQUISITION when fewer canonical matches than CONCLUDED', () => {
    const r = classifyC7(facts({ canonical: { matches: 7, withPeriodScores: 7, withPlayerStatsBothClubs: 7, otherSource: 0 } }));
    expect(r.verdict).toBe('INCOMPLETE_ACQUISITION');
    expect(r.reasons.join(' ')).toMatch(/2 concluded match\(es\) are not settled yet/);
  });

  it('INCOMPLETE_ACQUISITION when period scores or both sides statistics are missing', () => {
    const r = classifyC7(facts({ canonical: { matches: 9, withPeriodScores: 8, withPlayerStatsBothClubs: 7, otherSource: 0 } }));
    expect(r.verdict).toBe('INCOMPLETE_ACQUISITION');
    expect(r.reasons).toHaveLength(2);
  });

  it('FAILED_PROCESSING for a batch that is not completed', () => {
    const r = classifyC7(facts({ batches: [batch({ id: '81', status: 'failed', counters: null }), batch()] }));
    expect(r.verdict).toBe('FAILED_PROCESSING');
    expect(r.reasons[0]).toMatch(/81/);
  });

  it.each(C7_ERROR_COUNTERS)('FAILED_PROCESSING when %s is non-zero', (key) => {
    const r = classifyC7(facts({ batches: [batch({ counters: clean({ [key]: 1 }) })] }));
    expect(r.verdict).toBe('FAILED_PROCESSING');
    expect(r.reasons.join(' ')).toContain(`${key}=1`);
  });

  it('FAILED_PROCESSING when AFL Tables batches appear after the cutover', () => {
    expect(classifyC7(facts({ afltablesBatchesSince: 1 })).verdict).toBe('FAILED_PROCESSING');
  });

  it('FAILED_PROCESSING when the unit result is not success/0, and it outranks an empty feed', () => {
    const r = classifyC7(facts({
      unit: { result: 'exit-code', execMainStatus: '1' },
      batches: [batch({ counters: clean({ seasonFeedStatusCounts: {} }) })],
      canonical: none,
    }));
    expect(r.verdict).toBe('FAILED_PROCESSING');
  });

  it('FAILED_PROCESSING when counts contradict (canonical > CONCLUDED, or canonical with 0 CONCLUDED)', () => {
    expect(classifyC7(facts({ canonical: { matches: 10, withPeriodScores: 10, withPlayerStatsBothClubs: 10, otherSource: 0 } })).verdict).toBe('FAILED_PROCESSING');
    const r = classifyC7(facts({
      batches: [batch({ counters: clean({ seasonFeedStatusCounts: {} }) })],
      canonical: { matches: 1, withPeriodScores: 1, withPlayerStatsBothClubs: 1, otherSource: 0 },
    }));
    expect(r.verdict).toBe('FAILED_PROCESSING');
  });

  it('FAILED_PROCESSING when no batch reports a derived recompute', () => {
    const r = classifyC7(facts({ batches: [batch({ counters: clean({ derivedRecomputeRuns: 0 }) })] }));
    expect(r.verdict).toBe('FAILED_PROCESSING');
  });

  it('MEASURED_CRITERIA_MET, never claiming more than it measured', () => {
    const r = classifyC7(facts());
    expect(r.verdict).toBe('MEASURED_CRITERIA_MET');
    expect(C7_EXIT_CODES[r.verdict]).toBe(0);
    expect(r.notMeasured.join(' ')).toMatch(/criterion 8/);
    expect(r.notMeasured.join(' ')).toMatch(/criterion 1/);
  });

  it('supplying the unit result removes the criterion-1 gap, but never criterion 8', () => {
    const r = classifyC7(facts({ unit: { result: 'success', execMainStatus: '0' } }));
    expect(r.verdict).toBe('MEASURED_CRITERIA_MET');
    expect(r.notMeasured.join(' ')).not.toMatch(/criterion 1:/);
    expect(r.notMeasured.join(' ')).toMatch(/criterion 8/);
  });

  it('a round-scoped observation uses the owner-supplied expectation, and requires it', () => {
    const scoped = facts({
      round: '1', expectedConcluded: 9,
      batches: [batch({ counters: clean({ seasonFeedStatusCounts: { CONCLUDED: 12 } }) })],
    });
    expect(classifyC7(scoped).verdict).toBe('MEASURED_CRITERIA_MET');
    expect(() => classifyC7({ ...scoped, expectedConcluded: null })).toThrow(/expected-concluded/);
  });

  it('ignores batches the notes place in another season, keeps those that name none', () => {
    expect(classifyC7(facts({ batches: [batch({ season: 2026, counters: null, status: 'failed' }), batch()] })).verdict).toBe('MEASURED_CRITERIA_MET');
    expect(classifyC7(facts({ batches: [batch({ season: null })] })).verdict).toBe('MEASURED_CRITERIA_MET');
  });

  it('uses the NEWEST completed batch for counters', () => {
    const r = classifyC7(facts({ batches: [batch({ id: '82', counters: clean({ unresolvedIdentityPlayer: 2 }) }), batch({ id: '80' })] }));
    expect(r.verdict).toBe('FAILED_PROCESSING');
    expect(r.figures.newestCompletedBatch).toBe('82');
  });
});

describe('c7-observe argument parsing', () => {
  const ok = ['--season', '2027', '--since', '2026-11-03T00:00:00Z'];
  it('accepts the minimal form and normalises since', () => {
    const a = parseArgs(ok);
    expect(a).toMatchObject({ season: 2027, since: '2026-11-03T00:00:00.000Z', round: null, unit: null, dsnEnv: 'DATABASE_URL', json: false });
  });
  it.each([
    [['--season', 'x', '--since', '2026-11-03']],
    [['--season', '2027']],
    [['--season', '2027', '--since', 'not-a-date']],
    [[...ok, '--round', '1']],
    [[...ok, '--unit-result', 'success']],
    [[...ok, '--bogus', '1']],
    [[...ok, 'stray']],
    [[...ok, '--expected-concluded', '-1']],
  ])('rejects %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
  it('accepts a round with an expectation and a paired unit result', () => {
    const a = parseArgs([...ok, '--round', '1', '--expected-concluded', '9', '--unit-result', 'success', '--unit-exec-status', '0', '--json']);
    expect(a).toMatchObject({ round: '1', expectedConcluded: 9, json: true, unit: { result: 'success', execMainStatus: '0' } });
  });
});
