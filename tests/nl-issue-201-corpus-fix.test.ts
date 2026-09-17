/**
 * AFLDB-ISSUE-201 correction script.
 *
 * DB-free: builds a small synthetic 12,000-row corpus in memory (real rows
 * would be the external ~/nl-stress-corpus-v2.csv, which this repository
 * does not carry) with the exact 2-row target the operator's AFLDB-ISSUE-201
 * cross-reference audited, then proves the invariants
 * tools/nl/fix-issue-201-stale-boundary-expectations.ts's own header comment
 * promises: it corrects exactly ids 9907 and 10294 to the established
 * coverage_unavailable decline shape, refuses on any before-state/count/id/
 * question-wording mismatch, and never touches anything else.
 */
import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';

import { parseCsv } from '../tools/nl/corpus';
import {
  assertAuditedBoundaryPreState, assertOutputPathIsSafe, correctCorpus,
} from '../tools/nl/fix-issue-201-stale-boundary-expectations';

// ------------------------------------------------------------------ fixture

const HEADER = [
  'id', 'category', 'difficulty', 'verification_level', 'equivalence_group', 'question', 'notes',
  'expected_status', 'expected_grain', 'expected_season_to', 'expected_match_type',
  'expected_boundary', 'expected_coverage_behavior', 'expected_min_confidence',
  'expected_failure_reason',
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
    expected_season_to: '',
    expected_match_type: '',
    expected_boundary: '',
    expected_coverage_behavior: '',
    expected_min_confidence: '',
    expected_failure_reason: '',
  };
}

/** The exact audited pre-state for both AFLDB-ISSUE-201 target rows. */
function boundaryRow(id: number, question: string): Row {
  return {
    ...baseRow(id),
    question,
    expected_grain: 'player_career',
    expected_season_to: '1896',
    expected_match_type: 'grand_final',
    expected_boundary: 'first',
    expected_coverage_behavior: 'full',
    expected_min_confidence: '0.78',
  };
}

function buildRows(): Row[] {
  const rows = new Map<number, Row>();
  for (let id = 1; id <= 12000; id++) rows.set(id, baseRow(id));

  rows.set(9907, boundaryRow(9907, 'players whose first game was a Grand Final before 1897'));
  rows.set(10294, boundaryRow(10294, 'players whose debut was a Grand Final before 1897'));

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

describe('AFLDB-ISSUE-201 correctCorpus', () => {
  it('changes exactly the audited 2 rows to the established coverage_unavailable decline shape', () => {
    const { outputCsvText, summary } = correctCorpus(buildCsv());

    expect(summary.inputRows).toBe(12000);
    expect(summary.outputRows).toBe(12000);
    expect(summary.targetRowsExpected).toBe(2);
    expect(summary.targetRowsModified).toBe(2);
    expect(summary.nonTargetRowsModified).toBe(0);

    const outputRows = parseBack(outputCsvText);
    const byId = new Map(outputRows.map((row) => [Number(row.id), row]));

    for (const id of [9907, 10294]) {
      const row = byId.get(id)!;
      expect(row.expected_status).toBe('decline');
      expect(row.verification_level).toBe('EXPECTED_DECLINE');
      expect(row.expected_failure_reason).toBe('coverage_unavailable');
      expect(row.expected_coverage_behavior).toBe('');
      expect(row.expected_min_confidence).toBe('');

      // Preserved: the plan still parses to exactly this shape, only the
      // season range is out of coverage.
      expect(row.expected_grain).toBe('player_career');
      expect(row.expected_season_to).toBe('1896');
      expect(row.expected_match_type).toBe('grand_final');
      expect(row.expected_boundary).toBe('first');
    }
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
    const targetIds = new Set([9907, 10294]);
    rows.forEach((before, index) => {
      if (targetIds.has(Number(before.id))) return;
      expect(outputRows[index]).toEqual(before);
    });
  });

  it('refuses when a target row\'s question text does not match the audited text', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '9907');
    rows[index] = { ...rows[index], question: 'players whose first game was a final before 1897' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/9907.*question text does not match/s);
  });

  it('refuses when a target row is not currently expected_status=success', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '9907');
    rows[index] = { ...rows[index], expected_status: 'decline' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/9907.*expected_status="success"/s);
  });

  it('refuses when a target row\'s seasonTo does not match the audited 1896', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '9907');
    rows[index] = { ...rows[index], expected_season_to: '1895' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/9907.*seasonTo=1896/s);
  });

  it('refuses when a target row\'s boundaryEvent does not match the audited debut', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '9907');
    rows[index] = { ...rows[index], expected_boundary: 'last' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/9907.*boundaryEvent="debut"/s);
  });

  it('refuses when a target row\'s matchType does not match the audited grand_final', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '9907');
    rows[index] = { ...rows[index], expected_match_type: 'final' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/9907.*matchType="grand_final"/s);
  });

  it('refuses when a target row is missing', () => {
    const rows = buildRows();
    const index = rows.findIndex((row) => row.id === '9907');
    rows[index] = { ...rows[index], id: '99999' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/missing expected target row id.*9907/s);
  });

  it('refuses on a duplicate target id', () => {
    const rows = buildRows();
    const fillerIndex = rows.findIndex((row) => row.id === '9');
    rows[fillerIndex] = { ...rows[fillerIndex], id: '9907' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/duplicate id.*9907/s);
  });

  it('refuses when the input row count is not exactly 12000', () => {
    const rows = buildRows();
    rows.pop();
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/exactly 12000 data rows/);
  });
});

describe('assertAuditedBoundaryPreState', () => {
  it('accepts a row matching the audited pre-state exactly', () => {
    const row = boundaryRow(9907, 'players whose first game was a Grand Final before 1897');
    expect(() => assertAuditedBoundaryPreState(9907, row)).not.toThrow();
  });

  it('refuses a mismatched question', () => {
    const row = boundaryRow(9907, 'wrong question text');
    expect(() => assertAuditedBoundaryPreState(9907, row)).toThrow(/question text does not match/);
  });

  it('refuses a row not currently expected_status=success', () => {
    const row = { ...boundaryRow(9907, 'players whose first game was a Grand Final before 1897'), expected_status: 'decline' };
    expect(() => assertAuditedBoundaryPreState(9907, row)).toThrow(/expected_status="success"/);
  });
});

describe('assertOutputPathIsSafe', () => {
  it('refuses to overwrite the input by default', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus-v2.csv', '/home/arm/nl-stress-corpus-v2.csv', false))
      .toThrow(/allow-overwrite-input/);
  });

  it('allows overwriting the input when deliberately invoked', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus-v2.csv', '/home/arm/nl-stress-corpus-v2.csv', true))
      .not.toThrow();
  });

  it('allows a distinct output path with no flag', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus-v2.csv', '/home/arm/nl-stress-corpus-v3.csv', false))
      .not.toThrow();
  });
});
