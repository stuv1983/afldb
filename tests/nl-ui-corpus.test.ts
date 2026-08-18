/**
 * The UI sweep's own scoring rules.
 *
 * Same reasoning as tests/nl-stress-corpus.test.ts: this harness decides
 * what a 12,000-question overnight run says in the morning, and a
 * mis-scored sweep either manufactures 12,000 rows of work or hides a
 * real regression behind a generous classification. The rules are pinned
 * here first. Database-free and browser-free, like tools/nl/ui-corpus.ts.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  groupByCore, hydrationByWorker, metamorphicViolations, questionCore, readUiCorpus,
  scoreObservation, summarise,
  type UiCase, type UiObservation, type UiOutcome,
} from '../tools/nl/ui-corpus';

// ------------------------------------------------------------------ helpers

function corpusFile(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'afldb-ui-')), 'corpus.csv');
  writeFileSync(path, body, 'utf8');
  return path;
}

function observed(id: string, overrides: Partial<UiObservation> = {}): UiObservation {
  return {
    id,
    question: 'q',
    outcome: 'answered',
    httpStatus: 200,
    headline: 'Dustin Martin, 4 goals',
    interpretation: null,
    errors: [],
    elapsedMs: 100,
    ...overrides,
  };
}

function testCase(id: string, question: string, overrides: Partial<UiCase> = {}): UiCase {
  return { id, category: 'player_game_single', question, expectedStatus: 'plan', tags: [], ...overrides };
}

// ------------------------------------------------------------------ reading

describe('readUiCorpus', () => {
  it('reads the five columns and splits tags', () => {
    const path = corpusFile(
      'id,category,question,expected_status,tags\n'
      + 'ui_00001,player_game_single,Dustin Martin most goals against West Coast,plan,"player,scope,club"\n',
    );
    expect(readUiCorpus(path)).toEqual([{
      id: 'ui_00001',
      category: 'player_game_single',
      question: 'Dustin Martin most goals against West Coast',
      expectedStatus: 'plan',
      tags: ['player', 'scope', 'club'],
    }]);
  });

  it('rejects the 33-column plan corpus by name rather than mis-reading it', () => {
    // The README beside the UI corpus describes this other file. Pointed
    // at it, a positional reader would silently score the wrong columns.
    const path = corpusFile('id,category,difficulty,verification_level,question\nx,y,2,SEMANTIC,q\n');
    expect(() => readUiCorpus(path)).toThrow(/missing column "expected_status"/);
  });

  it('keeps `unknown` as a third status rather than folding it into decline', () => {
    const path = corpusFile(
      'id,category,question,expected_status,tags\nui_08939,edge_probe,most possies in a game,unknown,slang\n',
    );
    expect(readUiCorpus(path)[0].expectedStatus).toBe('unknown');
  });

  it('refuses a status it does not recognise', () => {
    const path = corpusFile('id,category,question,expected_status,tags\nui_1,c,q,success,t\n');
    expect(() => readUiCorpus(path)).toThrow(/unknown expected_status "success"/);
  });

  it('tolerates the trailing newline without inventing a row', () => {
    const path = corpusFile('id,category,question,expected_status,tags\nui_1,c,q,plan,t\n');
    expect(readUiCorpus(path)).toHaveLength(1);
  });
});

// -------------------------------------------------------------------- cores

describe('questionCore', () => {
  it('strips every filler form the corpus actually uses', () => {
    const variants = [
      'Richmond biggest win against Carlton',
      'please Richmond biggest win against Carlton',
      'quick one Richmond biggest win against Carlton',
      'show me Richmond biggest win against Carlton',
      'can you tell me Richmond biggest win against Carlton',
      'hey mate, Richmond biggest win against Carlton',
      'AFL question — Richmond biggest win against Carlton',
      'Richmond biggest win against Carlton please',
      'Richmond biggest win against Carlton!!!',
      'Richmond biggest win against Carlton??',
    ];
    expect(new Set(variants.map(questionCore)).size).toBe(1);
  });

  it('strips a prefix and a suffix stacked on one question', () => {
    // "quick one … please" and "please … ??" both occur; a single pass
    // would leave the tail and split the group.
    expect(questionCore('quick one Richmond biggest win please'))
      .toBe(questionCore('Richmond biggest win'));
    expect(questionCore('AFL question — most goals in 2017??'))
      .toBe(questionCore('most goals in 2017'));
  });

  it('prefers the longer prefix so "please tell me" does not leave "tell me"', () => {
    expect(questionCore('please tell me most disposals in one Grand Final'))
      .toBe('most disposals in one grand final');
  });

  it('does not eat words that merely start like filler', () => {
    // A real question could begin with a player whose name starts these
    // letters; only the anchored filler forms may be removed.
    expect(questionCore('Showell most disposals')).toBe('showell most disposals');
  });

  it('groups the corpus variants together and leaves distinct questions apart', () => {
    const groups = groupByCore([
      testCase('a', 'Richmond biggest win'),
      testCase('b', 'please Richmond biggest win'),
      testCase('c', 'Carlton biggest win'),
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get(questionCore('Richmond biggest win'))!.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

// ------------------------------------------------------------------ scoring

describe('scoreObservation', () => {
  it('passes a plan row only when an answer actually rendered', () => {
    expect(scoreObservation('plan', 'answered')).toBe('pass');
    expect(scoreObservation('plan', 'unanswerable')).toBe('fail');
    expect(scoreObservation('plan', 'absent')).toBe('fail');
  });

  it('accepts either safe decline for a decline row', () => {
    // Saying nothing and saying "I cannot answer that" are both correct
    // refusals of "top potato disposals"; the corpus does not distinguish.
    expect(scoreObservation('decline', 'absent')).toBe('pass');
    expect(scoreObservation('decline', 'unanswerable')).toBe('pass');
    expect(scoreObservation('decline', 'answered')).toBe('fail');
  });

  it('leaves the edge probes unscored rather than guessing an expectation', () => {
    expect(scoreObservation('unknown', 'answered')).toBe('unscored');
    expect(scoreObservation('unknown', 'absent')).toBe('unscored');
  });

  it('fails a crash under every expectation, including unknown', () => {
    for (const expectation of ['plan', 'decline', 'unknown'] as const) {
      for (const outcome of ['http_error', 'page_error'] as UiOutcome[]) {
        expect(scoreObservation(expectation, outcome)).toBe('fail');
      }
    }
  });
});

// -------------------------------------------------------------- metamorphic

describe('metamorphicViolations', () => {
  const variants = [
    testCase('a', 'Richmond biggest win'),
    testCase('b', 'please Richmond biggest win'),
  ];

  it('is silent when filler changed nothing', () => {
    const groups = groupByCore(variants);
    const seen = new Map([['a', observed('a')], ['b', observed('b')]]);
    expect(metamorphicViolations(groups, seen)).toEqual([]);
  });

  it('reports filler that changed whether the question was understood', () => {
    const groups = groupByCore(variants);
    const seen = new Map([['a', observed('a')], ['b', observed('b', { outcome: 'absent' })]]);
    const [violation] = metamorphicViolations(groups, seen);
    expect(violation.field).toBe('outcome');
    expect(violation.values).toEqual({ a: 'answered', b: 'absent' });
  });

  it('reports filler that changed the answer itself', () => {
    const groups = groupByCore(variants);
    const seen = new Map([['a', observed('a')], ['b', observed('b', { headline: 'Someone else, 9' })]]);
    const [violation] = metamorphicViolations(groups, seen);
    expect(violation.field).toBe('headline');
  });

  it('does not report the same defect twice as outcome and headline', () => {
    const groups = groupByCore(variants);
    const seen = new Map([
      ['a', observed('a')],
      ['b', observed('b', { outcome: 'absent', headline: null })],
    ]);
    expect(metamorphicViolations(groups, seen)).toHaveLength(1);
  });

  it('does not let a crash manufacture a filler disagreement', () => {
    // The crash has already failed its own batch. Counting it again here
    // would report one defect as two and inflate the morning's triage.
    const groups = groupByCore(variants);
    const seen = new Map([
      ['a', observed('a')],
      ['b', observed('b', { outcome: 'page_error', headline: null })],
    ]);
    expect(metamorphicViolations(groups, seen)).toEqual([]);
  });

  it('ignores a group with nothing to compare against', () => {
    const groups = groupByCore([testCase('a', 'Richmond biggest win')]);
    expect(metamorphicViolations(groups, new Map([['a', observed('a')]]))).toEqual([]);
  });
});

// ------------------------------------------------------------------ summary

describe('summarise', () => {
  it('counts verdicts and points at the worst category first', () => {
    const cases = [
      testCase('a', 'q1'),
      testCase('b', 'q2', { category: 'numeric_conditions' }),
      testCase('c', 'q3', { category: 'numeric_conditions' }),
      testCase('d', 'q4', { category: 'decline', expectedStatus: 'decline' }),
      testCase('e', 'q5', { category: 'edge_probe', expectedStatus: 'unknown' }),
    ];
    const seen = new Map([
      ['a', observed('a')],
      ['b', observed('b', { outcome: 'absent' })],
      ['c', observed('c', { outcome: 'absent' })],
      ['d', observed('d', { outcome: 'absent' })],
      ['e', observed('e')],
    ]);

    const summary = summarise(cases, seen, []);
    expect(summary).toMatchObject({ total: 5, pass: 2, fail: 2, unscored: 1 });
    expect(summary.byOutcome.absent).toBe(3);
    expect(summary.failuresByCategory[0]).toEqual(['numeric_conditions', 2]);
  });

  it('counts a client-side error without failing the question that raised it', () => {
    // /search raises an intermittent React #418 on ~1% of loads,
    // independent of the question. Folding it into the verdict would
    // fail ~120 rows per run at random and bury the corpus signal.
    const cases = [testCase('a', 'q1')];
    const seen = new Map([['a', observed('a', { errors: ['pageerror: Minified React error #418'] })]]);
    const summary = summarise(cases, seen, []);
    expect(summary).toMatchObject({ pass: 1, fail: 0, clientErrors: 1 });
  });

  it('ignores a case that was never observed rather than scoring it as failed', () => {
    // A run stopped halfway must report what it saw, not invent failures
    // for the questions it never asked.
    const summary = summarise([testCase('a', 'q1'), testCase('b', 'q2')], new Map([['a', observed('a')]]), []);
    expect(summary).toMatchObject({ total: 1, pass: 1, fail: 0 });
  });
});

describe('hydration errors correlated by cluster worker', () => {
  const hydrationError = ['pageerror: Minified React error #418; visit https://react.dev/errors/418'];

  function traced(id: string, worker: string, overrides: Partial<UiObservation> = {}): UiObservation {
    return observed(id, {
      trace: { worker, pid: `100${worker}`, requestId: `rid-${id}`, build: 'abc123' },
      ...overrides,
    });
  }

  it('reports a rate per worker, not just a count', () => {
    // The whole point: a worker serving more traffic shows more errors
    // while being no more faulty. Only the rate separates the two, so a
    // lopsided load distribution must not read as a lopsided fault.
    const seen = [
      traced('a', '1'), traced('b', '1'), traced('c', '1'), traced('d', '1', { errors: hydrationError }),
      traced('e', '2', { errors: hydrationError }),
    ];
    const report = hydrationByWorker(seen);
    expect(report.totalHydrationErrors).toBe(2);
    expect(report.byWorker['1']).toEqual({ loads: 4, hydrationErrors: 1, ratePercent: 25 });
    expect(report.byWorker['2']).toEqual({ loads: 1, hydrationErrors: 1, ratePercent: 100 });
  });

  it('separates same-worker from cross-worker navigations', () => {
    // The cluster-cache hypothesis stands or falls here: a document served
    // by one worker whose RSC payload came from another.
    const seen = [
      traced('a', '1', { subresourceWorkers: ['1'] }),
      traced('b', '1', { subresourceWorkers: ['2'], errors: hydrationError }),
      traced('c', '2', { subresourceWorkers: ['3'], errors: hydrationError }),
      traced('d', '2', { subresourceWorkers: ['2'] }),
    ];
    const report = hydrationByWorker(seen);
    expect(report.crossWorker.sameWorker).toEqual({ loads: 2, hydrationErrors: 0, ratePercent: 0 });
    expect(report.crossWorker.differentWorker).toEqual({ loads: 2, hydrationErrors: 2, ratePercent: 100 });
  });

  it('does not count a navigation with no subrequests as same-worker agreement', () => {
    // Silence is not agreement. A document that pulled nothing traced says
    // nothing about cross-worker divergence, and counting it as "same"
    // would dilute the very rate the comparison exists to measure.
    const report = hydrationByWorker([traced('a', '1'), traced('b', '1', { subresourceWorkers: [] })]);
    expect(report.crossWorker.sameWorker.loads).toBe(0);
    expect(report.crossWorker.differentWorker.loads).toBe(0);
  });

  it('counts untraced loads separately rather than attributing them to a worker', () => {
    const report = hydrationByWorker([observed('a', { errors: hydrationError }), traced('b', '1')]);
    expect(report.untraced).toBe(1);
    expect(report.totalHydrationErrors).toBe(1);
    expect(Object.keys(report.byWorker)).toEqual(['1']);
  });

  it('recognises a hydration error whether minified or not', () => {
    const minified = hydrationByWorker([traced('a', '1', { errors: ['pageerror: Minified React error #423'] })]);
    expect(minified.totalHydrationErrors).toBe(1);
    const plain = hydrationByWorker([traced('b', '1', {
      errors: ["pageerror: Hydration failed because the server rendered HTML didn't match the client."],
    })]);
    expect(plain.totalHydrationErrors).toBe(1);
  });

  it('does not count an unrelated console error as a hydration failure', () => {
    // The sweep also records autocomplete 429s and RSC fetch fallbacks;
    // folding those in would inflate the very number being investigated.
    const report = hydrationByWorker([traced('a', '1', {
      errors: ['console: Failed to fetch RSC payload for /players/x. Falling back to browser navigation.'],
    })]);
    expect(report.totalHydrationErrors).toBe(0);
  });
});
