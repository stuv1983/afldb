/**
 * AFLDB-ISSUE-199 correction script.
 *
 * DB-free: builds a small synthetic 12,000-row corpus in memory (real rows
 * would be the external ~/nl-stress-corpus.csv, which this repository does
 * not carry) with the exact id layout tools/nl/fix-issue-199-stale-
 * expectations.ts expects, then proves the invariants the script's own
 * header comment promises: it fixes exactly the audited 173 rows, refuses
 * on any before-state/count/id mismatch, and never touches anything else.
 */
import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';

import { parseCsv } from '../tools/nl/corpus';
import {
  assertOutputPathIsSafe, correctCorpus, deriveAblettMetric, detectAggregation,
} from '../tools/nl/fix-issue-199-stale-expectations';

// ------------------------------------------------------------------ fixture

const HEADER = [
  'id', 'category', 'difficulty', 'verification_level', 'equivalence_group', 'question', 'notes',
  'expected_status', 'expected_grain', 'expected_mode', 'expected_metric', 'expected_aggregation',
  'expected_limit', 'expected_club', 'expected_failure_reason',
] as const;

type Row = Record<(typeof HEADER)[number], string>;

function baseRow(id: number): Row {
  return {
    id: String(id),
    category: 'filler',
    difficulty: '1',
    verification_level: 'SEMANTIC',
    equivalence_group: '',
    question: `Filler question ${id}`,
    notes: '',
    expected_status: 'success',
    expected_grain: 'player_game',
    expected_mode: 'single',
    expected_metric: 'goals',
    expected_aggregation: 'max',
    expected_limit: '',
    expected_club: '',
    expected_failure_reason: '',
  };
}

/** Ablett metric-order mirrors the Jones layout one-for-one (AFLDB-ISSUE-199.md S4a). */
const ABLETT_METRIC_BY_OFFSET = ['goals', 'games', 'disposals', 'marks', 'tackles'];

function range(from: number, to: number): number[] {
  const ids: number[] = [];
  for (let id = from; id <= to; id++) ids.push(id);
  return ids;
}

