/**
 * AFLDB-ISSUE-200 extraction tooling.
 *
 * DB-free: builds synthetic RunRecords in memory (real input is the
 * external DEV artifact `results.jsonl`, which this repository does not
 * carry) shaped to exercise scoreRow's real branches for each of the three
 * target classes, then proves extractAudit's invariants -- exact class
 * filtering, mutual-exclusivity, duplicate-id rejection, exact count
 * reconciliation, and deterministic auto_cluster_key construction.
 */
import { describe, expect, it } from 'vitest';

import { NL_LIMITS } from '@/search/nl/plan';

import {
  DISPOSITIONS, EXPECTED_CLASS_COUNTS, EXPECTED_TOTAL, isDisposition, selectTargetFinding,
} from '../tools/nl/audit-issue-200-shared';
import type { StressExpectation, StressObservation } from '../tools/nl/corpus';
import {
  buildAutoClusterKey, buildEntityIndexFromJson, extractAudit, parseResultsJsonl, pickMostFrequentTerm,
  type RunRecord,
} from '../tools/nl/audit-issue-200-extract';

// ------------------------------------------------------------------ fixtures

function baseExpectation(id: number, overrides: Partial<StressExpectation> = {}): StressExpectation {
  return {
    id,
    category: 'filler',
    difficulty: 1,
    verificationLevel: 'SEMANTIC',
    equivalenceGroup: 'tm|group',
    question: `Filler question ${id}`,
    status: 'success',
    notes: '',
    ...overrides,
  };
}

function baseObservation(overrides: Partial<StressObservation> = {}): StressObservation {
  return {
    status: 'success',
    executed: false,
    confidence: null,
    plan: null,
    unsupportedTerms: [],
    coverageNote: null,
    leadName: null,
    leadValue: null,
    total: null,
    tieCount: null,
    durationMs: 1,
    ...overrides,
  };
}

/**
 * A plan minimal enough to satisfy every required NlQueryPlan field without
 * asserting anything a given fixture doesn't care about. `limit` mirrors the
 * parser's own default for a max/min plan (src/search/nl/parser.ts:3774:
 * `agg.kind === 'top_n' || 'list' ? 100 : 25`) -- consistent with this
 * helper's default `agg: { kind: 'max' }`.
 */
