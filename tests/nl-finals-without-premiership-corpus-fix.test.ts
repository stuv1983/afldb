/**
 * Fable NL code review (final acceptance pass, 2026-09-17) corpus
 * correction: tools/nl/fix-stale-finals-without-premiership-tie.ts.
 *
 * DB-free: builds a small synthetic 12,000-row corpus in memory (real rows
 * would be the external ~/nl-stress-corpus-v5.csv, which this repository
 * does not carry) with the exact 3-row `verified_finals_without_premiership`
 * equivalence group the final V5 rerun reported failing, then proves the
 * invariants the script's own header promises: it rewrites exactly those
 * three rows' expected_answer_primary/expected_tie_count to the audited
 * two-way tie, preserves expected_answer_value=24 and every other column,
 * refuses on any before-state/count/question-identity mismatch, and never
 * touches anything else.
 */
import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';

import { parseCsv } from '../tools/nl/corpus';
import {
  AUDITED_QUESTIONS, assertAuditedTiePreState, assertOutputPathIsSafe, correctCorpus,
  normaliseQuestion, TARGET_EQUIVALENCE_GROUP,
} from '../tools/nl/fix-stale-finals-without-premiership-tie';

// ------------------------------------------------------------------ fixture

const HEADER = [
  'id', 'category', 'difficulty', 'verification_level', 'equivalence_group', 'question', 'notes',
  'expected_status', 'expected_grain', 'expected_metric', 'expected_aggregation',
  'expected_predicates_json', 'expected_answer_primary', 'expected_answer_value',
  'expected_tie_count', 'expected_min_confidence',
] as const;

type Row = Record<(typeof HEADER)[number], string>;

const TARGET_IDS = [11001, 11002, 11003] as const;

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
    expected_metric: '',
    expected_aggregation: '',
    expected_predicates_json: '',
    expected_answer_primary: '',
    expected_answer_value: '',
    expected_tie_count: '',
    expected_min_confidence: '',
  };
}

/** The exact audited pre-state for each target row. */
function tieRow(id: number, question: string): Row {
  return {
    ...baseRow(id),
    category: 'career_record',
    verification_level: 'VERIFIED_RESULT',
    equivalence_group: TARGET_EQUIVALENCE_GROUP,
    question,
    notes: 'Nick Dal Santo holds the record',
    expected_grain: 'player_career',
    expected_metric: 'finals',
    expected_aggregation: 'max',
    expected_predicates_json: '[{"column":"premierships","op":"eq","value":0}]',
    expected_answer_primary: 'Nick Dal Santo',
    expected_answer_value: '24',
    expected_tie_count: '1',
    expected_min_confidence: '0.9',
  };
}

