#!/usr/bin/env tsx
/**
 * AFLDB-ISSUE-199 -- one-shot correction for 173 stale hard-failure rows in
 * the external V1 12,000-row NL stress corpus (~/nl-stress-corpus.csv).
 *
 *   npx tsx tools/nl/fix-issue-199-stale-expectations.ts \
 *     --corpus ~/nl-stress-corpus.csv --out ~/nl-stress-corpus-v2.csv
 *
 * WHY THIS EXISTS
 *
 * The corpus has no in-repo generator (AFLDB-ISSUE-199.md S2-3): it is an
 * externally-authored CSV, hand-edited by nobody, read only by
 * tools/nl/corpus.ts. 173 rows were labelled expected_status=decline before
 * three features they now exercise successfully were shipped -- the true
 * 7-identity Ablett family (AFLDB-ISSUE-197), team-streak questions (parser
 * v16) and coach-record questions (parser v35). Hand-editing the CSV would
 * be an unaudited, unrepeatable change; this script is the auditable
 * replacement, run against a copy and never against the canonical file
 * in place.
 *
 * WHAT IT REFUSES TO GUESS
 *
 * Every value this script writes is either read directly out of the
 * corpus itself or taken from a source-code fact this repository can cite
 * (a plan.ts metric key, a grain name). Two examples:
 *
 *   - The Ablett per-row metric (goals/games/disposals/marks/tackles) is
 *     read from that row's OWN question text (a strict, single-word match
 *     against the five audited metric words), then cross-checked against
 *     an explicit audited id-to-metric map before being used. Operator
 *     validation on the real corpus (2026-09-16) disproved an earlier
 *     version of this script that read the metric from the corresponding
 *     Jones row instead -- Jones rows carry no machine-readable
 *     expected_metric at all, decline or otherwise. Jones is never read
 *     for this or any other purpose; it stays a genuine, untouched
 *     decline.
 *   - expected_mode, and whether a row should rank with 'max' or a
 *     question-stated 'top N', is confirmed against an already-passing
 *     "mirror" row elsewhere in the same corpus with the same grain
 *     (and, for coach rows, the same metric) -- never asserted from this
 *     script's own assumption. A group with no such mirror in the file
 *     fails closed rather than writing a shape nothing else in the corpus
 *     is known to support.
 *
 * FAIL-CLOSED, NOT PARTIAL
 *
 * Every invariant below aborts the whole run with a non-zero exit and
 * writes nothing: a wrong row count, a duplicate or missing id, a target
 * row not currently expected_status=decline, a target id colliding with
 * one of the seven surname groups the issue explicitly keeps untouched, an
 * Ablett question naming zero or more than one audited metric word, an
 * Ablett question's derived metric disagreeing with the audited id-to-
 * metric map, a missing mirror row, or (as a final self-check) any row
 * outside the 173 changing at all.
 *
 * See AFLDB-ISSUE-199.md and tools/nl/README.md for the full corpus
 * schema and the operator's before/after validation procedure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '@/lib/csv';

import { parseCsv, toExpectation, type StressExpectation } from './corpus';
import { flag, option } from './engine';

// --------------------------------------------------------------- constants

const EXPECTED_ROW_COUNT = 12000;
const EXPECTED_TARGET_COUNT = 173;

const REQUIRED_COLUMNS = [
  'id', 'question', 'expected_status', 'verification_level', 'expected_grain',
  'expected_club', 'expected_metric', 'expected_mode', 'expected_aggregation',
  'expected_limit', 'expected_failure_reason',
] as const;

type Grain = 'player_career' | 'team_streak' | 'coach_record';

type TargetRow = {
  group: string;
  grain: Grain;
  club?: string;
  /** coach_record only -- a literal plan.ts metric key (plan.ts:972-973), never aliased. */
  metric?: 'games' | 'wins';
};

function range(from: number, to: number): number[] {
  const ids: number[] = [];
  for (let id = from; id <= to; id++) ids.push(id);
  return ids;
}

const ABLETT_IDS = range(11601, 11605);

/**
 * The five metric words this issue's evidence audits, and exactly which
 * Ablett id each one belongs to (AFLDB-ISSUE-199.md S4a: "Ablett most
 * goals" / "Ablett most games" / ... one row per metric). A row's own
 * question text must name exactly one of these words, and it must be the
 * one this map says that id carries -- both read from the corpus at run
 * time, this map only confirms them, per the issue's own instruction not
 * to let an unexpected corpus text be silently overridden.
 */
const ABLETT_METRIC_WORDS = ['goals', 'games', 'disposals', 'marks', 'tackles'] as const;

