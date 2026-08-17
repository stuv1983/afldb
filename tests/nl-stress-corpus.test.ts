/**
 * The stress-test harness's own scoring rules.
 *
 * A harness that mis-scores is worse than no harness -- it manufactures
 * work by reporting differences that are only naming, or hides real bugs
 * behind a translation that was too generous. These tests pin the
 * corpus-to-plan vocabulary mapping and the pass/fail rules that decide
 * what tomorrow's report says.
 *
 * Database-free, like everything in tools/nl/corpus.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  parseCsv, readCorpus, scoreRow, toExpectation, verdict,
  type StressExpectation, type StressObservation,
} from '../tools/nl/corpus';
import type { NlQueryPlan } from '@/search/nl/plan';

// ------------------------------------------------------------------ helpers

function plan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
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

function observed(overrides: Partial<StressObservation> = {}): StressObservation {
  return {
    status: 'success',
    executed: true,
    confidence: 0.9,
    plan: plan(),
    unsupportedTerms: [],
    coverageNote: null,
    leadName: 'Dustin Martin',
    leadValue: 4,
    total: 1,
    tieCount: 1,
    durationMs: 40,
    ...overrides,
  };
}

function expectation(overrides: Partial<StressExpectation> = {}): StressExpectation {
  return {
    id: 1,
    category: 'player_game_single',
    difficulty: 2,
    verificationLevel: 'SEMANTIC',
    equivalenceGroup: 'pgs|Dustin Martin|goals|max',
    question: 'dusty most goals against Carlton',
    status: 'success',
    grain: 'player_game',
    mode: 'single',
    metric: 'goals',
    aggregation: 'max',
    notes: '',
    ...overrides,
  };
}

/** Stands in for the directories the runner builds from the database. */
const CLUB_ORG_IDS: Record<string, number> = {
  'GWS Giants': 9, 'Greater Western Sydney': 9,
  Sydney: 17, Melbourne: 11, 'North Melbourne': 12, Carlton: 3, Geelong: 4,
};
const index = {
  clubOrgId: (name: string) => CLUB_ORG_IDS[name],
  venueId: (name: string) => (name === 'Melbourne Cricket Ground' ? 1 : undefined),
};

const classes = (e: StressExpectation, a: StressObservation, i?: typeof index) =>
  scoreRow(e, a, i).map((f) => f.class);

// ------------------------------------------------------------------- csv

