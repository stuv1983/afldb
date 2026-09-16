#!/usr/bin/env tsx
/**
 * AFLDB-ISSUE-204 -- one-shot correction for 180 stale corpus expectations in
 * the external V3 12,000-row NL stress corpus (~/nl-stress-corpus-v3.csv).
 *
 *   npx tsx tools/nl/fix-issue-204-stale-coverage-expectations.ts \
 *     --corpus ~/nl-stress-corpus-v3.csv --out ~/nl-stress-corpus-v4.csv
 *
 * WHY THIS EXISTS
 *
 * AFLDB-ISSUE-200's `coverage_unavailable|fgf` auto-cluster (180 rows) asks
 * for disposals/marks/tackles in Finals/Grand Finals matches at seasons
 * 1897-1926 -- before `NL_COVERAGE`'s recording floor for every one of those
 * metrics (disposals/marks: 1965; tackles: 1987 -- src/search/nl/plan.ts,
 * `NL_COVERAGE`). Parser v53 already declines every one of these 180 rows
 * correctly with `coverage_unavailable`. The corpus's own expectation
 * (`expected_status=success`, full coverage) is the stale side, not the
 * parser -- confirmed independently by the operator's real-corpus audit
 * (AFLDB-ISSUE-204 handoff, 2026-09-16) and unchanged across three later
 * parser fixes (AFLDB-ISSUE-201/202/203). This script corrects only those
 * 180 rows to describe the valid decline, the same auditable, self-
 * verifying way AFLDB-ISSUE-199/201 corrected their own stale rows
 * (tools/nl/fix-issue-201-stale-boundary-expectations.ts is the pattern this
 * file follows) -- never by hand-editing the CSV in place.
 *
 * WHY CRITERIA-BASED TARGETING, NOT A HARDCODED ID LIST
 *
 * AFLDB-ISSUE-199/201 hardcoded an explicit id list/range because the
 * operator's audit named exact ids. This issue's operator evidence names
 * the family's exact composition (category, template, metric/match-type/
 * season distribution, and every stale field's exact old value) but not a
 * literal id list, and a later 3-sample fragment of ids the operator quoted
 * has no constant inter-season stride, so it cannot be extended to the full
 * 180 without guessing. Hardcoding a fabricated id range here would be
 * exactly the kind of guess this script's own fail-closed discipline
 * forbids. Instead, targets are *derived* from each row's own structural
 * signature: category (`finals_grand_final`), equivalence-group template
 * prefix (`fgf` -- the same signature `tools/nl/audit-issue-200-extract.ts`'s
 * `templatePrefix()` already uses to build the `coverage_unavailable|fgf`
 * cluster key), grain (`player_game`), mode (`single`), aggregation
 * (`max`), metric (disposals/marks/tackles), match type (final/
 * grand_final), and a single pinned season in [1897, 1926].
 *
 * THE FIRST RUN'S FAILURE, AND WHY CATEGORY+TEMPLATE ALONE WAS NOT ENOUGH
 *
 * An earlier version of this script derived candidates from category+
 * template alone (996 rows: 636 `team_match`-grain rows plus 180 more
 * `player_game` rows that are goals/top-5-listing questions, alongside the
 * true 180) and re-verified every candidate against the full audited old-
 * state, aborting on any mismatch. That correctly failed closed on the
 * first real operator run (row 8910, a `team_match` "biggest Grand Final
 * win" row, aborted the whole run rather than being silently included or
 * excluded) but for the wrong reason: category+template is only a broad
 * corpus template family, not this family's identifying signature.
 * Grain/mode/aggregation/metric-set/match-type-set/season-range are *also*
 * part of what distinguishes the 180-row family from its siblings in the
 * same `fgf` template (team-match margin questions, goals questions,
 * top-5-listing questions), so they now gate *candidacy* itself rather than
 * only post-candidacy drift detection. A row that matches the full
 * structural signature but disagrees with the audited old-state (status/
 * failure-reason/coverage-behavior/min-confidence/question-text) in any way
 * still aborts the whole run rather than being silently corrected or
 * skipped.
 *
 * FAIL-CLOSED, NOT PARTIAL
 *
 * Every invariant below aborts the whole run with a non-zero exit and
 * writes nothing: a wrong row count, a duplicate id, a candidate row whose
 * old expectation fields disagree with the audited pre-state in any way, a
 * candidate whose question text disagrees with its own metric/match-type/
 * season fields, a derived target count other than exactly 180, a
 * metric/match-type/season distribution other than the audited 60/60/60,
 * 90/90, 30-seasons-of-6, or (as a final self-check) any row outside the
 * derived 180 changing at all.
 *
 * See AFLDB-ISSUE-204.md and tools/nl/README.md for the full corpus schema
 * and the operator's before/after validation procedure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '@/lib/csv';

import { parseCsv, toExpectation } from './corpus';
import { flag, option } from './engine';

// --------------------------------------------------------------- constants

const EXPECTED_ROW_COUNT = 12000;
const EXPECTED_TARGET_COUNT = 180;

const REQUIRED_COLUMNS = [
  'id', 'category', 'equivalence_group', 'question', 'expected_status', 'verification_level',
  'expected_grain', 'expected_mode', 'expected_metric', 'expected_aggregation',
  'expected_season_from', 'expected_season_to', 'expected_match_type',
  'expected_failure_reason', 'expected_coverage_behavior', 'expected_min_confidence',
] as const;

/** The category the operator's audit confirms for every one of the 180 rows. */
const VERIFIED_CATEGORY = 'finals_grand_final';