const AUDITED_ABLETT_METRIC_BY_ID: Readonly<Record<number, (typeof ABLETT_METRIC_WORDS)[number]>> = {
  11601: 'goals',
  11602: 'games',
  11603: 'disposals',
  11604: 'marks',
  11605: 'tackles',
};

/**
 * Rows the issue explicitly requires to stay untouched (genuine declines).
 * Checked defensively against TARGETS below so a range typo cannot make
 * this script silently correct a row it was told to leave alone. Jones
 * (11626-11630) is never read by this script for any purpose -- it is
 * listed here only as a preserved id range, the same as the other six.
 */
const PRESERVED_DECLINE_RANGES: readonly (readonly [number, number])[] = [
  [11606, 11610], // Johnson
  [11611, 11615], // Brown
  [11616, 11620], // Smith
  [11621, 11625], // Williams
  [11626, 11630], // Jones
  [11636, 11640], // Wilson
  [11646, 11650], // Anderson
];

const TARGETS = new Map<number, TargetRow>();
for (const id of ABLETT_IDS) {
  TARGETS.set(id, { group: 'ablett', grain: 'player_career' });
}
for (const id of range(11651, 11678)) TARGETS.set(id, { group: 'adelaide_winning_streak', grain: 'team_streak', club: 'Adelaide' });
for (const id of range(11679, 11706)) TARGETS.set(id, { group: 'adelaide_losing_streak', grain: 'team_streak', club: 'Adelaide' });
for (const id of range(11931, 11958)) TARGETS.set(id, { group: 'brisbane_lions_winning_streak', grain: 'team_streak', club: 'Brisbane Lions' });
for (const id of range(11959, 11986)) TARGETS.set(id, { group: 'brisbane_lions_losing_streak', grain: 'team_streak', club: 'Brisbane Lions' });
for (const id of range(11763, 11790)) TARGETS.set(id, { group: 'adelaide_games_coached', grain: 'coach_record', club: 'Adelaide', metric: 'games' });
for (const id of range(11791, 11818)) TARGETS.set(id, { group: 'adelaide_wins_coached', grain: 'coach_record', club: 'Adelaide', metric: 'wins' });

// ----------------------------------------------------------------- helpers

/** A row's own question text is the only source for a ranked-list ask ("top 5 ..."); never guessed independently of it. */
export function detectAggregation(question: string): { aggregation: 'max' | 'top_n'; topN?: number } {
  const match = question.match(/\btop\s+(\d+)\b/i);
  return match ? { aggregation: 'top_n', topN: Number(match[1]) } : { aggregation: 'max' };
}

/**
 * The Ablett row's own question text is the only source for its metric --
 * never a sibling row, never this file's own audited map by itself. The
 * map (AUDITED_ABLETT_METRIC_BY_ID) only verifies what the question said;
 * an unexpected word, more than one word, or a word that disagrees with
 * the audited id all fail closed rather than pick a side.
 */
export function deriveAblettMetric(id: number, question: string): (typeof ABLETT_METRIC_WORDS)[number] {
  const found = ABLETT_METRIC_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(question));
  if (found.length !== 1) {
    throw new Error(
      `Ablett row ${id}: question must name exactly one of goals/games/disposals/marks/tackles, found `
      + `[${found.join(', ') || 'none'}] in "${question}". Refusing to guess.`,
    );
  }
  const derived = found[0];
  const audited = AUDITED_ABLETT_METRIC_BY_ID[id];
  if (!audited) throw new Error(`Internal error: id ${id} has no audited Ablett metric mapping.`);
  if (derived !== audited) {
    throw new Error(
      `Ablett row ${id}: question names metric "${derived}", but the audited id-to-metric map expects `
      + `"${audited}" for this id. Refusing to guess.`,
    );
  }
  return derived;
}

export type CorrectionSummary = {
  inputRows: number;
  outputRows: number;
  targetRowsExpected: number;
  targetRowsModified: number;
  nonTargetRowsModified: number;
  ablettModifications: number;
  streakModifications: number;
  coachModifications: number;
};

/**
 * Pure, DB-free correction. Throws (never partially applies) on any
 * invariant failure; returns the rewritten CSV text and a summary
 * otherwise. Exported for tests/nl-issue-199-corpus-fix.test.ts.
 */
