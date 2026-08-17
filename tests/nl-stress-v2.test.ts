/**
 * The V2 harness's own rules: schema detection, streaming CSV, corpus
 * validation, canonical semantics, oracle scoring, metamorphic groups,
 * bounded stats, and output backpressure.
 *
 * The same reasoning as tests/nl-stress-corpus.test.ts: a harness that
 * mis-scores 250,000 rows manufactures work or hides bugs at a scale no
 * one will re-check by hand, so the scoring rules are pinned here before
 * any big run is trusted. Database-free throughout.
 */
import { PassThrough } from 'node:stream';
import { once } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  canonicaliseExpected, canonicalisePlan, detectSchema, metaAccumulate, newMetaGroupState,
  oracleDefect,
  recordSeverity, scoreMetaGroup, scoreV2, semanticFindings, semanticHash, streamCsvRows, toV2Case,
  V2Stats,
  type CanonicalSemantics, type EntityLookup, type V2Case, type V2Observation, type V2ResultRecord,
} from '../tools/nl/v2';
import type { NlQueryPlan } from '@/search/nl/plan';

// ------------------------------------------------------------------ fixtures

const lookup: EntityLookup = {
  clubOrgId: (name) => ({
    richmond: 1, tigers: 1, carlton: 3, greaterwesternsydney: 9, gwsgiants: 9, sydney: 17,
  })[name.toLowerCase().replace(/[^a-z0-9]+/g, '')],
  venueId: (name) => (/mcg|melbournecricketground/.test(name.toLowerCase().replace(/[^a-z0-9]+/g, '')) ? 1 : undefined),
  playerId: (name) => ({ dustinmartin: 100, tonylockett: 200 })[name.toLowerCase().replace(/[^a-z0-9]+/g, '')],
};

function livePlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return {
    v: 1,
    grain: 'player_game',
    metric: 'goals',
    mode: 'single',
    agg: { kind: 'max' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 25,
    ...overrides,
  };
}

function planCase(overrides: Partial<V2Case> = {}): V2Case {
  return {
    id: 'NLK-1', category: 'plan_core_player_game', oracle: 'plan', difficulty: 'medium',
    question: 'dusty most goals against Carlton',
    expectedStatus: 'plan',
    expectedSemantics: {
      grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'max' },
      player: 'Dustin Martin', scope: { clubAgainst: 'Carlton' }, tiePolicy: 'all',
    },
    ...overrides,
  };
}

function observed(overrides: Partial<V2Observation> = {}): V2Observation {
  return {
    status: 'plan',
    confidence: 0.95,
    canonical: canonicalisePlan(livePlan({
      player: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' },
      scope: { clubAgainst: { organizationId: 3, slug: 'carlton', name: 'Carlton' } },
    })),
    unsupportedTerms: [],
    parseMs: 4,
    ...overrides,
  };
}

const classes = (c: V2Case, o: V2Observation) => scoreV2(c, o, lookup).map((f) => f.class);

// -------------------------------------------------------------- detection

describe('schema detection', () => {
  it('recognises a V2 header', () => {
    expect(detectSchema(['case_id', 'category', 'oracle', 'difficulty', 'question', 'expected_status',
      'expected_reason', 'expected_semantics_json', 'expected_answer_json', 'metamorphic_group'])).toBe('v2');
  });

  it('recognises a V1 header', () => {
    expect(detectSchema(['id', 'category', 'difficulty', 'verification_level', 'equivalence_group', 'question'])).toBe('v1');
  });

  it('refuses an unknown header rather than guessing', () => {
    expect(detectSchema(['question', 'answer'])).toBeNull();
  });
});

// ---------------------------------------------------------- CSV streaming

async function collect(chunks: string[]): Promise<string[][]> {
  async function* source() { yield* chunks; }
  const rows: string[][] = [];
  for await (const row of streamCsvRows(source())) rows.push(row);
  return rows;
}