/**
 * The stable half of the row's equivalence_group -- mirrors
 * audit-issue-200-extract.ts's own private templatePrefix() (same one-liner,
 * not exported there), which is how AFLDB-ISSUE-200 built the
 * `coverage_unavailable|fgf` cluster key this issue corrects.
 */
function templatePrefix(group: string): string {
  return group.split('|')[0] || '(none)';
}
const VERIFIED_TEMPLATE = 'fgf';

const VERIFIED_METRICS = ['disposals', 'marks', 'tackles'] as const;
type VerifiedMetric = (typeof VERIFIED_METRICS)[number];

/** Corpus's own vocabulary (tools/nl/corpus.ts's MATCH_TYPES: 'final' -> NlMatchType 'finals'), not the parser's. */
const VERIFIED_MATCH_TYPES = ['final', 'grand_final'] as const;
type VerifiedMatchType = (typeof VERIFIED_MATCH_TYPES)[number];

const VERIFIED_SEASON_MIN = 1897;
const VERIFIED_SEASON_MAX = 1926;
const VERIFIED_SEASON_COUNT = 30;
const VERIFIED_ROWS_PER_SEASON = 6;
const VERIFIED_ROWS_PER_METRIC = 60;
const VERIFIED_ROWS_PER_MATCH_TYPE = 90;

const VERIFIED_OLD_STATUS = 'success';
const VERIFIED_OLD_GRAIN = 'player_game';
const VERIFIED_OLD_MODE = 'single';
const VERIFIED_OLD_AGGREGATION = 'max';
const VERIFIED_OLD_MIN_CONFIDENCE = '0.80';
const VERIFIED_OLD_COVERAGE_BEHAVIOR = 'full';

// ----------------------------------------------------------------- helpers

/**
 * True for a row whose full structural signature matches this issue's
 * audited 180-row family: category + equivalence-group template alone are
 * a broad corpus template family (996 rows in the real corpus, per the
 * first operator run) shared with `team_match`-grain rows and other
 * `player_game` rows (goals questions, top-5-listing questions) that are
 * not part of this family. Grain/mode/aggregation/metric-set/match-type-set
 * /season-range are what actually distinguishes the 180-row family from
 * those siblings, so every one of them gates candidacy here -- not just the
 * old-state fields checked afterward in assertAuditedCoveragePreState.
 */
function isCandidateTarget(record: Record<string, string>): boolean {
  if (record.category !== VERIFIED_CATEGORY) return false;
  if (templatePrefix(record.equivalence_group ?? '') !== VERIFIED_TEMPLATE) return false;
  if (record.expected_grain !== VERIFIED_OLD_GRAIN) return false;
  if (record.expected_mode !== VERIFIED_OLD_MODE) return false;
  if (record.expected_aggregation !== VERIFIED_OLD_AGGREGATION) return false;
  if (!VERIFIED_METRICS.includes(record.expected_metric as VerifiedMetric)) return false;
  if (!VERIFIED_MATCH_TYPES.includes(record.expected_match_type as VerifiedMatchType)) return false;

  const seasonFrom = record.expected_season_from;
  const seasonTo = record.expected_season_to;
  if (!seasonFrom || seasonFrom !== seasonTo) return false;
  const season = Number(seasonFrom);
  if (!Number.isInteger(season) || season < VERIFIED_SEASON_MIN || season > VERIFIED_SEASON_MAX) return false;

  return true;
}

