#!/usr/bin/env tsx
/**
 * Fable NL code review, final acceptance pass (2026-09-17) -- one-shot
 * correction for 3 stale verified-answer expectations in the external V1
 * ("V5") 12,000-row NL stress corpus (~/nl-stress-corpus-v5.csv).
 *
 *   npx tsx tools/nl/fix-stale-finals-without-premiership-tie.ts \
 *     --corpus ~/nl-stress-corpus-v5.csv --out ~/nl-stress-corpus-v6.csv
 *
 * WHY THIS EXISTS
 *
 * The three `verified_finals_without_premiership` equivalence-group rows
 * ("most finals without a premiership" and two paraphrases) carry a
 * hand-verified answer: Nick Dal Santo, 24 finals, tie count 1. That was
 * true when the corpus was authored. Dane Rampe has since played his 24th
 * finals-series match (Sydney, 2026-09-05, loaded into the canonical data
 * on the 2026 current-season path) without ever winning a premiership, so
 * the true answer under AFLDB's own model is now a two-way tie at 24.
 *
 * This was proven from current canonical data, not inferred from the
 * failing run: the stored `player_career_stats` aggregates (finals 24 /
 * premierships 0 for both players), an independent recount from
 * `player_match_stats` JOIN `matches` under the exact rule
 * tools/migration/rebuild_derived.py uses (`is_finals_series` for finals,
 * `round_type = 'grand_final' AND won` for premierships), and the
 * production ranking shape itself (`premierships = 0 ORDER BY finals DESC,
 * display_name`) all agree: Dane Rampe 24, Nick Dal Santo 24, then Len
 * Thompson / Ray Byrne / Rene Kink at 22. Nobody else ties at 24. A
 * parser-v65-vs-v66 control on the same database produced the identical
 * three failures, so no parser change is involved. The corpus's
 * expectation is the stale side; the application's answer is correct.
 *
 * WHAT IS CORRECTED, AND WHAT IS DELIBERATELY NOT
 *
 * Exactly two expectation columns on exactly those three rows:
 *
 *   expected_answer_primary  "Nick Dal Santo"  ->  "Dane Rampe|Nick Dal Santo"
 *   expected_tie_count       1                 ->  2
 *
 * The `|` list is the corpus's own representation of "any of these is a
 * correct lead" (tools/nl/corpus.ts, answerPrimary), listed in the
 * deterministic order the production query and harness actually emit for
 * a tie (value DESC, then display name -- src/db/queries/nl/player-career.ts
 * answerRanked). Both tied players are named so the oracle still asserts
 * WHO holds the record, and the tie count 2 still asserts that exactly two
 * players share it -- the oracle is not weakened to "anyone at 24".
 * expected_answer_value stays 24 and is asserted unchanged. Question text,
 * grain, status, verification level and every other column are untouched.
 *
 * KNOWN VOLATILITY (recorded, not hidden)
 *
 * Dane Rampe is an active player and the 2026 finals series was in
 * progress when this was audited (latest loaded match 2026-09-13). If he
 * plays another final, the true answer becomes "Dane Rampe, 25, tie 1"
 * and these rows go stale again for the same honest reason. A verified
 * answer about a live record is inherently time-bound; the corpus's
 * hand-verified rows have always carried that property.
 *
 * FAIL-CLOSED, NOT PARTIAL
 *
 * Targets are selected by equivalence group, not by hard-coded id, and
 * every invariant below aborts the run with a non-zero exit and writes
 * nothing: a wrong row count, a duplicate or non-integer id, a group that
 * does not contain exactly the three audited questions once each, a
 * target row that is not `expected_status=success`, a target row whose
 * verified answer is not exactly the audited before-state (Nick Dal Santo
 * / 24 / tie 1), or -- as a final self-check -- any row outside the three
 * targets changing at all. The question-text identity check is
 * case-insensitive and ignores surrounding whitespace and a trailing "?";
 * it is an identity guard on which rows are touched, never a value that is
 * written.
 *
 * Same auditable pattern as tools/nl/fix-issue-199-stale-expectations.ts
 * and tools/nl/fix-issue-201-stale-boundary-expectations.ts -- never a
 * hand edit of the CSV in place.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '@/lib/csv';

import { parseCsv, toExpectation } from './corpus';
import { flag, option } from './engine';

// --------------------------------------------------------------- constants

export const EXPECTED_ROW_COUNT = 12000;
export const EXPECTED_TARGET_COUNT = 3;
export const TARGET_EQUIVALENCE_GROUP = 'verified_finals_without_premiership';

const REQUIRED_COLUMNS = [
  'id', 'question', 'equivalence_group', 'expected_status',
  'expected_answer_primary', 'expected_answer_value', 'expected_tie_count',
] as const;

/** The audited before-state every target row must carry, verbatim. */
export const AUDITED_BEFORE = {
  answerPrimary: ['Nick Dal Santo'],
  answerValue: 24,
  tieCount: 1,
} as const;

/** The corrected after-state, proven from current canonical data (see header). */
export const CORRECTED_AFTER = {
  answerPrimary: 'Dane Rampe|Nick Dal Santo',
  tieCount: '2',
} as const;

/**
 * The three audited question texts (the exact equivalence group the final
 * V5 rerun reported failing). Compared through normaliseQuestion() below.
 */
export const AUDITED_QUESTIONS: readonly string[] = [
  'most finals without a premiership',
  'most career finals without a premiership',
  'who played the most finals without a premiership',
];

// ----------------------------------------------------------------- helpers