export function correctCorpus(inputCsvText: string): { outputCsvText: string; summary: CorrectionSummary } {
  if (TARGETS.size !== EXPECTED_TARGET_COUNT) {
    throw new Error(`Internal error: TARGETS has ${TARGETS.size} ids, expected ${EXPECTED_TARGET_COUNT}.`);
  }
  for (const [from, to] of PRESERVED_DECLINE_RANGES) {
    for (let id = from; id <= to; id++) {
      if (TARGETS.has(id)) throw new Error(`Internal error: id ${id} is both a correction target and a preserved-decline id.`);
    }
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

  const missing = [...TARGETS.keys()].filter((id) => !idToIndex.has(id));
  if (missing.length > 0) throw new Error(`Corpus is missing expected target row id(s): ${missing.join(', ')}.`);

  const expectations: StressExpectation[] = originalRecords.map((record, index) => {
    const expectation = toExpectation(record);
    if (!expectation) throw new Error(`Row at data line ${index + 2} has no question text.`);
    return expectation;
  });

  // ---- audited before-state: every target row is currently a decline row
  for (const id of TARGETS.keys()) {
    const actualStatus = originalRecords[idToIndex.get(id)!].expected_status;
    if (actualStatus !== 'decline') {
      throw new Error(`Row ${id}: audited before-state expects expected_status="decline", found "${actualStatus}". Refusing to run.`);
    }
  }

  const outputRecords = originalRecords.map((record) => ({ ...record }));
  const targetIdSet = new Set(TARGETS.keys());

  /** First already-passing row (never a target) matching predicate, or undefined. */
  const findMirror = (predicate: (exp: StressExpectation) => boolean): number | undefined => {
    for (let index = 0; index < expectations.length; index++) {
      const exp = expectations[index];
      if (targetIdSet.has(exp.id) || exp.status !== 'success') continue;
      if (predicate(exp)) return index;
    }
    return undefined;
  };

  let ablettModifications = 0;
  let streakModifications = 0;
  let coachModifications = 0;

  for (const [id, target] of TARGETS) {
    const index = idToIndex.get(id)!;
    const record = outputRecords[index];
    const question = originalRecords[index].question;

    let metricRaw = '';
    let mirrorIndex: number | undefined;
    let aggregation: 'max' | 'top_n' = 'max';
    let topN: number | undefined;

    if (target.grain === 'player_career') {
      const derivedMetric = deriveAblettMetric(id, question);
      metricRaw = derivedMetric;
      mirrorIndex = findMirror((exp) => exp.grain === 'player_career' && exp.metric === derivedMetric && exp.aggregation === 'max');
      if (mirrorIndex === undefined) {
        throw new Error(`Ablett row ${id}: no already-passing player_career/max/${derivedMetric} row exists to confirm this shape. Refusing to guess.`);
      }
    } else if (target.grain === 'team_streak') {
      ({ aggregation, topN } = detectAggregation(question));
      mirrorIndex = findMirror((exp) => exp.grain === 'team_streak' && exp.metric === undefined
        && exp.aggregation === aggregation && (aggregation !== 'top_n' || exp.topN === topN));
      if (mirrorIndex === undefined) {
        throw new Error(`Streak row ${id} (${target.group}): no already-passing team_streak/${aggregation} row exists to confirm this shape. Refusing to guess.`);
      }
    } else {
      ({ aggregation, topN } = detectAggregation(question));
      metricRaw = target.metric!;
      mirrorIndex = findMirror((exp) => exp.grain === 'coach_record' && exp.metric === target.metric
        && exp.aggregation === aggregation && (aggregation !== 'top_n' || exp.topN === topN));
      if (mirrorIndex === undefined) {
        throw new Error(`Coach row ${id} (${target.group}): no already-passing coach_record/${target.metric}/${aggregation} row exists to confirm this shape. Refusing to guess.`);
      }
    }
    if (mirrorIndex === undefined) throw new Error(`Internal error: row ${id} has no resolved mirror index.`);

    record.expected_status = 'success';
    record.verification_level = 'SEMANTIC';
    record.expected_grain = target.grain;
    record.expected_mode = originalRecords[mirrorIndex].expected_mode ?? '';
    record.expected_aggregation = aggregation;
    record.expected_limit = aggregation === 'top_n' ? String(topN) : '';
    record.expected_metric = target.grain === 'team_streak' ? '' : metricRaw;
    record.expected_club = target.club ?? '';
    record.expected_failure_reason = '';

    if (target.grain === 'player_career') ablettModifications++;
    else if (target.grain === 'team_streak') streakModifications++;
    else coachModifications++;
  }

  // ---- post-hoc self-check: exactly the 173 targets changed, nothing else
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
      ablettModifications,
      streakModifications,
      coachModifications,
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
    `Ablett modifications:      ${summary.ablettModifications}`,
    `streak modifications:      ${summary.streakModifications}`,
    `coach modifications:       ${summary.coachModifications}`,
    `output path:               ${resolve(outPath)}`,
  ].join('\n')}\n`);
}

// Run only when this file is the entry point. Importing correctCorpus() --
// as tests/nl-issue-199-corpus-fix.test.ts does -- must not start a run.
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