describe('streaming CSV', () => {
  it('keeps commas and doubled quotes inside quoted fields', async () => {
    const rows = await collect(['a,b\n1,"x, ""y""', ', z"\n']);
    expect(rows[1]).toEqual(['1', 'x, "y", z']);
  });

  it('is chunk-boundary safe: a quote split across chunks', async () => {
    // The closing quote of an escaped pair lands at a chunk edge.
    const rows = await collect(['a\n"he said ""', 'hi"" then left"\n']);
    expect(rows[1]).toEqual(['he said "hi" then left']);
  });

  it('handles a newline inside a quoted field', async () => {
    const rows = await collect(['a,b\n"line1\nline2",2\n']);
    expect(rows[1]).toEqual(['line1\nline2', '2']);
  });

  it('strips the BOM and reads a final row with no trailing newline', async () => {
    const rows = await collect(['﻿a,b\n1,2']);
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['1', '2']);
  });
});

// -------------------------------------------------------------- validation

describe('corpus row validation', () => {
  const base = {
    case_id: 'NLK-1', category: 'c', oracle: 'plan', difficulty: 'medium',
    question: 'q', expected_status: 'plan',
    expected_semantics_json: '{"grain":"player_game","agg":{"kind":"max"}}',
  };

  it('accepts a well-formed row', () => {
    expect(toV2Case(base).v2Case?.id).toBe('NLK-1');
  });

  it('rejects an unknown oracle', () => {
    expect(toV2Case({ ...base, oracle: 'vibes' }).error).toMatch(/unknown oracle/);
  });

  it('rejects malformed semantics JSON', () => {
    expect(toV2Case({ ...base, expected_semantics_json: '{nope' }).error).toMatch(/not valid JSON/);
  });

  it('rejects a plan row with no semantics', () => {
    expect(toV2Case({ ...base, expected_semantics_json: '' }).error).toMatch(/no expected_semantics_json/);
  });

  it('rejects an answer oracle with no usable answer', () => {
    expect(toV2Case({
      ...base, oracle: 'answer', expected_status: 'answer', expected_answer_json: '{"names":[]}',
    }).error).toMatch(/no usable expected answer/);
  });

  it('rejects oracle/status incoherence', () => {
    expect(toV2Case({ ...base, oracle: 'decline' }).error).toMatch(/decline oracle with status plan/);
  });
});

// ------------------------------------------------------ canonical semantics

describe('canonical semantics', () => {
  it('the expected side and the live plan canonicalise identically for the same question', () => {
    const expected = canonicaliseExpected(planCase().expectedSemantics!, lookup);
    const actual = observed().canonical!;
    expect(semanticFindings(expected, actual)).toEqual([]);
    expect(semanticHash(expected)).toBe(semanticHash(actual));
  });

  it('career-condition order does not matter', () => {
    const a = canonicaliseExpected({
      grain: 'player_career', metric: 'games', agg: { kind: 'list' },
      careerConditions: [
        { kind: 'column', column: 'games', op: 'gte', value: 200 },
        { kind: 'column', column: 'premierships', op: 'eq', value: 0 },
      ],
    }, lookup);
    const b = canonicaliseExpected({
      grain: 'player_career', metric: 'games', agg: { kind: 'list' },
      careerConditions: [
        { kind: 'column', column: 'premierships', op: 'eq', value: 0 },
        { kind: 'column', column: 'games', op: 'gte', value: 200 },
      ],
    }, lookup);
    expect(semanticHash(a)).toBe(semanticHash(b));
    expect(semanticFindings(a, b)).toEqual([]);
  });

  it('clubs compare by stable id, so a corpus alias equals the database name', () => {
    const expected = canonicaliseExpected({
      grain: 'team_match', metric: 'win_margin', agg: { kind: 'max' },
      scope: { clubFor: 'GWS Giants' }, tiePolicy: 'all',
    }, lookup);
    const actual = canonicalisePlan(livePlan({
      grain: 'team_match', metric: 'win_margin', mode: undefined,
      scope: { clubFor: { organizationId: 9, slug: 'gws', name: 'Greater Western Sydney' } },
    }));
    expect(semanticFindings(expected, actual)).toEqual([]);
  });

  it('but a different club is a different club, however similar the names', () => {
    const expected = canonicaliseExpected({
      grain: 'team_match', metric: 'win_margin', agg: { kind: 'max' },
      scope: { clubFor: 'Sydney' }, tiePolicy: 'all',
    }, lookup);
    const actual = canonicalisePlan(livePlan({
      grain: 'team_match', metric: 'win_margin', mode: undefined,
      scope: { clubFor: { organizationId: 9, slug: 'gws', name: 'Greater Western Sydney' } },
    }));
    expect(semanticFindings(expected, actual).map((f) => f.class)).toEqual(['WRONG_CLUB']);
  });

  it('players compare by resolved id, with generational-suffix tolerance as the name fallback', () => {
    const withId = canonicaliseExpected({
      grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'max' }, player: 'Dustin Martin',
    }, lookup);
    expect(withId.player?.id).toBe(100);
    const noId = canonicaliseExpected({
      grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'max' }, player: 'Gary Ablett Snr',
    }, lookup);
    const actual = canonicalisePlan(livePlan({ player: { id: 300, slug: 'x', name: 'Gary Ablett' } }));
    // Expected side could not resolve an id, actual has one: falls back to
    // person-name comparison, which tolerates the suffix.
    expect(semanticFindings(noId, actual).map((f) => f.class)).toEqual([]);
  });

  it('parser diagnostics do not affect semantic identity', () => {
    // Two observations of the same plan at different confidence with
    // different leftovers hash identically -- only the plan is semantics.
    const a = observed({ confidence: 0.6, unsupportedTerms: ['please'] }).canonical!;
    const b = observed({ confidence: 1 }).canonical!;
    expect(semanticHash(a)).toBe(semanticHash(b));
  });

  it('a top_n aggregation carries its n', () => {
    const five = canonicaliseExpected({ grain: 'player_game', metric: 'goals', mode: 'single', agg: { kind: 'top_n', n: 5 } }, lookup);
    const ten = canonicalisePlan(livePlan({ agg: { kind: 'top_n', n: 10 } }));
    expect(semanticFindings(five, ten).map((f) => f.class)).toEqual(['WRONG_AGGREGATION']);
  });
});