/** The exact 173-row layout the script hardcodes, built as decline rows plus their mirrors. */
function buildRows(): Row[] {
  const rows = new Map<number, Row>();
  for (let id = 1; id <= 12000; id++) rows.set(id, baseRow(id));

  // Mirrors the script relies on to confirm each intended shape (distinct clubs/ids from any target).
  rows.set(1, { ...baseRow(1), expected_grain: 'player_career', expected_metric: 'goals', expected_mode: '' });
  rows.set(2, { ...baseRow(2), expected_grain: 'player_career', expected_metric: 'games', expected_mode: '' });
  rows.set(3, { ...baseRow(3), expected_grain: 'player_career', expected_metric: 'disposals', expected_mode: '' });
  rows.set(4, { ...baseRow(4), expected_grain: 'player_career', expected_metric: 'marks', expected_mode: '' });
  rows.set(5, { ...baseRow(5), expected_grain: 'player_career', expected_metric: 'tackles', expected_mode: '' });
  rows.set(6, {
    ...baseRow(6), expected_grain: 'team_streak', expected_metric: '', expected_mode: '', expected_club: 'Geelong',
  });
  rows.set(7, {
    ...baseRow(7), expected_grain: 'coach_record', expected_metric: 'games', expected_mode: '', expected_club: 'Geelong',
  });
  rows.set(8, {
    ...baseRow(8), expected_grain: 'coach_record', expected_metric: 'wins', expected_mode: '', expected_club: 'Geelong',
  });

  // Ablett -- 11601-11605, decline, no expected_metric of their own.
  for (const id of range(11601, 11605)) {
    rows.set(id, {
      ...baseRow(id),
      question: `Who among the Abletts has the most ${ABLETT_METRIC_BY_OFFSET[id - 11601]}?`,
      expected_status: 'decline', expected_grain: '', expected_mode: '', expected_metric: '',
      expected_aggregation: '', verification_level: 'EXPECTED_DECLINE', expected_failure_reason: 'ambiguity',
    });
  }

  // Jones -- 11626-11630, a genuine decline the script must never touch or read from. Real operator
  // validation (2026-09-16) found Jones rows carry no machine-readable expected_metric at all, decline
  // or otherwise -- reproduced here as a blank column so a regression back to reading it is caught.
  for (const [index, id] of range(11626, 11630).entries()) {
    rows.set(id, {
      ...baseRow(id),
      question: `Who among the Joneses has the most ${ABLETT_METRIC_BY_OFFSET[index]}?`,
      expected_status: 'decline', expected_grain: '', expected_mode: '', expected_metric: '',
      expected_aggregation: '', verification_level: 'EXPECTED_DECLINE', expected_failure_reason: 'ambiguity',
    });
  }

  const streakGroups: [number, number, string][] = [
    [11651, 11678, 'Adelaide'], [11679, 11706, 'Adelaide'],
    [11931, 11958, 'Brisbane Lions'], [11959, 11986, 'Brisbane Lions'],
  ];
  for (const [from, to, club] of streakGroups) {
    for (const id of range(from, to)) {
      rows.set(id, {
        ...baseRow(id),
        question: `What is ${club}'s longest streak (row ${id})?`,
        expected_status: 'decline', expected_grain: '', expected_mode: '', expected_metric: '',
        expected_aggregation: '', expected_club: club,
        verification_level: 'EXPECTED_DECLINE', expected_failure_reason: 'unsupported_feature',
      });
    }
  }

  const coachGroups: [number, number, string][] = [[11763, 11790, 'games'], [11791, 11818, 'wins']];
  for (const [from, to, metric] of coachGroups) {
    for (const id of range(from, to)) {
      rows.set(id, {
        ...baseRow(id),
        question: `Who coached the most ${metric} for Adelaide? (row ${id})`,
        expected_status: 'decline', expected_grain: '', expected_mode: '', expected_metric: '',
        expected_aggregation: '', expected_club: 'Adelaide',
        verification_level: 'EXPECTED_DECLINE', expected_failure_reason: 'unsupported_feature',
      });
    }
  }

  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

function buildCsv(rows: Row[] = buildRows()): string {
  return toCsv(HEADER, rows);
}

function parseBack(csvText: string): Row[] {
  const parsed = parseCsv(csvText);
  const header = parsed[0];
  return parsed.slice(1).map((cells) => {
    const record = {} as Row;
    header.forEach((name, index) => { (record as Record<string, string>)[name] = cells[index] ?? ''; });
    return record;
  });
}

// --------------------------------------------------------------------- tests

describe('AFLDB-ISSUE-199 correctCorpus', () => {
  it('changes exactly the audited 173 rows and leaves everything else untouched', () => {
    const { outputCsvText, summary } = correctCorpus(buildCsv());

    expect(summary.inputRows).toBe(12000);
    expect(summary.outputRows).toBe(12000);
    expect(summary.targetRowsExpected).toBe(173);
    expect(summary.targetRowsModified).toBe(173);
    expect(summary.nonTargetRowsModified).toBe(0);
    expect(summary.ablettModifications).toBe(5);
    expect(summary.streakModifications).toBe(112);
    expect(summary.coachModifications).toBe(56);
    expect(summary.ablettModifications + summary.streakModifications + summary.coachModifications).toBe(173);

    const outputRows = parseBack(outputCsvText);
    const byId = new Map(outputRows.map((row) => [Number(row.id), row]));

    // Ablett goals row derives its metric from its own question text.
    const ablettGoals = byId.get(11601)!;
    expect(ablettGoals.expected_status).toBe('success');
    expect(ablettGoals.expected_grain).toBe('player_career');
    expect(ablettGoals.expected_metric).toBe('goals');
    expect(ablettGoals.expected_aggregation).toBe('max');
    expect(ablettGoals.verification_level).toBe('SEMANTIC');
    expect(ablettGoals.expected_failure_reason).toBe('');

    const ablettTackles = byId.get(11605)!;
    expect(ablettTackles.expected_metric).toBe('tackles');

    // Jones is a preserved decline, untouched and never read for its (blank) expected_metric.
    const jonesGoals = byId.get(11626)!;
    expect(jonesGoals.expected_status).toBe('decline');
    expect(jonesGoals.expected_metric).toBe('');

    const adelaideStreak = byId.get(11651)!;
    expect(adelaideStreak.expected_status).toBe('success');
    expect(adelaideStreak.expected_grain).toBe('team_streak');
    expect(adelaideStreak.expected_club).toBe('Adelaide');
    expect(adelaideStreak.expected_metric).toBe('');
    expect(adelaideStreak.expected_aggregation).toBe('max');

    const brisbaneStreak = byId.get(11959)!;
    expect(brisbaneStreak.expected_club).toBe('Brisbane Lions');
    expect(brisbaneStreak.expected_status).toBe('success');

    const coachGames = byId.get(11763)!;
    expect(coachGames.expected_status).toBe('success');
    expect(coachGames.expected_grain).toBe('coach_record');
    expect(coachGames.expected_metric).toBe('games');
    expect(coachGames.expected_club).toBe('Adelaide');

    const coachWins = byId.get(11791)!;
    expect(coachWins.expected_metric).toBe('wins');
  });

  it('preserves row ordering', () => {
    const rows = buildRows();
    const inputIds = rows.map((row) => Number(row.id));
    const { outputCsvText } = correctCorpus(buildCsv(rows));
    const outputIds = parseBack(outputCsvText).map((row) => Number(row.id));
    expect(outputIds).toEqual(inputIds);
  });

  it('leaves every non-target row byte-identical at the parsed field level', () => {
    const rows = buildRows();
    const { outputCsvText } = correctCorpus(buildCsv(rows));
    const outputRows = parseBack(outputCsvText);
    const targetIds = new Set([
      ...range(11601, 11605),
      ...range(11651, 11678), ...range(11679, 11706),
      ...range(11931, 11958), ...range(11959, 11986),
      ...range(11763, 11790), ...range(11791, 11818),
    ]);
    rows.forEach((before, index) => {
      if (targetIds.has(Number(before.id))) return;
      expect(outputRows[index]).toEqual(before);
    });
  });

  it('refuses when a target row is not currently expected_status=decline', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '11601');
    rows[index] = { ...rows[index], expected_status: 'success' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/11601.*decline/s);
  });

  it('refuses when a target row is missing', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '11601');
    rows[index] = { ...rows[index], id: '99999' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/missing expected target row id.*11601/s);
  });

  it('refuses on a duplicate target id', () => {
    const rows = buildRows();
    const fillerIndex = rows.findIndex((row) => row.id === '9');
    rows[fillerIndex] = { ...rows[fillerIndex], id: '11601' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/duplicate id.*11601/s);
  });

  it('refuses when the input row count is not exactly 12000', () => {
    const rows = buildRows();
    rows.pop();
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/exactly 12000 data rows/);
  });

  it('refuses when no already-passing mirror row exists for a group', () => {
    const rows = buildRows();
    const mirrorIndex = rows.findIndex((row) => row.id === '6');
    rows[mirrorIndex] = { ...rows[mirrorIndex], expected_grain: 'player_game' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/team_streak.*Refusing to guess/s);
  });

  it('derives all five Ablett metrics from their own question text, ignoring blank Jones expected_metric', () => {
    const rows = buildRows();
    // Confirms the fixture actually reproduces the real DEV failure mode: Jones carries no metric.
    for (const id of range(11626, 11630)) {
      expect(rows.find((row) => row.id === String(id))!.expected_metric).toBe('');
    }

    const { outputCsvText } = correctCorpus(buildCsv(rows));
    const byId = new Map(parseBack(outputCsvText).map((row) => [Number(row.id), row]));
    const expectedByOffset = ABLETT_METRIC_BY_OFFSET;
    range(11601, 11605).forEach((id, offset) => {
      expect(byId.get(id)!.expected_metric).toBe(expectedByOffset[offset]);
    });
  });

  it('fails closed when an Ablett question names an unaudited metric', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '11601');
    rows[index] = { ...rows[index], question: 'Who among the Abletts has the most kicks?' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/11601.*exactly one of goals\/games\/disposals\/marks\/tackles/s);
  });

  it('fails closed when an Ablett question names more than one audited metric', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '11601');
    rows[index] = { ...rows[index], question: 'Who among the Abletts has the most goals and games?' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/11601.*exactly one of/s);
  });

  it('fails closed when a question-derived metric disagrees with the audited id-to-metric map', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '11601'); // audited as "goals"
    rows[index] = { ...rows[index], question: 'Who among the Abletts has the most tackles?' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/11601.*names metric "tackles".*expects "goals"/s);
  });

  it('leaves Jones rows byte-identical regardless of their blank expected_metric', () => {
    const rows = buildRows();
    const { outputCsvText } = correctCorpus(buildCsv(rows));
    const outputRows = parseBack(outputCsvText);
    for (const id of range(11626, 11630)) {
      const index = rows.findIndex((row) => row.id === String(id));
      expect(outputRows[index]).toEqual(rows[index]);
    }
  });
});