describe('parseCsv', () => {
  it('keeps commas and doubled quotes inside a quoted field', () => {
    const rows = parseCsv('a,b\n1,"x, ""y"", z"\n');
    expect(rows[1]).toEqual(['1', 'x, "y", z']);
  });

  it('strips the UTF-8 BOM the corpus is saved with', () => {
    expect(parseCsv('﻿id,question\n1,hi\n')[0][0]).toBe('id');
  });

  it('reads a row whose last line has no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')[1]).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------- vocabulary map

describe('corpus vocabulary is translated into plan vocabulary', () => {
  it('"margin" plus result win/loss becomes win_margin/loss_margin', () => {
    const win = toExpectation({ id: '1', question: 'q', expected_metric: 'margin', expected_result: 'win' });
    const loss = toExpectation({ id: '2', question: 'q', expected_metric: 'margin', expected_result: 'loss' });
    expect(win?.metric).toBe('win_margin');
    expect(loss?.metric).toBe('loss_margin');
  });

  it('"margin" with no side named accepts either margin metric', () => {
    const either = toExpectation({ id: '1', question: 'q', expected_metric: 'margin' });
    expect(either?.metric).toBeUndefined();
    expect(either?.metricAlternatives).toEqual(['win_margin', 'loss_margin']);
  });

  it('match type "final" is this codebase\'s "finals"', () => {
    expect(toExpectation({ id: '1', question: 'q', expected_match_type: 'final' })?.matchType).toBe('finals');
    expect(toExpectation({ id: '1', question: 'q', expected_match_type: 'grand_final' })?.matchType).toBe('grand_final');
  });

  it('boundary "first" is the debut event', () => {
    expect(toExpectation({ id: '1', question: 'q', expected_boundary: 'first' })?.boundaryEvent).toBe('debut');
  });

  it('predicate fields and operators map onto career columns', () => {
    const e = toExpectation({
      id: '1',
      question: 'q',
      expected_predicates_json: '[{"field":"games","op":">=","value":200},{"field":"brownlow_wins","op":"=","value":0}]',
    });
    expect(e?.conditions).toEqual([
      { column: 'games', op: 'gte', value: 200 },
      { column: 'brownlow_medals', op: 'eq', value: 0 },
    ]);
  });

  it('a blank expectation column asserts nothing', () => {
    const e = toExpectation({ id: '1', question: 'q', expected_metric: '', expected_grain: '' });
    expect(e?.metric).toBeUndefined();
    expect(e?.grain).toBeUndefined();
  });

  it('a verified tie lists every sharer of the record', () => {
    const e = toExpectation({ id: '1', question: 'q', expected_answer_primary: 'Gordon Coventry | Gary Ablett Snr' });
    expect(e?.answerPrimary).toEqual(['Gordon Coventry', 'Gary Ablett Snr']);
  });

  it('readCorpus turns a header plus rows into expectations', () => {
    const corpus = readCorpus('id,question,expected_status\n7,most goals,success\n');
    expect(corpus).toHaveLength(1);
    expect(corpus[0]).toMatchObject({ id: 7, question: 'most goals', status: 'success' });
  });
});

// ---------------------------------------------------------------- scoring

describe('a matching interpretation passes', () => {
  it('reports nothing when every asserted field agrees', () => {
    expect(scoreRow(expectation(), observed())).toEqual([]);
  });

  it('ignores fields the corpus left blank', () => {
    const e = expectation({ metric: undefined, aggregation: undefined, mode: undefined });
    expect(scoreRow(e, observed({ plan: plan({ metric: 'disposals', agg: { kind: 'min' } }) }))).toEqual([]);
  });

  it('accepts a club named differently in the corpus and the database, matched by identity', () => {
    const e = expectation({ opponent: 'GWS Giants' });
    const a = observed({
      plan: plan({ scope: { clubAgainst: { organizationId: 9, slug: 'gws', name: 'Greater Western Sydney' } } }),
    });
    expect(classes(e, a, index)).toEqual([]);
  });

  it('does not let one club name matching part of another pass as the same club', () => {
    // The two mix-ups most worth catching are exactly the two a substring
    // comparison would score as a match.
    const sydneyAskedGws = scoreRow(
      expectation({ opponent: 'Sydney' }),
      observed({ plan: plan({ scope: { clubAgainst: { organizationId: 9, slug: 'gws', name: 'Greater Western Sydney' } } }) }),
      index,
    );
    const melbourneAskedNorth = scoreRow(
      expectation({ opponent: 'Melbourne' }),
      observed({ plan: plan({ scope: { clubAgainst: { organizationId: 12, slug: 'north-melbourne', name: 'North Melbourne' } } }) }),
      index,
    );
    expect(sydneyAskedGws.map((f) => f.class)).toEqual(['WRONG_OPPONENT']);
    expect(melbourneAskedNorth.map((f) => f.class)).toEqual(['WRONG_OPPONENT']);
  });

  it('falls back to an exact name match when the corpus name is not in the index', () => {
    const e = expectation({ opponent: 'Carlton' });
    const right = observed({ plan: plan({ scope: { clubAgainst: { organizationId: 3, slug: 'carlton', name: 'Carlton' } } }) });
    const wrong = observed({ plan: plan({ scope: { clubAgainst: { organizationId: 4, slug: 'geelong', name: 'Geelong' } } }) });
    expect(scoreRow(e, right)).toEqual([]);
    expect(scoreRow(e, wrong).map((f) => f.class)).toEqual(['WRONG_OPPONENT']);
  });
});

describe('wrong semantics are hard failures', () => {
  it('a wrong grain', () => {
    expect(classes(expectation(), observed({ plan: plan({ grain: 'player_career' }) }))).toContain('WRONG_GRAIN');
  });

  it('a wrong single-game vs total reading', () => {
    expect(classes(expectation(), observed({ plan: plan({ mode: 'sum' }) }))).toContain('WRONG_MODE');
  });

  it('a wrong statistic', () => {
    expect(classes(expectation(), observed({ plan: plan({ metric: 'disposals' }) }))).toContain('WRONG_METRIC');
  });

  it('a win margin answered where a loss margin was asked -- its own class, because one rule fixes them all', () => {
    const e = expectation({ grain: 'team_match', metric: 'loss_margin', mode: undefined });
    const a = observed({ plan: plan({ grain: 'team_match', metric: 'win_margin', mode: undefined }) });
    expect(classes(e, a)).toEqual(['WRONG_RESULT_SIDE']);
  });

  it('a dropped opponent filter', () => {
    const e = expectation({ opponent: 'Carlton' });
    expect(classes(e, observed())).toContain('DROPPED_FILTER');
  });

  it('the wrong opponent', () => {
    const e = expectation({ opponent: 'Carlton' });
    const a = observed({ plan: plan({ scope: { clubAgainst: { organizationId: 2, slug: 'geelong', name: 'Geelong' } } }) });
    expect(classes(e, a)).toContain('WRONG_OPPONENT');
  });

  it('an opponent read as the club the player played for', () => {
    const e = expectation({ player: 'Dustin Martin', opponent: 'Carlton' });
    const a = observed({
      plan: plan({
        player: { id: 1, slug: 'dustin-martin', name: 'Dustin Martin' },
        scope: { clubFor: { organizationId: 2, slug: 'carlton', name: 'Carlton' } },
      }),
    });
    expect(classes(e, a)).toContain('DROPPED_FILTER');
  });

  it('a dropped season scope', () => {
    expect(classes(expectation({ seasonFrom: 2000 }), observed())).toContain('DROPPED_FILTER');
  });

  it('a wrong season scope', () => {
    const a = observed({ plan: plan({ scope: { seasonMin: 1990 } }) });
    expect(classes(expectation({ seasonFrom: 2000 }), a)).toContain('WRONG_SEASON');
  });

  it('a dropped finals scope', () => {
    expect(classes(expectation({ matchType: 'grand_final' }), observed())).toContain('DROPPED_FILTER');
  });

  it('a Top-N answered with the wrong N', () => {
    const e = expectation({ aggregation: 'top_n', topN: 5 });
    const a = observed({ plan: plan({ agg: { kind: 'top_n', n: 10 } }) });
    expect(classes(e, a)).toContain('WRONG_TOP_N');
  });

  it('a missing career condition', () => {
    const e = expectation({
      grain: 'player_career', mode: undefined, metric: 'games', aggregation: 'list',
      conditions: [{ column: 'games', op: 'gte', value: 200 }, { column: 'premierships', op: 'eq', value: 0 }],
    });
    const a = observed({
      plan: plan({
        grain: 'player_career', mode: undefined, metric: 'games', agg: { kind: 'list' },
        careerConditions: [{ kind: 'column', column: 'games', op: 'gte', value: 200 }],
      }),
    });
    expect(classes(e, a)).toContain('DROPPED_FILTER');
  });

  it('a career condition that was never asked for', () => {
    const e = expectation({
      grain: 'player_career', mode: undefined, metric: 'games', aggregation: 'list',
      conditions: [{ column: 'games', op: 'gte', value: 200 }],
    });
    const a = observed({
      plan: plan({
        grain: 'player_career', mode: undefined, metric: 'games', agg: { kind: 'list' },
        careerConditions: [
          { kind: 'column', column: 'games', op: 'gte', value: 200 },
          { kind: 'column', column: 'goals', op: 'gte', value: 100 },
        ],
      }),
    });
    expect(classes(e, a)).toContain('EXTRA_FILTER');
  });

  it('a boundary question read as an ordinary one', () => {
    const e = expectation({
      grain: 'player_career', mode: undefined, metric: undefined, aggregation: undefined,
      boundaryEvent: 'debut', matchType: 'grand_final',
    });
    const a = observed({ plan: plan({ grain: 'player_career', mode: undefined }) });
    expect(classes(e, a)).toContain('WRONG_BOUNDARY');
  });

  it('a boundary question does not also have to set scope.matchType', () => {
    const e = expectation({
      grain: 'player_career', mode: undefined, metric: undefined, aggregation: undefined,
      boundaryEvent: 'debut', matchType: 'grand_final',
    });
    const a = observed({
      plan: plan({ grain: 'player_career', mode: undefined, boundary: { event: 'debut', where: 'grand_final' } }),
    });
    expect(classes(e, a)).toEqual([]);
  });
});

describe('declines', () => {
  it('answering something the corpus says is ambiguous is a hard failure', () => {
    const e = expectation({ status: 'decline', grain: undefined, metric: undefined, mode: undefined, aggregation: undefined, failureReason: 'ambiguous_player' });
    expect(classes(e, observed())).toEqual(['AMBIGUITY_NOT_DETECTED']);
  });

  it('declining for the expected reason passes', () => {
    const e = expectation({ status: 'decline', grain: undefined, metric: undefined, mode: undefined, aggregation: undefined, failureReason: 'unsupported_topic' });
    const a = observed({ status: 'decline', failureReason: 'unsupported_topic', plan: null });
    expect(scoreRow(e, a)).toEqual([]);
  });

  it('declining for a different stated reason is soft -- no wrong answer reached the reader', () => {
    const e = expectation({ status: 'decline', grain: undefined, metric: undefined, mode: undefined, aggregation: undefined, failureReason: 'unsupported_topic' });
    const a = observed({ status: 'decline', failureReason: 'ambiguous_player', plan: null });
    expect(scoreRow(e, a)).toEqual([
      expect.objectContaining({ class: 'WRONG_FAILURE_REASON', severity: 'soft' }),
    ]);
  });

  it('declining an answerable question is soft, and names the words that stopped it', () => {
    const a = observed({ status: 'decline', failureReason: 'unsupported_term', plan: null, unsupportedTerms: ['clangers'] });
    const findings = scoreRow(expectation(), a);
    expect(findings[0].class).toBe('UNEXPECTED_DECLINE');
    expect(findings[0].severity).toBe('soft');
    expect(findings[0].actual).toContain('clangers');
  });
});

describe('verified facts, coverage, confidence and empty results', () => {
  it('the lead may be any member of a verified tie', () => {
    const e = expectation({
      verificationLevel: 'VERIFIED_RESULT',
      answerPrimary: ['Gordon Coventry', 'Gary Ablett Snr'], answerValue: 9, tieCount: 2,
    });
    const a = observed({ leadName: 'Gary Ablett Snr', leadValue: 9, tieCount: 2, total: 2 });
    expect(scoreRow(e, a)).toEqual([]);
  });

  it('a different player holding the record is a hard failure', () => {
    const e = expectation({ verificationLevel: 'VERIFIED_RESULT', answerPrimary: ['Gordon Coventry'], answerValue: 9 });
    const a = observed({ leadName: 'Jack Riewoldt', leadValue: 9 });
    expect(classes(e, a)).toContain('WRONG_VERIFIED_ANSWER');
  });

  it('the right player with the wrong number is a hard failure', () => {
    const e = expectation({ verificationLevel: 'VERIFIED_RESULT', answerPrimary: ['Dustin Martin'], answerValue: 24 });
    expect(classes(e, observed({ leadValue: 12 }))).toContain('WRONG_VERIFIED_VALUE');
  });

  it('a missed tie is its own class', () => {
    const e = expectation({ verificationLevel: 'VERIFIED_RESULT', tieCount: 2 });
    expect(classes(e, observed({ tieCount: 1 }))).toContain('WRONG_TIE_COUNT');
  });

  it('a partial-coverage question must carry a caveat', () => {
    const e = expectation({ coverageBehaviour: 'partial' });
    expect(scoreRow(e, observed({ coverageNote: null })))
      .toEqual([expect.objectContaining({ class: 'COVERAGE_WRONG', severity: 'soft' })]);
    expect(scoreRow(e, observed({ coverageNote: 'Tackles were not recorded before 1987.' }))).toEqual([]);
  });

  it('confidence under the corpus floor is soft, not a failure', () => {
    const findings = scoreRow(expectation({ minConfidence: 0.8 }), observed({ confidence: 0.7 }));
    expect(findings).toEqual([expect.objectContaining({ class: 'LOW_CONFIDENCE', severity: 'soft' })]);
    expect(verdict(findings)).toBe('soft_fail');
  });

  it('a parse-only run does not score a verified fact it never fetched', () => {
    const e = expectation({
      verificationLevel: 'VERIFIED_RESULT',
      answerPrimary: ['Dustin Martin'], answerValue: 24, tieCount: 1,
    });
    const parseOnly = observed({ executed: false, leadName: null, leadValue: null, total: null, tieCount: null });
    expect(scoreRow(e, parseOnly)).toEqual([]);
  });

  it('a correct plan that matched no rows is reported but not scored', () => {
    const findings = scoreRow(expectation(), observed({ status: 'no_results', total: 0, leadName: null, leadValue: null, tieCount: null }));
    expect(findings).toEqual([expect.objectContaining({ class: 'NO_RESULTS', severity: 'info' })]);
    expect(verdict(findings)).toBe('pass');
  });

  it('a statement timeout is told apart from a database error and a code bug', () => {
    const timeout = observed({ status: 'error', errorCode: '57014', errorMessage: 'canceling statement' });
    const dbError = observed({ status: 'error', errorCode: '42703', errorMessage: 'column does not exist' });
    const bug = observed({ status: 'error', errorMessage: 'x is not a function' });
    expect(classes(expectation(), timeout)).toEqual(['TIMEOUT']);
    expect(classes(expectation(), dbError)).toEqual(['DATABASE_ERROR']);
    expect(classes(expectation(), bug)).toEqual(['INTERNAL_ERROR']);
  });
});

describe('verdict', () => {
  it('one hard finding fails the row whatever else it carries', () => {
    expect(verdict([
      { class: 'NO_RESULTS', severity: 'info', expected: '', actual: '' },
      { class: 'WRONG_GRAIN', severity: 'hard', expected: '', actual: '' },
    ])).toBe('fail');
  });

  it('soft findings alone do not fail a row', () => {
    expect(verdict([{ class: 'LOW_CONFIDENCE', severity: 'soft', expected: '', actual: '' }])).toBe('soft_fail');
  });
});
