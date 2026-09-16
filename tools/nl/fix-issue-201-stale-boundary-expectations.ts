#!/usr/bin/env tsx
/**
 * AFLDB-ISSUE-201 -- one-shot correction for 2 stale corpus expectations in
 * the external V1 12,000-row NL stress corpus (~/nl-stress-corpus-v2.csv).
 *
 *   npx tsx tools/nl/fix-issue-201-stale-boundary-expectations.ts \
 *     --corpus ~/nl-stress-corpus-v2.csv --out ~/nl-stress-corpus-v3.csv
 *
 * WHY THIS EXISTS
 *
 * AFLDB-ISSUE-200's human disposition pass labelled 598 rows sharing the
 * `coverage_unavailable|boundary` auto-cluster key as PLANNER_VALIDATOR_BUG
 * -- a `player_career` boundary (debut/last-game at a Grand Final or final)
 * pinned to the boundary's own season, wrongly rejected by the generic
 * career season-range validator. AFLDB-ISSUE-201 fixed that validator/
 * compiler defect (parser v51) and re-checked all 598 ids against the
 * corrected output: 596 cleared, and exactly 2 (id 9907, id 10294) are
 * still soft after the fix -- both asking about a Grand-Final debut
 * "before 1897", which resolves to seasonMax = 1896, a season before the
 * first VFL season the application supports at all. Parser v51 correctly
 * declines these two with `coverage_unavailable` ("Season is out of
 * range."); the corpus's own expectation (`expected_status=success`) is
 * the stale side, not the parser. This script corrects only those two
 * rows, the same auditable, self-verifying way AFLDB-ISSUE-199 corrected
 * its own stale rows (tools/nl/fix-issue-199-stale-expectations.ts is the
 * pattern this file follows) -- never by hand-editing the CSV in place.
 *
 * WHAT IT REFUSES TO GUESS
 *
 * Every value this script writes is either read directly out of the
 * corpus row it is correcting, or is the fixed `coverage_unavailable`
 * decline shape this repository already uses for every other corrected
 * decline row (verification_level=EXPECTED_DECLINE -- see
 * tests/nl-issue-199-corpus-fix.test.ts's Ablett/Jones/streak/coach
 * fixtures for the established convention). It does not invent a new
 * `expected_coverage_behavior`/`expected_min_confidence` value for the
 * corrected rows: both described a successful answer's confidence/
 * coverage and stop applying once the row is a decline, so both are
 * cleared rather than guessed at.
 *
 * FAIL-CLOSED, NOT PARTIAL
 *
 * Every invariant below aborts the whole run with a non-zero exit and
 * writes nothing: a wrong row count, a duplicate or missing id, a target
 * row whose question text does not match this issue's audited text
 * exactly, a target row not currently `expected_status=success`, or a
 * target row whose translated `seasonTo`/`boundaryEvent`/`matchType` does
 * not match the audited pre-state (seasonTo=1896, boundaryEvent=debut,
 * matchType=grand_final) -- or, as a final self-check, any row outside
 * the 2 targets changing at all.
 *
 * See AFLDB-ISSUE-201.md and tools/nl/README.md for the full corpus
 * schema and the operator's before/after validation procedure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '@/lib/csv';

import { parseCsv, toExpectation } from './corpus';
import { flag, option } from './engine';

// --------------------------------------------------------------- constants

const EXPECTED_ROW_COUNT = 12000;
const EXPECTED_TARGET_COUNT = 2;

const REQUIRED_COLUMNS = [
  'id', 'question', 'expected_status', 'verification_level', 'expected_season_to',
  'expected_match_type', 'expected_boundary', 'expected_failure_reason',
  'expected_coverage_behavior', 'expected_min_confidence',
] as const;

/**
 * The 2 audited target rows (AFLDB-ISSUE-201, cross-referencing AFLDB-
 * ISSUE-200's 598 `PLANNER_VALIDATOR_BUG` ids against the parser-v51
 * rerun): both a Grand-Final-debut boundary question asking "before
 * 1897", both still soft after the validator/compiler fix, for the same
 * reason -- 1897 is the first supported season, so "before 1897" resolves
 * to a season this application has no coverage for at all. The question
 * text is asserted verbatim below; this map only names the ids.
 */
const TARGET_QUESTIONS: ReadonlyMap<number, string> = new Map([
  [9907, 'players whose first game was a Grand Final before 1897'],
  [10294, 'players whose debut was a Grand Final before 1897'],
]);

