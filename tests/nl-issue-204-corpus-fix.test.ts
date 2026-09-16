/**
 * AFLDB-ISSUE-204 correction script.
 *
 * DB-free: builds a small synthetic 12,000-row corpus in memory (real rows
 * would be the external ~/nl-stress-corpus-v3.csv, which this repository
 * does not carry) with the exact 180-row `coverage_unavailable|fgf` target
 * family the operator's AFLDB-ISSUE-204 audit verified (disposals/marks/
 * tackles x finals/grand_final x seasons 1897-1926, 6 rows per season),
 * PLUS a set of non-target rows that share the same `finals_grand_final`
 * category and `fgf` equivalence-group template but differ in grain/metric/
 * mode/aggregation (team-match margin questions, goals questions, top-5-
 * listing questions -- the real corpus's other 816 `fgf`-template rows, per
 * the first operator run that correctly aborted on one of them, row 8910).
 * Proves the invariants
 * tools/nl/fix-issue-204-stale-coverage-expectations.ts's own header comment
 * promises: it derives exactly the 180 target rows from their full
 * structural signature (not just category/template), leaves every
 * category/template sibling untouched, corrects the 180 to the established
 * coverage_unavailable decline shape, refuses on any before-state/count/
 * distribution/question-wording mismatch, and never touches anything else.
 */
import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';

import { parseCsv } from '../tools/nl/corpus';
import {
  assertAuditedCoveragePreState, assertOutputPathIsSafe, assertQuestionMatchesRow, correctCorpus,
} from '../tools/nl/fix-issue-204-stale-coverage-expectations';

// ------------------------------------------------------------------ fixture

const HEADER = [
  'id', 'category', 'difficulty', 'verification_level', 'equivalence_group', 'question', 'notes',
  'expected_status', 'expected_grain', 'expected_mode', 'expected_metric', 'expected_aggregation',
  'expected_season_from', 'expected_season_to', 'expected_match_type',
  'expected_failure_reason', 'expected_coverage_behavior', 'expected_min_confidence',
] as const;

type Row = Record<(typeof HEADER)[number], string>;

const METRICS = ['disposals', 'marks', 'tackles'] as const;
const MATCH_TYPES = ['final', 'grand_final'] as const;
const SEASON_MIN = 1897;
const SEASON_MAX = 1926;

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
    expected_mode: '',
    expected_metric: '',
    expected_aggregation: '',
    expected_season_from: '',
    expected_season_to: '',
    expected_match_type: '',
    expected_failure_reason: '',
    expected_coverage_behavior: '',
    expected_min_confidence: '',
  };
}

/**
 * The plain-finals branch uses the real corpus's general-finals-scope
 * wording ("most X in finals in YEAR", plural, no "a"/"the") -- the exact
 * shape of real-corpus row 8919, whose plural "finals" the original
 * assertQuestionMatchesRow() singular-only regex rejected (AFLDB-ISSUE-204
 * second operator-validation finding, 2026-09-16).
 */
function questionFor(metric: string, matchType: 'final' | 'grand_final', season: number): string {
  return matchType === 'grand_final'
    ? `Most ${metric} by a player in the ${season} Grand Final`
    : `Most ${metric} by a player in finals in ${season}`;
}

/** The exact audited pre-state shape for one AFLDB-ISSUE-204 target row. */
function targetRow(id: number, metric: string, matchType: 'final' | 'grand_final', season: number): Row {
  return {
    ...baseRow(id),
    category: 'finals_grand_final',
    equivalence_group: 'fgf|coverage_boundary',
    question: questionFor(metric, matchType, season),
    expected_grain: 'player_game',
    expected_mode: 'single',
    expected_metric: metric,
    expected_aggregation: 'max',
    expected_season_from: String(season),
    expected_season_to: String(season),
    expected_match_type: matchType,
    expected_failure_reason: '',
    expected_coverage_behavior: 'full',
    expected_min_confidence: '0.80',
  };
}

/**
 * A `finals_grand_final`/`fgf`-template sibling row that is NOT part of the
 * 180-row target family: `team_match` grain (e.g. "biggest Grand Final win
 * since 1897", real-corpus row 8910). Shares category+template with the
 * targets but must be excluded on grain alone.
 */