// ----------------------------------------------------------- plan scoring

describe('plan oracle', () => {
  it('a matching interpretation passes', () => {
    expect(scoreV2(planCase(), observed(), lookup)).toEqual([]);
  });

  it('a plan row is NEVER failed for execution results -- zero rows included', () => {
    // The observation carries total 0; a plan row must not look at it.
    expect(scoreV2(planCase(), observed({ total: 0, leadValue: null, tieNames: [] }), lookup)).toEqual([]);
  });

  it('a wrong opponent is the specific class, not the catch-all', () => {
    const actual = observed({
      canonical: canonicalisePlan(livePlan({
        player: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' },
        scope: { clubAgainst: { organizationId: 1, slug: 'richmond', name: 'Richmond' } },
      })),
    });
    expect(classes(planCase(), actual)).toEqual(['WRONG_OPPONENT']);
  });

  it('dropped and extra filters are told apart', () => {
    const dropped = observed({
      canonical: canonicalisePlan(livePlan({ player: { id: 100, slug: 'd', name: 'Dustin Martin' } })),
    });
    expect(classes(planCase(), dropped)).toContain('DROPPED_FILTER');

    const extra = observed({
      canonical: canonicalisePlan(livePlan({
        player: { id: 100, slug: 'd', name: 'Dustin Martin' },
        scope: {
          clubAgainst: { organizationId: 3, slug: 'carlton', name: 'Carlton' },
          venue: { id: 1, slug: 'mcg', name: 'Melbourne Cricket Ground' },
        },
      })),
    });
    expect(classes(planCase(), extra)).toContain('EXTRA_FILTER');
  });

  it('declining a plan row is soft -- conservatism, not a wrong answer', () => {
    const findings = scoreV2(planCase(), observed({
      status: 'decline', canonical: null, failureReason: 'unsupported_term', unsupportedTerms: ['banana'],
    }), lookup);
    expect(findings).toEqual([expect.objectContaining({ class: 'UNEXPECTED_DECLINE', severity: 'soft' })]);
  });

  it('a season-range disagreement names the range', () => {
    const c = planCase({
      expectedSemantics: {
        ...planCase().expectedSemantics!,
        scope: { clubAgainst: 'Carlton', seasonMin: 2000 },
      },
    });
    const actual = observed(); // no season
    expect(classes(c, actual)).toContain('DROPPED_FILTER');
  });
});