/** Identity comparison only: case, surrounding whitespace and a trailing "?" are not significant. */
export function normaliseQuestion(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/\?+$/, '').trim().toLowerCase();
}

/**
 * Confirms one target row's verified-answer pre-state matches the audit
 * exactly before anything is rewritten. Reads only the row itself and
 * fails closed on any mismatch.
 */
export function assertAuditedTiePreState(record: Record<string, string>): void {
  const id = record.id ?? '?';
  if (record.expected_status !== 'success') {
    throw new Error(`Row ${id}: audited before-state expects expected_status="success", found "${record.expected_status}". Refusing to run.`);
  }
  const expectation = toExpectation(record);
  if (!expectation) throw new Error(`Row ${id}: row has no question text.`);

  const primary = expectation.answerPrimary ?? [];
  if (primary.length !== AUDITED_BEFORE.answerPrimary.length
      || primary.some((name, index) => name !== AUDITED_BEFORE.answerPrimary[index])) {
    throw new Error(
      `Row ${id}: audited before-state expects expected_answer_primary="${AUDITED_BEFORE.answerPrimary.join('|')}", `
      + `found "${record.expected_answer_primary ?? ''}". Refusing to run.`,
    );
  }
  if (expectation.answerValue !== AUDITED_BEFORE.answerValue) {
    throw new Error(`Row ${id}: audited before-state expects expected_answer_value=${AUDITED_BEFORE.answerValue}, found "${record.expected_answer_value ?? ''}". Refusing to run.`);
  }
  if (expectation.tieCount !== AUDITED_BEFORE.tieCount) {
    throw new Error(`Row ${id}: audited before-state expects expected_tie_count=${AUDITED_BEFORE.tieCount}, found "${record.expected_tie_count ?? ''}". Refusing to run.`);
  }
}

export type CorrectionSummary = {
  inputRows: number;
  outputRows: number;
  targetRowsExpected: number;
  targetRowsModified: number;
  nonTargetRowsModified: number;
  targetIds: number[];
};

/**
 * Pure, DB-free correction. Throws (never partially applies) on any
 * invariant failure; returns the rewritten CSV text and a summary
 * otherwise. Exported for tests/nl-finals-without-premiership-corpus-fix.test.ts.
 */
export function correctCorpus(inputCsvText: string): { outputCsvText: string; summary: CorrectionSummary } {
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

  originalRecords.forEach((record, index) => {
    if (!toExpectation(record)) throw new Error(`Row at data line ${index + 2} has no question text.`);
  });

  // ---- target selection: the equivalence group, and nothing outside it
  const targetIndexes = originalRecords
    .map((record, index) => ((record.equivalence_group ?? '').trim() === TARGET_EQUIVALENCE_GROUP ? index : -1))
    .filter((index) => index >= 0);
  if (targetIndexes.length !== EXPECTED_TARGET_COUNT) {
    throw new Error(
      `Expected exactly ${EXPECTED_TARGET_COUNT} rows in equivalence group "${TARGET_EQUIVALENCE_GROUP}", `
      + `found ${targetIndexes.length}. Refusing to run.`,
    );
  }

  // ---- audited question identity: each audited question exactly once
  const wanted = new Map(AUDITED_QUESTIONS.map((q) => [normaliseQuestion(q), 0]));
  for (const index of targetIndexes) {
    const key = normaliseQuestion(originalRecords[index].question ?? '');
    if (!wanted.has(key)) {
      throw new Error(
        `Row ${originalRecords[index].id}: question text is not one of this correction's audited questions. `
        + `Refusing to guess. Found: "${originalRecords[index].question ?? ''}".`,
      );
    }
    wanted.set(key, wanted.get(key)! + 1);
  }
  const unmatched = [...wanted.entries()].filter(([, count]) => count !== 1).map(([q]) => q);
  if (unmatched.length > 0) {
    throw new Error(`Audited question(s) not present exactly once in the group: ${unmatched.map((q) => `"${q}"`).join(', ')}. Refusing to run.`);
  }

  // ---- audited before-state: every target row matches the audit
  for (const index of targetIndexes) assertAuditedTiePreState(originalRecords[index]);

  const outputRecords = originalRecords.map((record) => ({ ...record }));
  const targetIdSet = new Set(targetIndexes.map((index) => ids[index]));

  for (const index of targetIndexes) {
    const record = outputRecords[index];
    record.expected_answer_primary = CORRECTED_AFTER.answerPrimary;
    record.expected_tie_count = CORRECTED_AFTER.tieCount;
  }

  // ---- post-hoc self-check: exactly the targets changed, nothing else,
  //      and the preserved verified value really was preserved
  const changedIds: number[] = [];
  for (let index = 0; index < originalRecords.length; index++) {
    const before = originalRecords[index];
    const after = outputRecords[index];
    if (header.some((name) => before[name] !== after[name])) changedIds.push(ids[index]);
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
  for (const index of targetIndexes) {
    const after = toExpectation(outputRecords[index]);
    if (!after || after.answerValue !== AUDITED_BEFORE.answerValue) {
      throw new Error(`Internal error: row ${ids[index]} lost its expected_answer_value=${AUDITED_BEFORE.answerValue}.`);
    }
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
      targetIds: [...targetIdSet].sort((a, b) => a - b),
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
    `target ids:                ${summary.targetIds.join(', ')}`,
    `output path:               ${resolve(outPath)}`,
  ].join('\n')}\n`);
}

// Run only when this file is the entry point. Importing correctCorpus() --
// as the unit test does -- must not start a run.
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