describe('deriveAblettMetric', () => {
  it('reads the metric from the question and confirms it against the audited map', () => {
    expect(deriveAblettMetric(11602, 'Who among the Abletts has played the most games?')).toBe('games');
  });

  it('refuses a question naming zero audited metric words', () => {
    expect(() => deriveAblettMetric(11601, 'Who among the Abletts was best?')).toThrow(/exactly one of/);
  });

  it('refuses a question whose named metric disagrees with the audited id', () => {
    expect(() => deriveAblettMetric(11601, 'Who among the Abletts has the most marks?'))
      .toThrow(/names metric "marks".*expects "goals"/s);
  });
});

describe('detectAggregation', () => {
  it('reads a ranked-list ask from the question text itself', () => {
    expect(detectAggregation('What are Adelaide\'s top 5 winning streaks?')).toEqual({ aggregation: 'top_n', topN: 5 });
  });

  it('defaults to max when the question names no ranked list', () => {
    expect(detectAggregation('What is Adelaide\'s longest winning streak?')).toEqual({ aggregation: 'max' });
  });
});

describe('assertOutputPathIsSafe', () => {
  it('refuses to overwrite the input by default', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus.csv', '/home/arm/nl-stress-corpus.csv', false))
      .toThrow(/allow-overwrite-input/);
  });

  it('allows overwriting the input when deliberately invoked', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus.csv', '/home/arm/nl-stress-corpus.csv', true))
      .not.toThrow();
  });

  it('allows a distinct output path with no flag', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus.csv', '/home/arm/nl-stress-corpus-v2.csv', false))
      .not.toThrow();
  });
});