// ---------------------------------------------------------- answer scoring

describe('answer oracle: two independent layers', () => {
  const answerCase = (): V2Case => planCase({
    oracle: 'answer',
    expectedStatus: 'answer',
    expectedSemantics: undefined,
    expectedAnswer: { names: ['Dustin Martin'], value: 24, unit: 'goals' },
  });

  it('right interpretation and right result passes', () => {
    const o = observed({ leadValue: 24, tieNames: ['Dustin Martin'], total: 1, execMs: 8 });
    expect(scoreV2(answerCase(), o, lookup)).toEqual([]);
  });

  it('right result cannot hide a wrong interpretation when semantics are supplied', () => {
    const c: V2Case = { ...answerCase(), expectedSemantics: planCase().expectedSemantics };
    const o = observed({
      canonical: canonicalisePlan(livePlan({ grain: 'player_career', mode: undefined })),
      leadValue: 24, tieNames: ['Dustin Martin'], total: 1,
    });
    const found = scoreV2(c, o, lookup).map((f) => f.class);
    expect(found).toContain('WRONG_GRAIN');
  });

  it('right interpretation cannot hide a wrong result', () => {
    const c: V2Case = { ...answerCase(), expectedSemantics: planCase().expectedSemantics };
    const o = observed({ leadValue: 12, tieNames: ['Dustin Martin'], total: 1 });
    const found = scoreV2(c, o, lookup);
    expect(found.map((f) => f.class)).toEqual(['WRONG_VALUE']);
    expect(found[0].severity).toBe('hard');
  });

  it('a tie is a set: the first name being right is not enough', () => {
    const c = planCase({
      oracle: 'answer', expectedStatus: 'answer', expectedSemantics: undefined,
      expectedAnswer: { names: ['Gordon Coventry', 'Gary Ablett Snr'], value: 9 },
    });
    const missing = observed({ leadValue: 9, tieNames: ['Gordon Coventry'], total: 1 });
    expect(classes(c, missing)).toEqual(['MISSING_TIED_RESULT']);

    const extra = observed({ leadValue: 9, tieNames: ['Gordon Coventry', 'Gary Ablett Snr', 'Jack Riewoldt'], total: 3 });
    expect(classes(c, extra)).toEqual(['EXTRA_RESULT']);

    const exact = observed({ leadValue: 9, tieNames: ['Gary Ablett Snr', 'Gordon Coventry'], total: 2 });
    expect(scoreV2(c, exact, lookup)).toEqual([]);
  });

  it('no overlap at all is the wrong answer, not a tie defect', () => {
    const o = observed({ leadValue: 24, tieNames: ['Jack Riewoldt'], total: 1 });
    expect(classes(answerCase(), o)).toEqual(['WRONG_ANSWER']);
  });

  it('declining an answer row is HARD -- the corpus explicitly expects the verified answer', () => {
    const findings = scoreV2(answerCase(), observed({ status: 'decline', canonical: null, failureReason: 'low_confidence' }), lookup);
    expect(findings).toEqual([expect.objectContaining({ class: 'UNEXPECTED_DECLINE', severity: 'hard' })]);
  });
});

// --------------------------------------------------------- decline scoring

describe('decline oracle', () => {
  const declineCase = (reason?: string): V2Case => planCase({
    oracle: 'decline', expectedStatus: 'decline', expectedSemantics: undefined,
    expectedReason: reason, question: 'dusty banana most goals noise123',
  });

  it('a safe decline for the expected reason passes', () => {
    const o = observed({ status: 'decline', canonical: null, failureReason: 'unsupported_term' });
    expect(scoreV2(declineCase('unsupported_term'), o, lookup)).toEqual([]);
  });

  it('a safe decline for the wrong reason is soft', () => {
    const o = observed({ status: 'decline', canonical: null, failureReason: 'unsupported_term' });
    const findings = scoreV2(declineCase('ambiguous_player'), o, lookup);
    expect(findings).toEqual([expect.objectContaining({ class: 'WRONG_FAILURE_REASON', severity: 'soft' })]);
  });

  it('answering at all is UNSAFE_ANSWER, hard', () => {
    const findings = scoreV2(declineCase('unsupported_term'), observed(), lookup);
    expect(findings).toEqual([expect.objectContaining({ class: 'UNSAFE_ANSWER', severity: 'hard' })]);
  });

  it('errors are their own classes', () => {
    const timeout = observed({ status: 'error', canonical: null, errorCode: '57014', errorMessage: 'canceled' });
    expect(classes(planCase(), timeout)).toEqual(['QUERY_TIMEOUT']);
    const internal = observed({ status: 'error', canonical: null, errorMessage: 'boom' });
    expect(classes(planCase(), internal)).toEqual(['INTERNAL_ERROR']);
  });
});

