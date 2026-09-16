/**
 * AFLDB-ISSUE-205 correction script.
 *
 * DB-free: `correctCorpus()` takes a `ParseEngine` (the narrow ctx +
 * parseNlQuestion slice of `loadEngine()`'s real DB-backed engine), so a
 * fake `parseNlQuestion` keyed by exact question text stands in for it here
 * -- no database, no real parser invocation. Builds a small synthetic
 * 12,000-row corpus with the exact 42/28 Family A/B target rows AFLDB-
 * ISSUE-205's audit describes, PLUS a set of unrelated `decline`/
 * `unsupported_topic` sibling rows (fantasy/SuperCoach, rebound 50s) that
 * share the target rows' exact old-state shape but must never be inspected
 * as candidates -- the real V4 corpus's row 11819 ("Adelaide highest
 * fantasy score") that the first version of this script incorrectly
 * aborted on.
 *
 * Proves the invariants `tools/nl/fix-issue-205-comeback-taxonomy.ts`'s own
 * header comment promises: candidacy is decided by question-text family
 * signature alone (never by old-state fields), an unrelated
 * decline/unsupported_topic row is silently ignored rather than inspected
 * or asserted against, a genuine Family A/B row with drifted old-state
 * aborts the whole run, the derived 42/28/70 distribution is enforced, and
 * every non-target row is left byte-identical.
 */
import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';
import type { NlParse, NlParseReport, NlQueryPlan } from '@/search/nl/plan';
import type { NlParseContext } from '@/search/nl/parser';

import { parseCsv } from '../tools/nl/corpus';
import { assertOutputPathIsSafe, correctCorpus, type ParseEngine } from '../tools/nl/fix-issue-205-comeback-taxonomy';

// ------------------------------------------------------------------ fixture

const HEADER = [
  'id', 'category', 'equivalence_group', 'question', 'expected_status', 'verification_level',
  'expected_grain', 'expected_mode', 'expected_metric', 'expected_aggregation',
  'expected_club', 'expected_opponent', 'expected_venue',
  'expected_season_from', 'expected_season_to', 'expected_match_type',
  'expected_failure_reason', 'expected_coverage_behavior', 'expected_min_confidence',
] as const;

type Row = Record<(typeof HEADER)[number], string>;

function baseRow(id: number): Row {
  return {
    id: String(id),
    category: 'filler',
    equivalence_group: '',
    question: `Filler question ${id}`,
    expected_status: 'success',
    verification_level: 'SEMANTIC',
    expected_grain: 'player_game',
    expected_mode: '',
    expected_metric: '',
    expected_aggregation: '',
    expected_club: '',
    expected_opponent: '',
    expected_venue: '',
    expected_season_from: '',
    expected_season_to: '',
    expected_match_type: '',
    expected_failure_reason: '',
    expected_coverage_behavior: '',
    expected_min_confidence: '',
  };
}

/** The audited AFLDB-ISSUE-205 before-state shared by every Family A/B target row. */
function declineRow(id: number, question: string): Row {
  return {
    ...baseRow(id),
    category: 'expected_decline',
    equivalence_group: 'decline',
    question,
    expected_status: 'decline',
    verification_level: 'EXPECTED_DECLINE',
    expected_failure_reason: 'unsupported_topic',
  };
}

const CLUBS = ['Adelaide', 'Brisbane Lions', 'Carlton', 'Richmond', 'Geelong', 'Collingwood', 'Fremantle'];

/** 7 clubs x 6 phrasings = 42 -- the exact audited Family A count. */
const FAMILY_A_PHRASINGS: ((club: string) => string)[] = [
  (club) => `${club} biggest three quarter time comeback`,
  (club) => `${club} biggest three quarter time comeback since 2000`,
  (club) => `who has the biggest three quarter time comeback for ${club}`,
  (club) => `${club} three quarter time comeback`,
  (club) => `${club} 3qt comeback`,
  (club) => `${club} largest three quarter time comeback`,
];

/** 7 clubs x 4 phrasings = 28 -- the exact audited Family B count. */
const FAMILY_B_PHRASINGS: ((club: string) => string)[] = [
  (club) => `${club} largest comeback from quarter time`,
  (club) => `${club} largest comeback from quarter time since 2000`,
  (club) => `who has the largest comeback from quarter time for ${club}`,
  (club) => `${club} comeback from quarter time`,
];