function buildRows(mutate?: (rows: Map<number, Row>) => void): Row[] {
  const rows = new Map<number, Row>();
  for (let id = 1; id <= 12000; id++) rows.set(id, baseRow(id));

  // Real-corpus shape: mixed case and a trailing "?" on the interrogative.
  rows.set(TARGET_IDS[0], tieRow(TARGET_IDS[0], 'Most finals without a premiership'));
  rows.set(TARGET_IDS[1], tieRow(TARGET_IDS[1], 'most career finals without a premiership'));
  rows.set(TARGET_IDS[2], tieRow(TARGET_IDS[2], 'Who played the most finals without a premiership?'));

  mutate?.(rows);
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

describe('finals-without-premiership tie correctCorpus', () => {
  it('rewrites exactly the 3 audited rows to the two-way tie and preserves the verified value', () => {
    const { outputCsvText, summary } = correctCorpus(buildCsv());

    expect(summary.inputRows).toBe(12000);
    expect(summary.outputRows).toBe(12000);
    expect(summary.targetRowsExpected).toBe(3);
    expect(summary.targetRowsModified).toBe(3);
    expect(summary.nonTargetRowsModified).toBe(0);
    expect(summary.targetIds).toEqual([...TARGET_IDS]);

    const outputRows = parseBack(outputCsvText);
    const byId = new Map(outputRows.map((row) => [Number(row.id), row]));

    for (const id of TARGET_IDS) {
      const row = byId.get(id)!;
      expect(row.expected_answer_primary).toBe('Dane Rampe|Nick Dal Santo');
      expect(row.expected_tie_count).toBe('2');

      // Preserved: the verified value and everything that is not the tie.
      expect(row.expected_answer_value).toBe('24');
      expect(row.expected_status).toBe('success');
      expect(row.verification_level).toBe('VERIFIED_RESULT');
      expect(row.equivalence_group).toBe(TARGET_EQUIVALENCE_GROUP);
      expect(row.expected_grain).toBe('player_career');
      expect(row.expected_metric).toBe('finals');
      expect(row.expected_predicates_json).toBe('[{"column":"premierships","op":"eq","value":0}]');
      expect(row.expected_min_confidence).toBe('0.9');
      expect(row.notes).toBe('Nick Dal Santo holds the record');
    }
  });

  it('leaves every non-target row byte-identical', () => {
    const inputRows = buildRows();
    const { outputCsvText } = correctCorpus(buildCsv(inputRows));
    const outputRows = parseBack(outputCsvText);
    expect(outputRows).toHaveLength(12000);
    const targets = new Set<number>(TARGET_IDS);
    for (let index = 0; index < inputRows.length; index++) {
      if (targets.has(Number(inputRows[index].id))) continue;
      expect(outputRows[index]).toEqual(inputRows[index]);
    }
  });

  it('question identity ignores case, surrounding whitespace and a trailing "?" only', () => {
    expect(normaliseQuestion('  Who played the most finals without a premiership?  '))
      .toBe('who played the most finals without a premiership');
    expect(normaliseQuestion('most   finals without a premiership')).toBe('most finals without a premiership');
    expect(AUDITED_QUESTIONS.map(normaliseQuestion)).toEqual(AUDITED_QUESTIONS);
  });

  // ---- refusals ----------------------------------------------------------

  it('refuses when the group does not hold exactly three rows', () => {
    const fewer = buildRows((rows) => { rows.get(TARGET_IDS[2])!.equivalence_group = ''; });
    expect(() => correctCorpus(buildCsv(fewer))).toThrow(/Expected exactly 3 rows in equivalence group/);

    const more = buildRows((rows) => {
      rows.set(5, { ...tieRow(5, 'most finals without a premiership') });
    });
    expect(() => correctCorpus(buildCsv(more))).toThrow(/Expected exactly 3 rows in equivalence group/);
  });

  it('refuses a group row whose question is not one of the audited three', () => {
    const rows = buildRows((rows) => {
      rows.get(TARGET_IDS[1])!.question = 'most grand finals without a premiership';
    });
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/not one of this correction's audited questions/);
  });

  it('refuses when an audited question is duplicated inside the group (and another missing)', () => {
    const rows = buildRows((rows) => {
      rows.get(TARGET_IDS[1])!.question = 'most finals without a premiership';
    });
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/not present exactly once in the group/);
  });

  it('refuses a target whose before-state is not the audited answer/value/tie', () => {
    const wrongPrimary = buildRows((rows) => { rows.get(TARGET_IDS[0])!.expected_answer_primary = 'Dane Rampe'; });
    expect(() => correctCorpus(buildCsv(wrongPrimary))).toThrow(/expects expected_answer_primary="Nick Dal Santo"/);

    const wrongValue = buildRows((rows) => { rows.get(TARGET_IDS[0])!.expected_answer_value = '25'; });
    expect(() => correctCorpus(buildCsv(wrongValue))).toThrow(/expects expected_answer_value=24/);

    const wrongTie = buildRows((rows) => { rows.get(TARGET_IDS[0])!.expected_tie_count = '2'; });
    expect(() => correctCorpus(buildCsv(wrongTie))).toThrow(/expects expected_tie_count=1/);

    const wrongStatus = buildRows((rows) => { rows.get(TARGET_IDS[0])!.expected_status = 'decline'; });
    expect(() => correctCorpus(buildCsv(wrongStatus))).toThrow(/expects expected_status="success"/);
  });

  it('refuses on structural corpus problems', () => {
    const wrongCount = buildRows();
    wrongCount.pop();
    expect(() => correctCorpus(buildCsv(wrongCount))).toThrow(/Expected exactly 12000 data rows/);

    const duplicate = buildRows();
    duplicate[10] = { ...duplicate[10], id: '5' };
    expect(() => correctCorpus(buildCsv(duplicate))).toThrow(/duplicate id/);

    const missingColumn = toCsv<Record<string, string>>(
      HEADER.filter((name) => name !== 'expected_tie_count'),
      buildRows().map(({ expected_tie_count: _t, ...rest }) => rest),
    );
    expect(() => correctCorpus(missingColumn)).toThrow(/missing required column "expected_tie_count"/);

    expect(() => correctCorpus('')).toThrow(/empty/);
  });

  it('assertAuditedTiePreState accepts the audited shape and rejects a blank tie count', () => {
    expect(() => assertAuditedTiePreState(tieRow(1, 'most finals without a premiership'))).not.toThrow();
    const blank = { ...tieRow(1, 'most finals without a premiership'), expected_tie_count: '' };
    expect(() => assertAuditedTiePreState(blank)).toThrow(/expects expected_tie_count=1/);
  });

  it('refuses to overwrite the input file unless deliberately allowed', () => {
    expect(() => assertOutputPathIsSafe('/tmp/a.csv', '/tmp/a.csv', false)).toThrow(/--allow-overwrite-input/);
    expect(() => assertOutputPathIsSafe('/tmp/a.csv', '/tmp/a.csv', true)).not.toThrow();
    expect(() => assertOutputPathIsSafe('/tmp/a.csv', '/tmp/b.csv', false)).not.toThrow();
  });
});