function teamMatchSiblingRow(id: number, season: number): Row {
  return {
    ...baseRow(id),
    category: 'finals_grand_final',
    equivalence_group: 'fgf|coverage_margin',
    question: `Biggest Grand Final win since ${season}`,
    expected_grain: 'team_match',
    expected_mode: 'single',
    expected_metric: 'margin',
    expected_aggregation: 'max',
    expected_season_from: String(season),
    expected_season_to: '2024',
    expected_match_type: 'grand_final',
    expected_failure_reason: '',
    expected_coverage_behavior: 'full',
    expected_min_confidence: '0.80',
  };
}

/**
 * A `finals_grand_final`/`fgf`-template sibling row that is NOT part of the
 * 180-row target family: a goals question (e.g. "most goals in the 1897
 * Grand Final"). Shares category+template+grain+mode+aggregation with the
 * targets but must be excluded on metric alone.
 */
function goalsSiblingRow(id: number, matchType: 'final' | 'grand_final', season: number): Row {
  return {
    ...baseRow(id),
    category: 'finals_grand_final',
    equivalence_group: 'fgf|coverage_boundary',
    question: questionFor('goals', matchType, season),
    expected_grain: 'player_game',
    expected_mode: 'single',
    expected_metric: 'goals',
    expected_aggregation: 'max',
    expected_season_from: String(season),
    expected_season_to: String(season),
    expected_match_type: matchType,
    expected_failure_reason: '',
    expected_coverage_behavior: 'full',
    expected_min_confidence: '0.80',
  };
}

/**
 * A `finals_grand_final`/`fgf`-template sibling row that is NOT part of the
 * 180-row target family: a top-5-listing question (e.g. "top 5 disposals
 * games in finals since 1897"). Shares category+template+grain+metric with
 * the targets but must be excluded on mode/aggregation alone.
 */
function topFiveSiblingRow(id: number, metric: string, matchType: 'final' | 'grand_final', season: number): Row {
  return {
    ...baseRow(id),
    category: 'finals_grand_final',
    equivalence_group: 'fgf|coverage_boundary',
    question: `Top 5 ${metric} games in ${matchType === 'grand_final' ? 'Grand Finals' : 'finals'} since ${season}`,
    expected_grain: 'player_game',
    expected_mode: 'multi',
    expected_metric: metric,
    expected_aggregation: 'top_n',
    expected_season_from: String(season),
    expected_season_to: '2024',
    expected_match_type: matchType,
    expected_failure_reason: '',
    expected_coverage_behavior: 'full',
    expected_min_confidence: '0.80',
  };
}

/** The 180 (id -> definition) target rows: 30 seasons x 3 metrics x 2 match types. */
function buildTargetDefs(): { id: number; metric: string; matchType: 'final' | 'grand_final'; season: number }[] {
  const defs: { id: number; metric: string; matchType: 'final' | 'grand_final'; season: number }[] = [];
  let id = 5000;
  for (let season = SEASON_MIN; season <= SEASON_MAX; season++) {
    for (const metric of METRICS) {
      for (const matchType of MATCH_TYPES) {
        defs.push({ id: id++, metric, matchType, season });
      }
    }
  }
  return defs;
}

const TARGET_DEFS = buildTargetDefs();
const TARGET_IDS = TARGET_DEFS.map((d) => d.id);

/**
 * Ids for the 6 category/template siblings that are NOT part of the 180-row
 * target family -- the real corpus's other 816 `fgf`-template rows, per the
 * first operator run (996 broad candidates, 180 real targets).
 */
const SIBLING_TEAM_MATCH_ID = 6000;
const SIBLING_GOALS_FINAL_ID = 6001;
const SIBLING_GOALS_GRAND_FINAL_ID = 6002;
const SIBLING_TOP5_DISPOSALS_ID = 6003;
const SIBLING_TOP5_MARKS_ID = 6004;
const SIBLING_TOP5_TACKLES_ID = 6005;
const SIBLING_IDS = [
  SIBLING_TEAM_MATCH_ID, SIBLING_GOALS_FINAL_ID, SIBLING_GOALS_GRAND_FINAL_ID,
  SIBLING_TOP5_DISPOSALS_ID, SIBLING_TOP5_MARKS_ID, SIBLING_TOP5_TACKLES_ID,
];