function buildFamilyADefs(): { id: number; club: string; question: string }[] {
  const defs: { id: number; club: string; question: string }[] = [];
  let id = 5000;
  for (const club of CLUBS) {
    for (const phrasing of FAMILY_A_PHRASINGS) {
      defs.push({ id: id++, club, question: phrasing(club) });
    }
  }
  return defs;
}

function buildFamilyBDefs(): { id: number; club: string; question: string }[] {
  const defs: { id: number; club: string; question: string }[] = [];
  let id = 5100;
  for (const club of CLUBS) {
    for (const phrasing of FAMILY_B_PHRASINGS) {
      defs.push({ id: id++, club, question: phrasing(club) });
    }
  }
  return defs;
}

const FAMILY_A_DEFS = buildFamilyADefs();
const FAMILY_B_DEFS = buildFamilyBDefs();
// Fixture-generator self-check, not a vitest assertion (this runs at module
// load, before any test context exists): the 7-club x 6/4-phrasing
// generators above must themselves build exactly the audited 42/28, or
// every test below would be exercising the wrong shape silently.
if (FAMILY_A_DEFS.length !== 42) throw new Error(`Fixture generator error: Family A built ${FAMILY_A_DEFS.length} rows, expected 42.`);
if (FAMILY_B_DEFS.length !== 28) throw new Error(`Fixture generator error: Family B built ${FAMILY_B_DEFS.length} rows, expected 28.`);

/**
 * Ids for the unrelated decline/unsupported_topic siblings that share the
 * target rows' exact old-state shape but must never be inspected as
 * candidates -- the real corpus's row 11819 ("Adelaide highest fantasy
 * score") the first version of this script incorrectly aborted on.
 */
const SIBLING_FANTASY_ID = 6000;
const SIBLING_REBOUND_ID = 6001;
const SIBLING_YOUNGEST_ID = 6002;
const SIBLING_IDS = [SIBLING_FANTASY_ID, SIBLING_REBOUND_ID, SIBLING_YOUNGEST_ID];

function buildSiblingRows(): Row[] {
  return [
    declineRow(SIBLING_FANTASY_ID, 'Adelaide highest fantasy score'),
    declineRow(SIBLING_REBOUND_ID, 'Adelaide most rebound 50s in a season'),
    declineRow(SIBLING_YOUNGEST_ID, 'Who is the youngest player to debut for Adelaide'),
  ];
}