// ----------------------------------------------------------------- helpers

/**
 * Confirms a target row's translated pre-state matches the issue's audit
 * exactly (status=success, seasonTo=1896, boundaryEvent=debut,
 * matchType=grand_final) before anything is rewritten. Reads only the row
 * itself -- never a sibling row or an assumption -- and fails closed on
 * any mismatch rather than silently correcting a row this issue's evidence
 * does not cover.
 */
export function assertAuditedBoundaryPreState(id: number, record: Record<string, string>): void {
  const expectedQuestion = TARGET_QUESTIONS.get(id);
  if (!expectedQuestion) throw new Error(`Internal error: id ${id} has no audited question text.`);

  const actualQuestion = (record.question ?? '').trim();
  if (actualQuestion !== expectedQuestion) {
    throw new Error(
      `Row ${id}: question text does not match this issue's audited text. Refusing to guess. `
      + `Expected: "${expectedQuestion}". Found: "${actualQuestion}".`,
    );
  }

  if (record.expected_status !== 'success') {
    throw new Error(`Row ${id}: audited before-state expects expected_status="success", found "${record.expected_status}". Refusing to run.`);
  }

  const expectation = toExpectation(record);
  if (!expectation) throw new Error(`Row ${id}: row has no question text (unexpected -- checked above).`);
  if (expectation.seasonTo !== 1896) {
    throw new Error(`Row ${id}: audited before-state expects seasonTo=1896, found ${expectation.seasonTo}. Refusing to run.`);
  }
  if (expectation.boundaryEvent !== 'debut') {
    throw new Error(`Row ${id}: audited before-state expects boundaryEvent="debut", found "${expectation.boundaryEvent}". Refusing to run.`);
  }
  if (expectation.matchType !== 'grand_final') {
    throw new Error(`Row ${id}: audited before-state expects matchType="grand_final", found "${expectation.matchType}". Refusing to run.`);
  }
}

export type CorrectionSummary = {
  inputRows: number;
  outputRows: number;
  targetRowsExpected: number;
  targetRowsModified: number;
  nonTargetRowsModified: number;
};

/**
 * Pure, DB-free correction. Throws (never partially applies) on any
 * invariant failure; returns the rewritten CSV text and a summary
 * otherwise. Exported for tests/nl-issue-201-corpus-fix.test.ts.
 */