function buildSiblingRows(): Row[] {
  return [
    teamMatchSiblingRow(SIBLING_TEAM_MATCH_ID, 1900),
    goalsSiblingRow(SIBLING_GOALS_FINAL_ID, 'final', 1900),
    goalsSiblingRow(SIBLING_GOALS_GRAND_FINAL_ID, 'grand_final', 1900),
    topFiveSiblingRow(SIBLING_TOP5_DISPOSALS_ID, 'disposals', 'final', 1900),
    topFiveSiblingRow(SIBLING_TOP5_MARKS_ID, 'marks', 'grand_final', 1900),
    topFiveSiblingRow(SIBLING_TOP5_TACKLES_ID, 'tackles', 'final', 1900),
  ];
}

function buildRows(overrides?: { defs?: typeof TARGET_DEFS }): Row[] {
  const defs = overrides?.defs ?? TARGET_DEFS;
  const rows = new Map<number, Row>();
  for (let id = 1; id <= 12000; id++) rows.set(id, baseRow(id));
  for (const def of defs) rows.set(def.id, targetRow(def.id, def.metric, def.matchType, def.season));
  for (const row of buildSiblingRows()) rows.set(Number(row.id), row);
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

function findRowIndex(rows: Row[], id: number): number {
  const index = rows.findIndex((row) => row.id === String(id));
  if (index === -1) throw new Error(`Internal fixture error: id ${id} not found.`);
  return index;
}

// --------------------------------------------------------------------- tests

describe('AFLDB-ISSUE-204 correctCorpus', () => {
  it('changes exactly the derived 180 rows to the established coverage_unavailable decline shape', () => {
    const { outputCsvText, summary } = correctCorpus(buildCsv());

    expect(summary.inputRows).toBe(12000);
    expect(summary.outputRows).toBe(12000);
    expect(summary.targetRowsExpected).toBe(180);
    expect(summary.targetRowsModified).toBe(180);
    expect(summary.nonTargetRowsModified).toBe(0);

    const outputRows = parseBack(outputCsvText);
    const byId = new Map(outputRows.map((row) => [Number(row.id), row]));

    for (const def of TARGET_DEFS) {
      const row = byId.get(def.id)!;
      expect(row.expected_status).toBe('decline');
      expect(row.verification_level).toBe('EXPECTED_DECLINE');
      expect(row.expected_failure_reason).toBe('coverage_unavailable');
      expect(row.expected_coverage_behavior).toBe('');
      expect(row.expected_min_confidence).toBe('');

      // Preserved: the plan still parses to exactly this shape, only the
      // season range is out of coverage.
      expect(row.expected_grain).toBe('player_game');
      expect(row.expected_mode).toBe('single');
      expect(row.expected_metric).toBe(def.metric);
      expect(row.expected_aggregation).toBe('max');
      expect(row.expected_season_from).toBe(String(def.season));
      expect(row.expected_season_to).toBe(String(def.season));
      expect(row.expected_match_type).toBe(def.matchType);
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
    const targetIdSet = new Set(TARGET_IDS);
    rows.forEach((before, index) => {
      if (targetIdSet.has(Number(before.id))) return;
      expect(outputRows[index]).toEqual(before);
    });
  });

  it('refuses when the input row count is not exactly 12000', () => {
    const rows = buildRows();
    rows.pop();
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/exactly 12000 data rows/);
  });

  it('refuses when a target row is missing (derived count drops below 180)', () => {
    const rows = buildRows();
    const index = findRowIndex(rows, TARGET_DEFS[0].id);
    // Replace the target row with a filler row at a different id -- the
    // corpus still has 12000 rows and no duplicate, but only 179 rows now
    // match the audited cluster signature.
    rows[index] = baseRow(99999);
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/Expected exactly 180.*found 179/s);
  });

  it('refuses on a duplicate id', () => {
    const rows = buildRows();
    const fillerIndex = rows.findIndex((row) => row.category === 'filler' && row.id === '9');
    rows[fillerIndex] = { ...rows[fillerIndex], id: String(TARGET_DEFS[0].id) };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(new RegExp(`duplicate id.*${TARGET_DEFS[0].id}`, 's'));
  });

  it('refuses when a target row\'s old expected_status has already drifted from success', () => {
    const rows = buildRows();
    const id = TARGET_DEFS[0].id;
    const index = findRowIndex(rows, id);
    rows[index] = { ...rows[index], expected_status: 'decline' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(new RegExp(`${id}.*expected_status="success"`, 's'));
  });

  it('refuses when a target row\'s old expected_coverage_behavior has drifted from full', () => {
    const rows = buildRows();
    const id = TARGET_DEFS[0].id;
    const index = findRowIndex(rows, id);
    rows[index] = { ...rows[index], expected_coverage_behavior: 'partial' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(new RegExp(`${id}.*expected_coverage_behavior="full"`, 's'));
  });

  it('refuses when a target row\'s question text disagrees with its own metric/season/match-type fields', () => {
    const rows = buildRows();
    const id = TARGET_DEFS[0].id;
    const index = findRowIndex(rows, id);
    rows[index] = { ...rows[index], question: 'Completely unrelated question text' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(new RegExp(`${id}.*question`, 's'));
  });

  // expected_metric/expected_match_type/expected_season are structural
  // signature fields gated by isCandidateTarget() itself (see the tool's
  // "THE FIRST RUN'S FAILURE" header comment), not post-candidacy drift
  // checks -- so mutating one on a target row makes that row silently drop
  // out of candidacy rather than raising a field-specific error. That
  // surfaces as the same "missing target" count mismatch as an outright
  // removed row, which is the correct fail-closed outcome: an ambiguous row
  // must never be silently folded into or dropped from the family.
  it('excludes (and refuses to run) a target row whose expected_metric is not one of disposals/marks/tackles', () => {
    const rows = buildRows();
    const id = TARGET_DEFS[0].id;
    const index = findRowIndex(rows, id);
    rows[index] = { ...rows[index], expected_metric: 'kicks' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/Expected exactly 180.*found 179/s);
  });

  it('excludes (and refuses to run) a target row whose season is outside the audited 1897-1926 range', () => {
    const rows = buildRows();
    const id = TARGET_DEFS[0].id;
    const index = findRowIndex(rows, id);
    rows[index] = { ...rows[index], expected_season_from: '1930', expected_season_to: '1930', question: questionFor(TARGET_DEFS[0].metric, TARGET_DEFS[0].matchType, 1930) };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/Expected exactly 180.*found 179/s);
  });

  it('excludes (and refuses to run) a target row whose expected_match_type is not final/grand_final', () => {
    const rows = buildRows();
    const id = TARGET_DEFS[0].id;
    const index = findRowIndex(rows, id);
    rows[index] = { ...rows[index], expected_match_type: 'finals' };
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/Expected exactly 180.*found 179/s);
  });

  // ---- category/template siblings (the real corpus's other 816 `fgf` rows)

  it('ignores a non-target fgf team_match row (the real-corpus row-8910 shape) without aborting', () => {
    const rows = buildRows();
    const { outputCsvText, summary } = correctCorpus(buildCsv(rows));
    expect(summary.targetRowsModified).toBe(180);
    expect(summary.nonTargetRowsModified).toBe(0);
    const outputRows = parseBack(outputCsvText);
    expect(outputRows[findRowIndex(rows, SIBLING_TEAM_MATCH_ID)]).toEqual(rows[findRowIndex(rows, SIBLING_TEAM_MATCH_ID)]);
  });

  it('ignores non-target fgf goals rows without aborting', () => {
    const rows = buildRows();
    const { outputCsvText, summary } = correctCorpus(buildCsv(rows));
    expect(summary.targetRowsModified).toBe(180);
    expect(summary.nonTargetRowsModified).toBe(0);
    const outputRows = parseBack(outputCsvText);
    for (const id of [SIBLING_GOALS_FINAL_ID, SIBLING_GOALS_GRAND_FINAL_ID]) {
      expect(outputRows[findRowIndex(rows, id)]).toEqual(rows[findRowIndex(rows, id)]);
    }
  });

  it('ignores non-target fgf top-5 disposals/marks/tackles rows without aborting', () => {
    const rows = buildRows();
    const { outputCsvText, summary } = correctCorpus(buildCsv(rows));
    expect(summary.targetRowsModified).toBe(180);
    expect(summary.nonTargetRowsModified).toBe(0);
    const outputRows = parseBack(outputCsvText);
    for (const id of [SIBLING_TOP5_DISPOSALS_ID, SIBLING_TOP5_MARKS_ID, SIBLING_TOP5_TACKLES_ID]) {
      expect(outputRows[findRowIndex(rows, id)]).toEqual(rows[findRowIndex(rows, id)]);
    }
  });

  it('still refuses when a genuine target row is missing, even with siblings present', () => {
    const rows = buildRows();
    const index = findRowIndex(rows, TARGET_DEFS[0].id);
    rows[index] = baseRow(99999);
    expect(() => correctCorpus(buildCsv(rows))).toThrow(/Expected exactly 180.*found 179/s);
  });

  it('fixture sanity: sibling ids do not collide with target ids', () => {
    const targetIdSet = new Set(TARGET_IDS);
    for (const id of SIBLING_IDS) expect(targetIdSet.has(id)).toBe(false);
  });
});

describe('assertAuditedCoveragePreState', () => {
  it('accepts a row matching the audited pre-state exactly', () => {
    const row = targetRow(5000, 'disposals', 'final', 1897);
    expect(() => assertAuditedCoveragePreState(5000, row)).not.toThrow();
  });

  it('refuses a row not currently expected_status=success', () => {
    const row = { ...targetRow(5000, 'disposals', 'final', 1897), expected_status: 'decline' };
    expect(() => assertAuditedCoveragePreState(5000, row)).toThrow(/expected_status="success"/);
  });

  it('refuses a row whose expected_min_confidence has drifted from 0.80', () => {
    const row = { ...targetRow(5000, 'disposals', 'final', 1897), expected_min_confidence: '0.78' };
    expect(() => assertAuditedCoveragePreState(5000, row)).toThrow(/expected_min_confidence="0.80"/);
  });
});

describe('assertQuestionMatchesRow', () => {
  it('accepts a grand_final question naming "grand final"', () => {
    expect(() => assertQuestionMatchesRow(1, 'Most marks in the 1910 Grand Final', 'marks', 'grand_final', 1910)).not.toThrow();
  });

  it('refuses a "final" question that actually says "grand final"', () => {
    expect(() => assertQuestionMatchesRow(1, 'Most marks in the 1910 Grand Final', 'marks', 'final', 1910)).toThrow(/without "grand final"/);
  });

  it('refuses a question missing the season', () => {
    expect(() => assertQuestionMatchesRow(1, 'Most marks in a final', 'marks', 'final', 1910)).toThrow(/does not name season/);
  });

  // AFLDB-ISSUE-204 second operator-validation finding (2026-09-16): the
  // real corpus's general-finals-scope wording is plural ("in finals"), not
  // singular -- the checker must accept both, and still reject "grand
  // final" wording for the plain-finals type.
  it('accepts expected_match_type="final" with the corpus\'s plural "finals" wording', () => {
    expect(() => assertQuestionMatchesRow(8919, 'most disposals in finals in 1897', 'disposals', 'final', 1897)).not.toThrow();
  });

  it('accepts expected_match_type="final" with singular "final" wording', () => {
    expect(() => assertQuestionMatchesRow(1, 'Most marks in a final in 1910', 'marks', 'final', 1910)).not.toThrow();
  });

  // Requirement 3 (still rejects "Grand Final" for expected_match_type=
  // "final") is already covered above by 'refuses a "final" question that
  // actually says "grand final"'.

  it('refuses expected_match_type="grand_final" with only plural "finals" wording (no "grand")', () => {
    expect(() => assertQuestionMatchesRow(1, 'Most marks in finals in 1910', 'marks', 'grand_final', 1910)).toThrow(/does not say "grand final"/);
  });
});

describe('assertOutputPathIsSafe', () => {
  it('refuses to overwrite the input by default', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus-v3.csv', '/home/arm/nl-stress-corpus-v3.csv', false))
      .toThrow(/allow-overwrite-input/);
  });

  it('allows overwriting the input when deliberately invoked', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus-v3.csv', '/home/arm/nl-stress-corpus-v3.csv', true))
      .not.toThrow();
  });

  it('allows a distinct output path with no flag', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus-v3.csv', '/home/arm/nl-stress-corpus-v4.csv', false))
      .not.toThrow();
  });
});