function buildRows(overrides?: {
  familyA?: typeof FAMILY_A_DEFS;
  familyB?: typeof FAMILY_B_DEFS;
}): Row[] {
  const familyA = overrides?.familyA ?? FAMILY_A_DEFS;
  const familyB = overrides?.familyB ?? FAMILY_B_DEFS;
  const rows = new Map<number, Row>();
  for (let id = 1; id <= 12000; id++) rows.set(id, baseRow(id));
  for (const def of familyA) rows.set(def.id, declineRow(def.id, def.question));
  for (const def of familyB) rows.set(def.id, declineRow(def.id, def.question));
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

// -------------------------------------------------------------- fake engine

const FAKE_CTX = {} as NlParseContext;

function fakeReport(unsupportedTerms: string[] = []): NlParseReport {
  return {
    confidence: unsupportedTerms.length > 0 ? 0.2 : 0.9,
    components: { tokenRatio: 1, playerCertainty: 1, structuralPenalty: 1, unresolvedPenalty: 0 },
    normalisedQuery: '',
    consumed: [],
    unsupportedTerms,
    notes: [],
    entityResolution: [],
  };
}

function familyAPlan(club: string): NlQueryPlan {
  return {
    v: 1,
    grain: 'team_match',
    metric: 'q3_deficit_overcome',
    agg: { kind: 'max' },
    scope: { clubFor: { organizationId: CLUBS.indexOf(club) + 1, slug: club.toLowerCase(), name: club } },
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 25,
  };
}

/**
 * Keys the fake parser by exact question text -- `correctCorpus()` only
 * ever calls `parseNlQuestion` for rows it has already selected as Family
 * A/B candidates, so every question this fixture builds for those two
 * families must have a canned result here.
 */
function buildFakeEngine(overrides?: {
  familyAResult?: (club: string, question: string) => NlParse;
  familyBResult?: (club: string, question: string) => NlParse;
}): ParseEngine {
  const familyAResult = overrides?.familyAResult ?? ((club: string): NlParse => ({ status: 'plan', plan: familyAPlan(club), report: fakeReport() }));
  const familyBResult = overrides?.familyBResult ?? ((): NlParse => ({ status: 'none', reason: 'unrecognised', report: fakeReport(['comeback']) }));

  const byQuestion = new Map<string, NlParse>();
  for (const def of FAMILY_A_DEFS) byQuestion.set(def.question, familyAResult(def.club, def.question));
  for (const def of FAMILY_B_DEFS) byQuestion.set(def.question, familyBResult(def.club, def.question));

  return {
    ctx: FAKE_CTX,
    parseNlQuestion: async (question: string) => {
      const result = byQuestion.get(question);
      if (!result) throw new Error(`fakeEngine: no canned parseNlQuestion result for "${question}"`);
      return result;
    },
  };
}

// --------------------------------------------------------------------- tests

describe('AFLDB-ISSUE-205 correctCorpus', () => {
  it('ignores an unrelated decline/unsupported_topic fantasy row -- the real row-11819 regression', async () => {
    const { outputCsvText } = await correctCorpus(buildCsv(), buildFakeEngine());
    const outputRows = parseBack(outputCsvText);
    const fantasyRow = outputRows[findRowIndex(outputRows, SIBLING_FANTASY_ID)];
    expect(fantasyRow).toEqual(declineRow(SIBLING_FANTASY_ID, 'Adelaide highest fantasy score'));
  });

  it('ignores an unrelated decline/unsupported_topic rebound-50 row', async () => {
    const { outputCsvText } = await correctCorpus(buildCsv(), buildFakeEngine());
    const outputRows = parseBack(outputCsvText);
    const reboundRow = outputRows[findRowIndex(outputRows, SIBLING_REBOUND_ID)];
    expect(reboundRow).toEqual(declineRow(SIBLING_REBOUND_ID, 'Adelaide most rebound 50s in a season'));
  });

  it('selects and corrects a Family A row to the real re-parsed plan shape', async () => {
    const { outputCsvText } = await correctCorpus(buildCsv(), buildFakeEngine());
    const outputRows = parseBack(outputCsvText);
    const def = FAMILY_A_DEFS[0];
    const row = outputRows[findRowIndex(outputRows, def.id)];
    expect(row.expected_status).toBe('success');
    expect(row.verification_level).toBe('SEMANTIC');
    expect(row.expected_grain).toBe('team_match');
    expect(row.expected_metric).toBe('q3_deficit_overcome');
    expect(row.expected_aggregation).toBe('max');
    expect(row.expected_club).toBe(def.club);
    expect(row.expected_failure_reason).toBe('');
  });

  it('selects and corrects a Family B row to unsupported_term only, preserving every other field', async () => {
    const rows = buildRows();
    const { outputCsvText } = await correctCorpus(buildCsv(rows), buildFakeEngine());
    const outputRows = parseBack(outputCsvText);
    const def = FAMILY_B_DEFS[0];
    const before = rows[findRowIndex(rows, def.id)];
    const after = outputRows[findRowIndex(outputRows, def.id)];
    expect(after).toEqual({ ...before, expected_failure_reason: 'unsupported_term' });
  });

  it('refuses when a Family A target is missing (derived count drops below 42)', async () => {
    const familyA = FAMILY_A_DEFS.slice(1); // drop one -> 41
    const rows = buildRows({ familyA });
    await expect(correctCorpus(buildCsv(rows), buildFakeEngine())).rejects.toThrow(/Expected exactly 42 Family A.*found 41/s);
  });

  it('refuses when a Family B target is missing (derived count drops below 28)', async () => {
    const familyB = FAMILY_B_DEFS.slice(1); // drop one -> 27
    const rows = buildRows({ familyB });
    await expect(correctCorpus(buildCsv(rows), buildFakeEngine())).rejects.toThrow(/Expected exactly 28 Family B.*found 27/s);
  });

  it('refuses when a genuine Family A row\'s old-state has already drifted from decline', async () => {
    const rows = buildRows();
    const id = FAMILY_A_DEFS[0].id;
    const index = findRowIndex(rows, id);
    rows[index] = { ...rows[index], expected_status: 'success' };
    await expect(correctCorpus(buildCsv(rows), buildFakeEngine())).rejects.toThrow(new RegExp(`Row ${id}.*expected_status="success"`, 's'));
  });

  it('refuses when a genuine Family B row\'s old failure reason has already drifted', async () => {
    const rows = buildRows();
    const id = FAMILY_B_DEFS[0].id;
    const index = findRowIndex(rows, id);
    rows[index] = { ...rows[index], expected_failure_reason: 'coverage_unavailable' };
    await expect(correctCorpus(buildCsv(rows), buildFakeEngine())).rejects.toThrow(new RegExp(`Row ${id}.*expected_failure_reason="coverage_unavailable"`, 's'));
  });

  it('leaves every non-target row (filler and unrelated decline siblings) byte-identical', async () => {
    const rows = buildRows();
    const { outputCsvText } = await correctCorpus(buildCsv(rows), buildFakeEngine());
    const outputRows = parseBack(outputCsvText);
    const targetIdSet = new Set([...FAMILY_A_DEFS, ...FAMILY_B_DEFS].map((d) => d.id));
    rows.forEach((before, index) => {
      if (targetIdSet.has(Number(before.id))) return;
      expect(outputRows[index]).toEqual(before);
    });
    // Explicitly re-confirms the 3 siblings by id, not just by exclusion.
    for (const id of SIBLING_IDS) {
      expect(outputRows[findRowIndex(outputRows, id)]).toEqual(rows[findRowIndex(rows, id)]);
    }
  });

  it('proves the exact 42/28/70 distribution and 0 non-target modification', async () => {
    const { summary } = await correctCorpus(buildCsv(), buildFakeEngine());
    expect(summary.inputRows).toBe(12000);
    expect(summary.outputRows).toBe(12000);
    expect(summary.familyARowsExpected).toBe(42);
    expect(summary.familyBRowsExpected).toBe(28);
    expect(summary.targetRowsExpected).toBe(70);
    expect(summary.targetRowsModified).toBe(70);
    expect(summary.nonTargetRowsModified).toBe(0);
  });

  it('refuses when the real re-parsed plan for a Family A row does not match the audited shape', async () => {
    const engine = buildFakeEngine({
      familyAResult: () => ({ status: 'none', reason: 'unrecognised', report: fakeReport(['comeback']) }),
    });
    await expect(correctCorpus(buildCsv(), engine)).rejects.toThrow(/expected the fixed parser to produce a plan/);
  });

  it('refuses when a Family B row unexpectedly re-parses to a plan (Q1 support may have been added)', async () => {
    const engine = buildFakeEngine({
      familyBResult: (club) => ({ status: 'plan', plan: familyAPlan(club), report: fakeReport() }),
    });
    await expect(correctCorpus(buildCsv(), engine)).rejects.toThrow(/expected .* to still decline post-fix/);
  });

  it('refuses when the input row count is not exactly 12000', async () => {
    const rows = buildRows();
    rows.pop();
    await expect(correctCorpus(buildCsv(rows), buildFakeEngine())).rejects.toThrow(/exactly 12000 data rows/);
  });

  it('refuses on a duplicate id', async () => {
    const rows = buildRows();
    const fillerIndex = rows.findIndex((row) => row.category === 'filler' && row.id === '9');
    rows[fillerIndex] = { ...rows[fillerIndex], id: String(FAMILY_A_DEFS[0].id) };
    await expect(correctCorpus(buildCsv(rows), buildFakeEngine())).rejects.toThrow(new RegExp(`duplicate id.*${FAMILY_A_DEFS[0].id}`, 's'));
  });

  it('assertOutputPathIsSafe refuses an --out identical to --corpus unless overridden', () => {
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus-v4.csv', '/home/arm/nl-stress-corpus-v4.csv', false))
      .toThrow(/resolves to the same file/);
    expect(() => assertOutputPathIsSafe('/home/arm/nl-stress-corpus-v4.csv', '/home/arm/nl-stress-corpus-v4.csv', true))
      .not.toThrow();
  });
});