export function correctCorpus(inputCsvText: string): { outputCsvText: string; summary: CorrectionSummary } {
  if (TARGET_QUESTIONS.size !== EXPECTED_TARGET_COUNT) {
    throw new Error(`Internal error: TARGET_QUESTIONS has ${TARGET_QUESTIONS.size} ids, expected ${EXPECTED_TARGET_COUNT}.`);
  }

  const rows = parseCsv(inputCsvText);
  if (rows.length === 0) throw new Error('Corpus file is empty.');
  const header = rows[0];
  const dataRows = rows.slice(1);

  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) throw new Error(`Corpus header is missing required column "${column}".`);
  }
  if (dataRows.length !== EXPECTED_ROW_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_ROW_COUNT} data rows, found ${dataRows.length}. Refusing to run.`);
  }

  const originalRecords: Record<string, string>[] = dataRows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => { record[name] = row[index] ?? ''; });
    return record;
  });

  const ids = originalRecords.map((record) => Number(record.id));
  if (ids.some((id) => !Number.isInteger(id))) {
    throw new Error('Corpus contains a row whose id is not an integer.');
  }
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id); else seen.add(id);
  }
  if (duplicates.size > 0) throw new Error(`Corpus contains duplicate id(s): ${[...duplicates].join(', ')}.`);

  const idToIndex = new Map<number, number>();
  ids.forEach((id, index) => idToIndex.set(id, index));

  const missing = [...TARGET_QUESTIONS.keys()].filter((id) => !idToIndex.has(id));
  if (missing.length > 0) throw new Error(`Corpus is missing expected target row id(s): ${missing.join(', ')}.`);

  // toExpectation()'s question-text invariant applies to every row, target
  // or not -- a trailing blank line arrives here as a real data row, and
  // this catches that before the audited pre-state checks run.
  originalRecords.forEach((record, index) => {
    if (!toExpectation(record)) throw new Error(`Row at data line ${index + 2} has no question text.`);
  });

  // ---- audited before-state: every target row matches this issue's audit
  for (const id of TARGET_QUESTIONS.keys()) {
    assertAuditedBoundaryPreState(id, originalRecords[idToIndex.get(id)!]);
  }

  const outputRecords = originalRecords.map((record) => ({ ...record }));
  const targetIdSet = new Set(TARGET_QUESTIONS.keys());

  for (const id of TARGET_QUESTIONS.keys()) {
    const record = outputRecords[idToIndex.get(id)!];

    // The repository's established expected-decline representation
    // (tests/nl-issue-199-corpus-fix.test.ts): a corrected decline row is
    // verification_level=EXPECTED_DECLINE with its failure reason set.
    // expected_coverage_behavior ("full") and expected_min_confidence
    // (0.78) described a successful answer and no longer apply once the
    // row is a decline, so both are cleared rather than left contradicting
    // the new status. grain/season/match-type/boundary are preserved --
    // the plan still parses to exactly that shape, it is only the season
    // range that this application has no coverage for.
    record.expected_status = 'decline';
    record.verification_level = 'EXPECTED_DECLINE';
    record.expected_failure_reason = 'coverage_unavailable';
    record.expected_coverage_behavior = '';
    record.expected_min_confidence = '';
  }

  // ---- post-hoc self-check: exactly the 2 targets changed, nothing else
  const changedIds: number[] = [];
  for (let index = 0; index < originalRecords.length; index++) {
    const before = originalRecords[index];
    const after = outputRecords[index];
    if (header.some((name) => before[name] !== after[name])) changedIds.push(Number(before.id));
  }
  const changedIdSet = new Set(changedIds);
  const unexpectedlyChanged = changedIds.filter((id) => !targetIdSet.has(id));
  if (unexpectedlyChanged.length > 0) {
    throw new Error(`Internal error: non-target row(s) changed: ${unexpectedlyChanged.join(', ')}.`);
  }
  const unchangedTargets = [...targetIdSet].filter((id) => !changedIdSet.has(id));
  if (changedIds.length !== EXPECTED_TARGET_COUNT || unchangedTargets.length > 0) {
    throw new Error(
      `Internal error: expected exactly ${EXPECTED_TARGET_COUNT} rows changed, found ${changedIds.length}`
      + (unchangedTargets.length ? ` (unchanged targets: ${unchangedTargets.join(', ')})` : '') + '.',
    );
  }

  const outputCsvText = toCsv(header, outputRecords);

  return {
    outputCsvText,
    summary: {
      inputRows: dataRows.length,
      outputRows: outputRecords.length,
      targetRowsExpected: EXPECTED_TARGET_COUNT,
      targetRowsModified: changedIds.length,
      nonTargetRowsModified: unexpectedlyChanged.length,
    },
  };
}

// ---------------------------------------------------------------------- CLI

/** Refuses an --out that would silently overwrite --corpus unless deliberately allowed. */
export function assertOutputPathIsSafe(corpusPath: string, outPath: string, allowOverwriteInput: boolean): void {
  if (resolve(corpusPath) === resolve(outPath) && !allowOverwriteInput) {
    throw new Error('--out resolves to the same file as --corpus. Pass --allow-overwrite-input to deliberately overwrite the input.');
  }
}

function main(): void {
  const corpusPath = option('corpus');
  const outPath = option('out');
  if (!corpusPath) throw new Error('--corpus <path> is required.');
  if (!outPath) throw new Error('--out <path> is required.');
  assertOutputPathIsSafe(corpusPath, outPath, flag('allow-overwrite-input'));

  const inputCsvText = readFileSync(corpusPath, 'utf8');
  const { outputCsvText, summary } = correctCorpus(inputCsvText);
  writeFileSync(outPath, outputCsvText, 'utf8');

  process.stdout.write(`${[
    `input rows:               ${summary.inputRows}`,
    `output rows:               ${summary.outputRows}`,
    `target rows expected:      ${summary.targetRowsExpected}`,
    `target rows modified:      ${summary.targetRowsModified}`,
    `non-target rows modified:  ${summary.nonTargetRowsModified}`,
    `output path:               ${resolve(outPath)}`,
  ].join('\n')}\n`);
}

// Run only when this file is the entry point. Importing correctCorpus() --
// as tests/nl-issue-201-corpus-fix.test.ts does -- must not start a run.
const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