function minimalPlan(overrides: Partial<NonNullable<StressObservation['plan']>> = {}): NonNullable<StressObservation['plan']> {
  return {
    v: 1,
    grain: 'player_game',
    metric: null,
    agg: { kind: 'max' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: NL_LIMITS.maxTiedRows,
    ...overrides,
  };
}

/** Exercises scoreRow's `seasonSumForSeasonRank` branch (corpus.ts:464-472): expected player_season, plan player_game/sum over one pinned season. */
function grainEquivalentRecord(id: number): RunRecord {
  return {
    expected: baseExpectation(id, { grain: 'player_season', equivalenceGroup: 'ps|group' }),
    actual: baseObservation({
      plan: minimalPlan({ grain: 'player_game', mode: 'sum', scope: { seasonMin: 2020, seasonMax: 2020 } }),
    }),
  };
}

/** Exercises scoreRow's decline/wrong-reason branch (corpus.ts:420-429). */
function wrongFailureReasonRecord(id: number): RunRecord {
  return {
    expected: baseExpectation(id, { status: 'decline', failureReason: 'ambiguous_player' }),
    actual: baseObservation({ status: 'decline', failureReason: 'low_confidence' }),
  };
}

/** Exercises scoreRow's unexpected-decline branch (corpus.ts:432-437). */
function unexpectedDeclineRecord(
  id: number,
  opts: { reason?: string; terms?: string[]; template?: string } = {},
): RunRecord {
  return {
    expected: baseExpectation(id, { equivalenceGroup: `${opts.template ?? 'tm'}|group` }),
    actual: baseObservation({
      status: 'decline',
      failureReason: opts.reason ?? 'ambiguous_player',
      unsupportedTerms: opts.terms ?? [],
    }),
  };
}

/** A genuinely clean pass: no expectation assertion is violated, no finding of any kind. */
function cleanPassRecord(id: number): RunRecord {
  return { expected: baseExpectation(id), actual: baseObservation({ plan: minimalPlan() }) };
}

/** A hard failure unrelated to the three target classes (WRONG_GRAIN: expected player_career, no pinned-season equivalence). */
function hardFailureRecord(id: number): RunRecord {
  return {
    expected: baseExpectation(id, { grain: 'player_career' }),
    actual: baseObservation({ plan: minimalPlan({ grain: 'player_game' }) }),
  };
}

/** A soft finding that is NOT one of the three ISSUE-200 target classes (LOW_CONFIDENCE). */
function lowConfidenceRecord(id: number): RunRecord {
  return {
    expected: baseExpectation(id, { minConfidence: 0.9 }),
    actual: baseObservation({ plan: minimalPlan(), confidence: 0.5 }),
  };
}

/**
 * Builds exactly the 1,063-row baseline (72/921/70), with a handful of the
 * UNEXPECTED_DECLINE rows carrying overlapping unsupported terms so the
 * batch-level term-frequency clustering has something real to compute over.
 * All other UNEXPECTED_DECLINE rows use a plain 'ambiguous_player' reason,
 * which never touches unsupportedTerms, so the frequency table stays
 * isolated to the designed subset.
 */
function buildBaselineRecords(): RunRecord[] {
  const records: RunRecord[] = [];
  let id = 1;
  for (let i = 0; i < EXPECTED_CLASS_COUNTS.GRAIN_EQUIVALENT; i++) records.push(grainEquivalentRecord(id++));

  const termRowIds: { threeTerm: number[]; twoTerm: number[] } = { threeTerm: [], twoTerm: [] };
  for (let i = 0; i < 3; i++) { termRowIds.threeTerm.push(id); records.push(unexpectedDeclineRecord(id++, { reason: 'unsupported_term', terms: ['coach', 'finals'] })); }
  for (let i = 0; i < 2; i++) { termRowIds.twoTerm.push(id); records.push(unexpectedDeclineRecord(id++, { reason: 'unsupported_term', terms: ['finals'] })); }
  const genericDeclineCount = EXPECTED_CLASS_COUNTS.UNEXPECTED_DECLINE - 5;
  for (let i = 0; i < genericDeclineCount; i++) records.push(unexpectedDeclineRecord(id++));

  for (let i = 0; i < EXPECTED_CLASS_COUNTS.WRONG_FAILURE_REASON; i++) records.push(wrongFailureReasonRecord(id++));

  return records;
}

// --------------------------------------------------------------------- tests

describe('extractAudit', () => {
  it('extracts exactly 72/921/70 (1063 total) and excludes non-target rows', () => {
    const records = [
      ...buildBaselineRecords(),
      cleanPassRecord(9001),
      hardFailureRecord(9002),
      lowConfidenceRecord(9003),
    ];

    const { rows, summary } = extractAudit(records);

    expect(summary.totalRecordsRead).toBe(EXPECTED_TOTAL + 3);
    expect(summary.includedByClass.GRAIN_EQUIVALENT).toBe(72);
    expect(summary.includedByClass.UNEXPECTED_DECLINE).toBe(921);
    expect(summary.includedByClass.WRONG_FAILURE_REASON).toBe(70);
    expect(summary.includedTotal).toBe(EXPECTED_TOTAL);
    expect(summary.excludedTotal).toBe(3);
    expect(rows).toHaveLength(EXPECTED_TOTAL);

    const ids = new Set(rows.map((r) => r.id));
    expect(ids.has('9001')).toBe(false);
    expect(ids.has('9002')).toBe(false);
    expect(ids.has('9003')).toBe(false);

    // every row's `cluster`/`provisional_disposition` start blank -- filled only by the cluster script's join
    expect(rows.every((r) => r.cluster === '' && r.provisional_disposition === '')).toBe(true);
  });

  it('re-scores using the real scoreRow, so a GRAIN_EQUIVALENT row carries the exact finding text scoreRow produces', () => {
    const { rows } = extractAudit(buildBaselineRecords());
    const row = rows.find((r) => r.id === '1')!; // buildBaselineRecords' first row is always a grainEquivalentRecord
    expect(row.class).toBe('GRAIN_EQUIVALENT');
    expect(row.finding_expected).toBe('player_season');
    expect(row.finding_actual).toBe('player_game/sum over one season');
    expect(row.expected_grain).toBe('player_season');
    expect(row.actual_grain).toBe('player_game');
    expect(row.actual_mode).toBe('sum');
  });

  it('carries expected/actual entity and season fields through for a WRONG_FAILURE_REASON row', () => {
    const baseline = buildBaselineRecords().filter((r) => r.expected.id !== 994); // first WRONG_FAILURE_REASON id
    const record: RunRecord = {
      expected: baseExpectation(994, {
        status: 'decline', failureReason: 'ambiguous_player', club: 'Richmond', seasonFrom: 2015,
      }),
      actual: baseObservation({ status: 'decline', failureReason: 'low_confidence' }),
    };
    const { rows } = extractAudit([...baseline, record]);
    const row = rows.find((r) => r.id === '994')!;
    expect(row.class).toBe('WRONG_FAILURE_REASON');
    expect(row.expected_failure_reason).toBe('ambiguous_player');
    expect(row.actual_failure_reason).toBe('low_confidence');
    expect(row.expected_club).toBe('Richmond');
    expect(row.expected_season_from).toBe('2015');
    expect(row.auto_cluster_key).toBe('ambiguous_player->low_confidence');
  });

  it('flattens expected/career conditions into a readable "column op value; ..." form', () => {
    const record: RunRecord = {
      expected: baseExpectation(1, {
        grain: 'player_season', equivalenceGroup: 'ps|group',
        conditions: [{ column: 'games', op: 'gte', value: 200 }],
      }),
      actual: baseObservation({
        plan: minimalPlan({
          grain: 'player_game', mode: 'sum', scope: { seasonMin: 2020, seasonMax: 2020 },
          careerConditions: [
            { kind: 'column', column: 'games', op: 'gte', value: 200 },
            { kind: 'award_count', awardKey: 'all_australian', op: 'eq', value: 1 },
          ],
        }),
      }),
    };
    const { rows } = extractAudit([record, ...buildBaselineRecords().slice(1)]);
    const row = rows.find((r) => r.id === '1')!;
    expect(row.expected_conditions).toBe('games gte 200');
    expect(row.actual_career_conditions).toBe('games gte 200; all_australian eq 1');
  });

  it('rejects duplicate row ids in the input', () => {
    const records = [grainEquivalentRecord(5), grainEquivalentRecord(5)];
    expect(() => extractAudit(records)).toThrow(/duplicate row id\(s\): 5/);
  });

  it('rejects an output that would not reconcile to the exact per-class baseline', () => {
    const short = buildBaselineRecords().slice(1); // one GRAIN_EQUIVALENT row short
    expect(() => extractAudit(short)).toThrow(/Expected exactly 72 GRAIN_EQUIVALENT rows, found 71/);
  });

  it('rejects a total that does not reconcile even if class-shaped records happen to overshoot', () => {
    const extra = [...buildBaselineRecords(), grainEquivalentRecord(9999)];
    expect(() => extractAudit(extra)).toThrow(/Expected exactly 72 GRAIN_EQUIVALENT rows, found 73/);
  });
});

describe('selectTargetFinding', () => {
  it('returns none when no target-class finding is present', () => {
    expect(selectTargetFinding([{ class: 'WRONG_GRAIN', severity: 'hard', expected: 'a', actual: 'b' }])).toEqual({ kind: 'none' });
  });

  it('returns the one target-class finding when exactly one is present', () => {
    const finding = { class: 'GRAIN_EQUIVALENT' as const, severity: 'soft' as const, expected: 'a', actual: 'b' };
    expect(selectTargetFinding([finding])).toEqual({ kind: 'one', class: 'GRAIN_EQUIVALENT', finding });
  });

  it('flags more than one target-class finding rather than silently picking one', () => {
    const findings = [
      { class: 'GRAIN_EQUIVALENT' as const, severity: 'soft' as const, expected: 'a', actual: 'b' },
      { class: 'WRONG_FAILURE_REASON' as const, severity: 'soft' as const, expected: 'c', actual: 'd' },
    ];
    expect(selectTargetFinding(findings)).toEqual({ kind: 'multiple', classes: ['GRAIN_EQUIVALENT', 'WRONG_FAILURE_REASON'] });
  });
});

describe('buildAutoClusterKey', () => {
  it('builds the GRAIN_EQUIVALENT key from expected/actual grain and actual mode', () => {
    const expected = baseExpectation(1, { grain: 'player_season' });
    const actual = baseObservation({ plan: minimalPlan({ grain: 'player_game', mode: 'sum' }) });
    expect(buildAutoClusterKey('GRAIN_EQUIVALENT', expected, actual, 'tm', undefined)).toBe('player_season->player_game/sum');
  });

  it('builds the WRONG_FAILURE_REASON key from expected/actual failure reason', () => {
    const expected = baseExpectation(1, { failureReason: 'ambiguous_player' });
    const actual = baseObservation({ failureReason: 'low_confidence' });
    expect(buildAutoClusterKey('WRONG_FAILURE_REASON', expected, actual, 'tm', undefined)).toBe('ambiguous_player->low_confidence');
  });

  it('builds the UNEXPECTED_DECLINE key from actual failure reason and template, with no term suffix for a non-term reason', () => {
    const expected = baseExpectation(1);
    const actual = baseObservation({ status: 'decline', failureReason: 'ambiguous_player' });
    expect(buildAutoClusterKey('UNEXPECTED_DECLINE', expected, actual, 'h2h', undefined)).toBe('ambiguous_player|h2h');
  });

  it('appends the top unsupported term for an unsupported_term reason', () => {
    const expected = baseExpectation(1);
    const actual = baseObservation({ status: 'decline', failureReason: 'unsupported_term', unsupportedTerms: ['coach', 'finals'] });
    expect(buildAutoClusterKey('UNEXPECTED_DECLINE', expected, actual, 'career', 'finals')).toBe('unsupported_term|career|finals');
  });
});

describe('pickMostFrequentTerm', () => {
  it('picks the globally more frequent term among a row\'s own candidates', () => {
    const frequency = new Map([['coach', 3], ['finals', 5]]);
    expect(pickMostFrequentTerm(['coach', 'finals'], frequency)).toBe('finals');
  });

  it('breaks a frequency tie alphabetically, for determinism', () => {
    const frequency = new Map([['zeta', 2], ['alpha', 2]]);
    expect(pickMostFrequentTerm(['zeta', 'alpha'], frequency)).toBe('alpha');
  });

  it('returns undefined for an empty term list', () => {
    expect(pickMostFrequentTerm([], new Map())).toBeUndefined();
  });

  it('end to end: extractAudit clusters overlapping-term rows onto the globally dominant term', () => {
    const { rows } = extractAudit(buildBaselineRecords());
    // 'finals' appears in 5 of the 5 designed unsupported_term rows, 'coach' in only 3 -- every one
    // of those rows' auto_cluster_key should carry 'finals', including the 3 that also mention 'coach'.
    const termRows = rows.filter((r) => r.class === 'UNEXPECTED_DECLINE' && r.actual_failure_reason === 'unsupported_term');
    expect(termRows).toHaveLength(5);
    expect(termRows.every((r) => r.auto_cluster_key.endsWith('|finals'))).toBe(true);
  });
});

describe('parseResultsJsonl', () => {
  it('parses one RunRecord per non-blank line, preserving order', () => {
    const lines = [
      JSON.stringify({ expected: baseExpectation(1), actual: baseObservation() }),
      '',
      JSON.stringify({ expected: baseExpectation(2), actual: baseObservation() }),
      '',
    ].join('\n');
    const records = parseResultsJsonl(lines);
    expect(records.map((r) => r.expected.id)).toEqual([1, 2]);
  });
});

describe('buildEntityIndexFromJson', () => {
  it('resolves a club id by normalised name and applies the corpus club-spelling fallback', () => {
    const index = buildEntityIndexFromJson(JSON.stringify({
      clubs: { greaterwesternsydney: 42 }, venues: { themcg: 7 },
    }));
    expect(index.clubOrgId('GWS Giants')).toBe(42);
    expect(index.venueId('The MCG')).toBe(7);
    expect(index.clubOrgId('Unknown Club')).toBeUndefined();
  });
});

describe('DISPOSITIONS', () => {
  it('recognises exactly the eight AFLDB-ISSUE-200.md S5 dispositions', () => {
    expect(DISPOSITIONS).toHaveLength(8);
    expect(isDisposition('PARSER_BUG')).toBe(true);
    expect(isDisposition('not_a_real_disposition')).toBe(false);
  });
});