/**
 * Confirms a candidate row's own question text agrees with its structured
 * metric/match-type/season fields -- never asserted from the fields alone.
 * "final"/"finals" and "grand_final" both contain the substring "final", so
 * a grand-final row is required to say "grand final" and a plain-finals row
 * is required to say "final" or "finals" (the corpus's general-finals-scope
 * wording, e.g. "most disposals in finals in 1897" -- AFLDB-ISSUE-204
 * second operator-validation finding, 2026-09-16) without "grand final"
 * alongside it.
 */
export function assertQuestionMatchesRow(
  id: number,
  question: string,
  metric: VerifiedMetric,
  matchType: VerifiedMatchType,
  season: number,
): void {
  if (!new RegExp(`\\b${metric}\\b`, 'i').test(question)) {
    throw new Error(`Row ${id}: question does not name metric "${metric}". Refusing to guess. Question: "${question}"`);
  }
  if (matchType === 'grand_final') {
    if (!/grand final/i.test(question)) {
      throw new Error(`Row ${id}: expected_match_type="grand_final" but question does not say "grand final". Refusing to guess. Question: "${question}"`);
    }
  } else if (!/\bfinals?\b/i.test(question) || /grand final/i.test(question)) {
    throw new Error(`Row ${id}: expected_match_type="final" but question does not say "final"/"finals" without "grand final". Refusing to guess. Question: "${question}"`);
  }
  if (!new RegExp(`\\b${season}\\b`).test(question)) {
    throw new Error(`Row ${id}: question does not name season ${season}. Refusing to guess. Question: "${question}"`);
  }
}

export type VerifiedTarget = {
  id: number;
  metric: VerifiedMetric;
  matchType: VerifiedMatchType;
  season: number;
};

/**
 * Confirms one candidate row's old-expectation "state" fields -- the ones
 * this correction actually mutates or that could have drifted from a prior
 * partial run -- match this issue's audit exactly before it is accepted as
 * a target. The row's structural identity (category/template/grain/mode/
 * aggregation/metric/match-type/season) is already guaranteed by
 * isCandidateTarget() before this runs, so it is not re-checked here.
 * Reads only the row itself -- never a sibling row or an assumption -- and
 * fails closed on any mismatch rather than silently correcting or silently
 * skipping a row this issue's evidence does not cleanly cover.
 */