// ------------------------------------------------------------- metamorphic

describe('metamorphic groups', () => {
  const sem = (n?: number): CanonicalSemantics => canonicalisePlan(livePlan(n === undefined ? {} : { agg: { kind: 'top_n', n } }));

  it('all members agreeing is consistent', () => {
    const state = newMetaGroupState();
    for (let i = 0; i < 5; i++) {
      metaAccumulate(state, { status: 'plan', hash: semanticHash(sem()), key: 'k', question: `q${i}` });
    }
    const result = scoreMetaGroup('g', state);
    expect(result.consistent).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('two confident interpretations is a hard divergence, majority decided by count', () => {
    const state = newMetaGroupState();
    for (let i = 0; i < 7; i++) metaAccumulate(state, { status: 'plan', hash: 'aaa', key: 'majority', question: `m${i}` });
    metaAccumulate(state, { status: 'plan', hash: 'bbb', key: 'outlier', question: 'quick one, oddly worded' });
    const result = scoreMetaGroup('g', state);
    expect(result.consistent).toBe(false);
    expect(result.findings).toEqual([expect.objectContaining({ class: 'METAMORPHIC_DIVERGENCE', severity: 'hard' })]);
    expect(result.majority?.key).toBe('majority');
    expect(result.outliers[0].question).toBe('quick one, oddly worded');
  });

  it('a plan/decline split is a soft status divergence', () => {
    const state = newMetaGroupState();
    metaAccumulate(state, { status: 'plan', hash: 'aaa', key: 'k', question: 'plain wording' });
    metaAccumulate(state, { status: 'decline', question: 'slang wording' });
    const result = scoreMetaGroup('g', state);
    expect(result.findings).toEqual([expect.objectContaining({ class: 'METAMORPHIC_STATUS_DIVERGENCE', severity: 'soft' })]);
    expect(result.declineExample).toBe('slang wording');
  });

  it('all-decline produces no group finding -- the per-row declines already carry it', () => {
    const state = newMetaGroupState();
    metaAccumulate(state, { status: 'decline', question: 'a' });
    metaAccumulate(state, { status: 'decline', question: 'b' });
    expect(scoreMetaGroup('g', state).findings).toEqual([]);
  });

  it('a singleton group is trivially consistent but still scored against expected semantics per-row', () => {
    const state = newMetaGroupState();
    metaAccumulate(state, { status: 'plan', hash: 'aaa', key: 'k', question: 'only phrasing' });
    expect(scoreMetaGroup('g', state).consistent).toBe(true);
    // The per-row half: a metamorphic case with expected semantics that
    // the actual plan does not match fails through scoreV2 like any plan
    // row -- the group is anchored to the truth, not to itself.
    const c = planCase({ oracle: 'metamorphic', metamorphicGroup: 'g' });
    const wrong = observed({ canonical: canonicalisePlan(livePlan({ metric: 'disposals' })) });
    expect(classes(c, wrong)).toContain('WRONG_METRIC');
  });
});

// ------------------------------------------------------------------- stats

function resultRecord(overrides: Partial<V2ResultRecord> = {}): V2ResultRecord {
  return {
    id: 'NLK-1', category: 'c', oracle: 'plan', question: 'q', expectedStatus: 'plan',
    actual: { status: 'plan', confidence: 1, unsupportedTerms: [], parseMs: 5 },
    findings: [],
    severity: 'clean',
    ...overrides,
  };
}

describe('bounded stats', () => {
  it('accumulation is order-independent, so concurrency cannot change a score', () => {
    const records = [
      resultRecord({ id: 'a' }),
      resultRecord({ id: 'b', severity: 'hard', findings: [{ class: 'WRONG_GRAIN', severity: 'hard', expected: 'x', actual: 'y' }] }),
      resultRecord({ id: 'c', severity: 'soft', findings: [{ class: 'UNEXPECTED_DECLINE', severity: 'soft', expected: 'x', actual: 'y' }] }),
      resultRecord({ id: 'd', actual: { status: 'plan', confidence: 1, unsupportedTerms: ['snags'], parseMs: 9 } }),
    ];
    const forward = new V2Stats();
    for (const r of records) forward.addRow(r);
    const reversed = new V2Stats();
    for (const r of [...records].reverse()) reversed.addRow(r);

    expect(forward.total).toBe(reversed.total);
    expect(forward.hard).toBe(reversed.hard);
    expect(forward.soft).toBe(reversed.soft);
    expect([...forward.byClass.entries()].sort()).toEqual([...reversed.byClass.entries()].sort());
    expect(forward.percentile('full', 0.5)).toBe(reversed.percentile('full', 0.5));
    expect(forward.unsupportedTerms.get('snags')?.count).toBe(reversed.unsupportedTerms.get('snags')?.count);
  });

  it('latency percentiles come from the histogram exactly', () => {
    const stats = new V2Stats();
    for (let ms = 1; ms <= 100; ms++) {
      stats.addRow(resultRecord({ id: `r${ms}`, actual: { status: 'plan', confidence: 1, unsupportedTerms: [], parseMs: ms } }));
    }
    expect(stats.percentile('full', 0.5)).toBe(51);
    expect(stats.percentile('full', 0.99)).toBe(100);
    expect(stats.maxMs).toBe(100);
  });

  it('severity derives from findings', () => {
    expect(recordSeverity([])).toBe('clean');
    expect(recordSeverity([{ class: 'UNEXPECTED_DECLINE', severity: 'soft', expected: '', actual: '' }])).toBe('soft');
    expect(recordSeverity([
      { class: 'UNEXPECTED_DECLINE', severity: 'soft', expected: '', actual: '' },
      { class: 'WRONG_GRAIN', severity: 'hard', expected: '', actual: '' },
    ])).toBe('hard');
  });
});

// ------------------------------------------------------------- backpressure

describe('streamed output honours backpressure', () => {
  it('waits for drain when the buffer fills, and loses nothing', async () => {
    // A PassThrough with a tiny buffer and NO consumer attached yet: the
    // buffer genuinely fills, write() returns false, and the writer must
    // wait for drain rather than buffering unboundedly. The consumer
    // attaches only after the writer is already blocked -- the shape of
    // a disk that falls behind the run.
    const stream = new PassThrough({ highWaterMark: 64 });
    const line = 'x'.repeat(50);
    let waitedForDrain = false;

    const writer = (async () => {
      for (let i = 0; i < 20; i++) {
        if (!stream.write(`${line}\n`)) {
          waitedForDrain = true;
          await once(stream, 'drain');
        }
      }
      stream.end();
    })();

    // Let the writer hit the full buffer before anyone reads.
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(waitedForDrain).toBe(true);

    const received: Buffer[] = [];
    stream.on('data', (chunk) => received.push(chunk as Buffer));
    await writer;
    await once(stream, 'end');

    expect(Buffer.concat(received).toString().split('\n').filter(Boolean)).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------
// Corpus oracle defects
// ---------------------------------------------------------------------
// A corpus is only an oracle while it agrees with itself. The 250k
// generator emitted rows whose surface text says "exactly 300" and whose
// expectation asserts `gt 300` -- rows a correct parser MUST fail and an
// incorrect one could pass. Scoring them rewards wrong parsing, so they
// are quarantined out of every rate and reported on their own.
//
// A mis-detecting quarantine is worse than none: a false positive hides
// a real parser bug behind "corpus defect". These pin both directions.
describe('oracleDefect', () => {
  const base = {
    id: 'T-1', category: 'plan_numeric_conditions', oracle: 'plan' as const,
    difficulty: 'hard', expectedStatus: 'plan' as const,
  };
  const withConditions = (
    question: string,
    conditions: { kind: string; column: string; op: string; value: number }[],
  ) => ({
    ...base,
    question,
    expectedSemantics: { grain: 'player_career', agg: { kind: 'list' }, careerConditions: conditions },
  });

  it('flags "exactly N" asserted as gt', () => {
    expect(oracleDefect(withConditions('players with 1+ games and exactly 1 goals', [
      { kind: 'column', column: 'games', op: 'gte', value: 1 },
      { kind: 'column', column: 'goals', op: 'gt', value: 1 },
    ]))).toMatch(/goals gt 1/);
  });

  it('flags "exactly N" asserted as lte', () => {
    expect(oracleDefect(withConditions('players with 100+ clubs and exactly 100 games', [
      { kind: 'column', column: 'clubs_played', op: 'gte', value: 100 },
      { kind: 'column', column: 'games', op: 'lte', value: 100 },
    ]))).not.toBeNull();
  });

  it('accepts an expectation that matches the question', () => {
    expect(oracleDefect(withConditions('players with at least 3 games and at most 3 goals', [
      { kind: 'column', column: 'games', op: 'gte', value: 3 },
      { kind: 'column', column: 'goals', op: 'lte', value: 3 },
    ]))).toBeNull();
  });

  it('accepts distinct values with distinct operators', () => {
    expect(oracleDefect(withConditions('players with over 100 goals and at most 3 premierships', [
      { kind: 'column', column: 'goals', op: 'gt', value: 100 },
      { kind: 'column', column: 'premierships', op: 'lte', value: 3 },
    ]))).toBeNull();
  });

  // Conservatism rule 1: a value with no stated operator is unjudgeable.
  it('does not judge a bare number', () => {
    expect(oracleDefect(withConditions('players with 250 games', [
      { kind: 'column', column: 'games', op: 'lt', value: 250 },
    ]))).toBeNull();
  });

  // Conservatism rule 2: same-valued clauses are invisible to it, which
  // is why the reported count is documented as a floor, not a total.
  it('cannot see a swap between two same-valued clauses', () => {
    expect(oracleDefect(withConditions('players with at least 5 finals and at most 5 goals', [
      { kind: 'column', column: 'finals', op: 'lte', value: 5 },
      { kind: 'column', column: 'goals', op: 'gte', value: 5 },
    ]))).toBeNull();
  });

  it('ignores rows with no conditions at all', () => {
    expect(oracleDefect({ ...base, question: 'most goals', expectedSemantics: { grain: 'player_career', agg: { kind: 'max' } } }))
      .toBeNull();
  });
});

describe('V2Stats quarantine', () => {
  const record = (id: string, severity: 'clean' | 'soft' | 'hard', defect?: string): V2ResultRecord => ({
    id, category: 'plan_numeric_conditions', oracle: 'plan', question: 'q',
    expectedStatus: 'plan',
    actual: { status: 'plan', confidence: 1, unsupportedTerms: [], parseMs: 1 },
    findings: severity === 'clean' ? [] : [{ class: 'DROPPED_FILTER', severity, field: 'careerConditions', expected: 'a', actual: 'b' }],
    severity,
    ...(defect ? { oracleDefect: defect } : {}),
  });

  it('a quarantined row lands in no rate at all', () => {
    const stats = new V2Stats();
    stats.addRow(record('A', 'hard'));
    stats.addRow(record('B', 'hard', 'question states eq 5, expectation asserts goals gt 5'));
    expect(stats.total).toBe(1);
    expect(stats.hard).toBe(1);
    expect(stats.quarantined).toBe(1);
  });

  it('quarantine shapes are grouped with the numbers generalised', () => {
    const stats = new V2Stats();
    stats.addRow(record('A', 'hard', 'question states eq 5, expectation asserts goals gt 5'));
    stats.addRow(record('B', 'hard', 'question states eq 300, expectation asserts goals gt 300'));
    expect([...stats.quarantineShapes.values()]).toEqual([2]);
  });

  it('keeps the ids, so a generator fix stays auditable', () => {
    const stats = new V2Stats();
    stats.addRow(record('NLK-125003', 'hard', 'question states eq 1, expectation asserts goals gt 1'));
    expect(stats.quarantineSamples[0].id).toBe('NLK-125003');
  });
});