export function assertAuditedCoveragePreState(id: number, record: Record<string, string>): VerifiedTarget {
  if (record.expected_status !== VERIFIED_OLD_STATUS) {
    throw new Error(`Row ${id}: audited before-state expects expected_status="${VERIFIED_OLD_STATUS}", found "${record.expected_status}". Refusing to run.`);
  }
  if ((record.expected_failure_reason ?? '') !== '') {
    throw new Error(`Row ${id}: audited before-state expects expected_failure_reason="" (empty), found "${record.expected_failure_reason}". Refusing to run.`);
  }
  if (record.expected_coverage_behavior !== VERIFIED_OLD_COVERAGE_BEHAVIOR) {
    throw new Error(`Row ${id}: audited before-state expects expected_coverage_behavior="${VERIFIED_OLD_COVERAGE_BEHAVIOR}", found "${record.expected_coverage_behavior}". Refusing to run.`);
  }
  if (record.expected_min_confidence !== VERIFIED_OLD_MIN_CONFIDENCE) {
    throw new Error(`Row ${id}: audited before-state expects expected_min_confidence="${VERIFIED_OLD_MIN_CONFIDENCE}", found "${record.expected_min_confidence}". Refusing to run.`);
  }

  const metric = record.expected_metric as VerifiedMetric;
  const matchType = record.expected_match_type as VerifiedMatchType;
  const season = Number(record.expected_season_from);

  assertQuestionMatchesRow(id, (record.question ?? '').trim(), metric, matchType, season);

  return { id, metric, matchType, season };
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
 * otherwise. Exported for tests/nl-issue-204-corpus-fix.test.ts.
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

  // toExpectation()'s question-text invariant applies to every row, target
  // or not -- a trailing blank line arrives here as a real data row, and
  // this catches that before candidate derivation runs.
  originalRecords.forEach((record, index) => {
    if (!toExpectation(record)) throw new Error(`Row at data line ${index + 2} has no question text.`);
  });

  // ---- derive candidates from the audited cluster signature, then verify
  // every one of them against the full audited pre-state before accepting
  // any of them as a target. A row matching the signature but disagreeing
  // with the audited shape aborts the whole run rather than being silently
  // dropped from or folded into the target set.
  const targets: VerifiedTarget[] = [];
  originalRecords.forEach((record) => {
    if (!isCandidateTarget(record)) return;
    targets.push(assertAuditedCoveragePreState(Number(record.id), record));
  });

  if (targets.length !== EXPECTED_TARGET_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_TARGET_COUNT} rows matching the audited structural signature (category="${VERIFIED_CATEGORY}" template="${VERIFIED_TEMPLATE}" grain="${VERIFIED_OLD_GRAIN}" mode="${VERIFIED_OLD_MODE}" aggregation="${VERIFIED_OLD_AGGREGATION}" metric in ${VERIFIED_METRICS.join('/')} match_type in ${VERIFIED_MATCH_TYPES.join('/')} season ${VERIFIED_SEASON_MIN}-${VERIFIED_SEASON_MAX}), found ${targets.length}. Refusing to run.`);
  }

  // ---- distribution self-check: the audited 3x2x30 composition, not just the total
  for (const metric of VERIFIED_METRICS) {
    const count = targets.filter((t) => t.metric === metric).length;
    if (count !== VERIFIED_ROWS_PER_METRIC) {
      throw new Error(`Expected exactly ${VERIFIED_ROWS_PER_METRIC} target rows for metric "${metric}", found ${count}. Refusing to run.`);
    }
  }
  for (const matchType of VERIFIED_MATCH_TYPES) {
    const count = targets.filter((t) => t.matchType === matchType).length;
    if (count !== VERIFIED_ROWS_PER_MATCH_TYPE) {
      throw new Error(`Expected exactly ${VERIFIED_ROWS_PER_MATCH_TYPE} target rows for match type "${matchType}", found ${count}. Refusing to run.`);
    }
  }
  const seasons = new Set(targets.map((t) => t.season));
  if (seasons.size !== VERIFIED_SEASON_COUNT) {
    throw new Error(`Expected exactly ${VERIFIED_SEASON_COUNT} distinct seasons among target rows, found ${seasons.size}. Refusing to run.`);
  }
  for (const season of seasons) {
    const count = targets.filter((t) => t.season === season).length;
    if (count !== VERIFIED_ROWS_PER_SEASON) {
      throw new Error(`Expected exactly ${VERIFIED_ROWS_PER_SEASON} target rows for season ${season}, found ${count}. Refusing to run.`);
    }
  }

  const idToIndex = new Map<number, number>();
  ids.forEach((id, index) => idToIndex.set(id, index));
  const targetIdSet = new Set(targets.map((t) => t.id));

  const outputRecords = originalRecords.map((record) => ({ ...record }));

  for (const id of targetIdSet) {
    const record = outputRecords[idToIndex.get(id)!];

    // The repository's established expected-decline representation
    // (tests/nl-issue-199-corpus-fix.test.ts, tools/nl/fix-issue-201-stale-
    // boundary-expectations.ts): a corrected decline row is
    // verification_level=EXPECTED_DECLINE with its failure reason set.
    // expected_coverage_behavior ("full") and expected_min_confidence
    // (0.80) described a successful answer and no longer apply once the
    // row is a decline, so both are cleared rather than left contradicting
    // the new status. grain/mode/metric/aggregation/season/match-type are
    // preserved -- the plan still parses to exactly that shape, it is only
    // the season range this application has no coverage for.
    record.expected_status = 'decline';
    record.verification_level = 'EXPECTED_DECLINE';
    record.expected_failure_reason = 'coverage_unavailable';
    record.expected_coverage_behavior = '';
    record.expected_min_confidence = '';
  }

  // ---- post-hoc self-check: exactly the 180 targets changed, nothing else
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
// as tests/nl-issue-204-corpus-fix.test.ts does -- must not start a run.
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
