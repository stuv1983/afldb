#!/usr/bin/env tsx
/**
 * AFLDB-ISSUE-205 -- one-shot correction for the 70 stale WRONG_FAILURE_REASON
 * corpus expectations in the external V4 12,000-row NL stress corpus
 * (~/nl-stress-corpus-v4.csv), producing V5.
 *
 *   npx tsx --conditions=react-server \
 *     tools/nl/fix-issue-205-comeback-taxonomy.ts \
 *     --corpus ~/nl-stress-corpus-v4.csv --out ~/nl-stress-corpus-v5.csv
 *
 * Requires DATABASE_URL to point at a real _dev or _test database carrying
 * the same club/venue directory the parser resolves against (loadEngine,
 * the same shared engine tools/nl/stress-test.ts and tools/nl/v2-runner.ts
 * use) -- pass --allow-any-database to run against anything else.
 * --conditions=react-server is required for the exact reason
 * tools/nl/engine.ts's loadEngine() documents: without it, Node resolves
 * the query modules' `server-only` guard to the copy that throws.
 *
 * WHY THIS EXISTS
 *
 * AFLDB-ISSUE-200 classified all 70 WRONG_FAILURE_REASON rows as one
 * benign diagnostic-label mismatch (TAXONOMY_DRIFT). AFLDB-ISSUE-205's
 * audit disproved that: the 70 rows are two unrelated families with two
 * different root causes, established against the real parser-v53/V4
 * evidence (failures.csv) and confirmed by source tracing --
 * AFLDB-ISSUE-205.md has the full record.
 *
 * TWO DIFFERENT CORRECTIONS FOR TWO DIFFERENT ROOT CAUSES
 *
 * Family A (42 rows -- "biggest three quarter time comeback" and its
 * "since 2000"/trailing-club-phrasing variants): a genuine parser-ordering
 * defect, fixed in the same change as this script (PARSER_VERSION 53->54,
 * src/search/nl/parser.ts's extractScoreCheckpoint). The already-
 * implemented team_match metric q3_deficit_overcome (team-match.ts) was
 * unreachable because an earlier extraction stage consumed "three quarter
 * time" before extractTeamMetric ever saw it. These rows flip from a
 * stale decline to a real plan expectation.
 *
 * Rather than hand-author club/season/aggregation for each of the 42 rows
 * -- this script has real evidence for only the 3 rows AFLDB-ISSUE-205's
 * audit quoted, and inventing the rest would violate the issue's explicit
 * "do not guess values" constraint -- every Family A candidate is
 * re-parsed through the real, now-fixed parser (loadEngine's
 * parseNlQuestion, against a real DB-backed club/venue directory) and the
 * corrected expectation is read directly off that row's own real plan.
 * This is a plan-SHAPE fact (grain/metric/club/season), never a query
 * RESULT value (leadName/leadValue/tieCount/resultCount) -- tools/nl/
 * corpus.ts's scoreRow only checks the latter when actual.executed is
 * true, which a verification_level=SEMANTIC row (what every corrected
 * Family A row becomes) never triggers on its own. AFLDB-ISSUE-205.md
 * records this scorer-contract finding in full. Every Family A row is
 * *required* to actually re-parse to grain=team_match/
 * metric=q3_deficit_overcome/agg.kind=max after the fix, with no player,
 * mode, opponent, venue, match type or checkpoint the audit did not
 * evidence -- any row that does not is left uncorrected and aborts the
 * whole run. That is a stronger guarantee than a hand-authored value
 * could offer: it is proven against the real fixed code path for all 42
 * rows, not assumed from the 3 sampled ones.
 *
 * Family B (28 rows -- "largest comeback from quarter time", Q1, not Q3):
 * confirmed genuinely unsupported. No q1_deficit_overcome metric exists,
 * and AFLDB-ISSUE-205 deliberately does not add one (scope decision, see
 * AFLDB-ISSUE-205.md). These rows stay declines; only the stale
 * expected_failure_reason (`unsupported_topic`, a label that was never
 * live for this phrase -- UNANSWERABLE_TOPICS, src/search/nl/vocab.ts,
 * has no comeback entry) is corrected to the runtime's own honest label,
 * `unsupported_term`. Every field this script does not name is preserved
 * unchanged.
 *
 * FIRST OPERATOR RUN'S FAILURE, AND WHY CANDIDACY MUST NOT START FROM OLD-STATE
 *
 * The first version of this script gated candidacy on
 * `expected_status==='decline' && expected_failure_reason==='unsupported_topic'`
 * FIRST, then classified the surviving rows' question text into Family
 * A/B, treating "matches neither family regex" as an abort. That correctly
 * failed closed on the real V4 corpus (row 11819, "Adelaide highest
 * fantasy score" -- refusing to run rather than silently mistargeting)
 * but for the wrong structural reason: `decline`+`unsupported_topic` is an
 * OLD-STATE fact this issue's two families happen to share, not a
 * target-IDENTITY fact unique to them. The real V4 corpus legitimately
 * carries several other `decline`/`unsupported_topic` families sharing
 * that exact old-state shape -- fantasy/SuperCoach, rebound 50s,
 * youngest/oldest, position, averages, subjective ranking
 * (UNANSWERABLE_TOPICS, src/search/nl/vocab.ts) -- and AFLDB-ISSUE-205
 * must never inspect any of them as candidates, let alone assert an
 * old-state against them this issue never audited.
 *
 * Fix: candidacy is now decided by `classify()` -- the question's own
 * text against the two family regexes -- BEFORE any old-state field is
 * ever read. A row neither family regex names is simply not a candidate
 * at all and passes through completely uninspected (not merely
 * unmodified). Only a row already identified as Family A/B by its own
 * text then has its audited old-state (status/failure-reason/blank
 * plan-shape fields) verified, and only a genuine Family A/B row with
 * drift aborts the run. This is the same "identity first, old-state
 * second" separation `tools/nl/fix-issue-204-stale-coverage-
 * expectations.ts` reached after its own first operator run over-matched
 * on category+template alone (AFLDB-ISSUE-204.md S0a) -- the identity
 * signal that discriminates a real target from a same-shaped sibling must
 * gate candidacy itself, not just filter it after the fact.
 *
 * FAIL-CLOSED, NOT PARTIAL
 *
 * Every invariant below aborts the whole run with a non-zero exit and
 * writes nothing: a wrong row count, a duplicate id, a comeback-family
 * candidate whose pre-state disagrees with the audited before-state, a
 * candidate question matching both family regexes at once, a derived
 * family count other than exactly 42/28 (or a total other than 70), a
 * nonzero intersection between the two family id sets, a Family A row
 * whose real re-parsed plan does not match the audited shape exactly, or
 * (as a final self-check) any row outside the derived 70 changing at
 * all. A row matching NEITHER family regex is not an error -- it is
 * correctly not a candidate, and is never asserted against or touched.
 *
 * See AFLDB-ISSUE-205.md for the full audit record and operator
 * validation procedure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NlParse } from '@/search/nl/plan';
import type { NlParseContext } from '@/search/nl/parser';

import { toCsv } from '@/lib/csv';

import { parseCsv, toExpectation } from './corpus';
import { flag, guardDatabase, loadEnv, loadEngine, option } from './engine';

// --------------------------------------------------------------- constants

const EXPECTED_ROW_COUNT = 12000;
const EXPECTED_TARGET_COUNT = 70;
const EXPECTED_FAMILY_A_COUNT = 42;
const EXPECTED_FAMILY_B_COUNT = 28;

const REQUIRED_COLUMNS = [
  'id', 'category', 'equivalence_group', 'question', 'expected_status', 'verification_level',
  'expected_grain', 'expected_mode', 'expected_metric', 'expected_aggregation',
  'expected_club', 'expected_opponent', 'expected_venue',
  'expected_season_from', 'expected_season_to', 'expected_match_type',
  'expected_failure_reason', 'expected_coverage_behavior', 'expected_min_confidence',
] as const;

/** The before-state every one of the 70 target rows shares (AFLDB-ISSUE-205 audit against the real v53/V4 failures.csv). */
const VERIFIED_OLD_STATUS = 'decline';
const VERIFIED_OLD_FAILURE_REASON = 'unsupported_topic';

/**
 * Mirrors TEAM_METRIC_WORDS' own q3_deficit_overcome entry
 * (src/search/nl/vocab.ts) exactly. Family A is defined as "whatever that
 * regex matches" -- not a separately maintained guess -- so it can never
 * silently drift from the runtime metric it is targeting.
 */
const FAMILY_A_RE = /\b(?:3qt|three[- ]quarter time) comebacks?\b/i;

/**
 * A "comeback" question naming a bare "quarter time" checkpoint -- the
 * Q1 phrasing AFLDB-ISSUE-205 confirmed has no NL search metric.
 * Independently excludes the three-quarter-time/3qt phrasing (rather than
 * simply negating isFamilyAQuestion) so classify()'s isA-and-isB check
 * below is a real overlap proof, not a tautology.
 */
function isFamilyAQuestion(question: string): boolean {
  return FAMILY_A_RE.test(question);
}
function isFamilyBQuestion(question: string): boolean {
  if (!/\bcomebacks?\b/i.test(question)) return false;
  if (!/\bquarter time\b/i.test(question)) return false;
  if (/\b(?:3qt|three[- ]quarter)[- ]time\b/i.test(question)) return false;
  return true;
}

// ----------------------------------------------------------------- helpers

type Family = 'A' | 'B' | 'both' | 'neither';

function classify(question: string): Family {
  const isA = isFamilyAQuestion(question);
  const isB = isFamilyBQuestion(question);
  if (isA && isB) return 'both';
  if (isA) return 'A';
  if (isB) return 'B';
  return 'neither';
}

/**
 * Mirrors declineFailureReason's one-line unsupported_term branch
 * (src/db/queries/nl/answer.ts, private) -- duplicated rather than
 * exported for a read-only audit script, the same discipline
 * audit-issue-200-extract.ts's templatePrefix() already documents for
 * itself. Only the branch this script needs: Family B rows never carry
 * report.ambiguousPlayer (they decline on a leftover "comeback" token,
 * not an unresolved player), so that branch is asserted, not mirrored.
 */
function isHonestUnsupportedTermDecline(report: { ambiguousPlayer?: unknown; unsupportedTerms: readonly string[] }): boolean {
  return report.ambiguousPlayer === undefined && report.unsupportedTerms.length > 0;
}

/**
 * The narrow slice of `loadEngine()`'s real DB-backed engine this script
 * actually calls -- `ctx` plus `parseNlQuestion`, nothing else. Kept
 * separate from `loadEngine()`'s full return type (which also carries
 * `sql`, `executePlan`, `clubByName`, etc., only `main()` below needs) so
 * `correctCorpus()` can be unit tested DB-free with a lightweight fake
 * (`tests/nl-issue-205-corpus-fix.test.ts`) instead of a real database
 * connection. `loadEngine()`'s actual return value structurally satisfies
 * this type without any cast.
 */
export type ParseEngine = {
  ctx: NlParseContext;
  parseNlQuestion: (question: string, ctx: NlParseContext) => Promise<NlParse>;
};

export type CorrectionSummary = {
  inputRows: number;
  outputRows: number;
  targetRowsExpected: number;
  familyARowsExpected: number;
  familyBRowsExpected: number;
  targetRowsModified: number;
  nonTargetRowsModified: number;
};

/**
 * Impure (calls the real parser per Family A candidate) and DB-backed --
 * unlike the other fix-issue-*.ts scripts in this directory, which are
 * pure and DB-free. That is deliberate: Family A's corrected values are
 * plan-shape facts this script has no other honest source for. Throws
 * (never partially applies) on any invariant failure; returns the
 * rewritten CSV text and a summary otherwise.
 */
export async function correctCorpus(inputCsvText: string, engine: ParseEngine): Promise<{ outputCsvText: string; summary: CorrectionSummary }> {
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

  // ---- STEP 1: candidacy is decided by the row's own question-text
  // family signature ALONE -- never by expected_status/
  // expected_failure_reason. AFLDB-ISSUE-205's first real run gated
  // candidacy on decline/unsupported_topic first and only then checked
  // the question text, which correctly aborted the whole run (writing no
  // V5) rather than silently mistargeting, but for the wrong structural
  // reason: `decline`+`unsupported_topic` is an OLD-STATE fact, not a
  // target-IDENTITY fact. The real V4 corpus carries several other
  // legitimate `decline`/`unsupported_topic` families sharing that exact
  // old-state shape -- fantasy/SuperCoach, rebound 50s, youngest/oldest,
  // position, averages, subjective ranking (UNANSWERABLE_TOPICS,
  // src/search/nl/vocab.ts) -- and the operator's run correctly hit one,
  // row 11819 ("Adelaide highest fantasy score"). classify() below is run
  // against EVERY row's question text regardless of its expected_status;
  // a row this issue's two families do not name is simply not a
  // candidate at all and is never inspected further, let alone asserted
  // against an old-state this issue never audited for it.
  const familyA: { id: number; question: string }[] = [];
  const familyB: { id: number; question: string }[] = [];

  for (const record of originalRecords) {
    const id = Number(record.id);
    const question = (record.question ?? '').trim();

    const family = classify(question);
    if (family === 'neither') continue; // not one of this issue's two families -- pass through untouched, no assertion made about it
    if (family === 'both') {
      throw new Error(`Row ${id}: question text matches BOTH comeback family regexes -- the mutual-exclusivity assumption broke. Question: "${question}". Refusing to run.`);
    }

    // ---- STEP 2: ONLY NOW, having identified this row as a genuine
    // Family A/B candidate by its own question text, assert the audited
    // V4 before-state. A comeback-family row that does not match the
    // audited old-state is real drift and aborts the whole run -- it is
    // never silently skipped or silently corrected. An unrelated row
    // (fantasy, rebound-50, etc.) never reaches this block at all.
    if (record.expected_status !== VERIFIED_OLD_STATUS) {
      throw new Error(`Row ${id}: Family ${family} candidate (by question text) has expected_status="${record.expected_status}", audited before-state expects "${VERIFIED_OLD_STATUS}". Question: "${question}". Refusing to run.`);
    }
    if (record.expected_failure_reason !== VERIFIED_OLD_FAILURE_REASON) {
      throw new Error(`Row ${id}: Family ${family} candidate (by question text) has expected_failure_reason="${record.expected_failure_reason}", audited before-state expects "${VERIFIED_OLD_FAILURE_REASON}". Question: "${question}". Refusing to run.`);
    }
    // A candidate's plan-shape fields (grain/metric/club/etc.) must
    // already be blank -- the corpus's own "blank asserts nothing"
    // convention for a decline row (tools/nl/corpus.ts header). A
    // non-blank field here means this row's pre-state does not match
    // what AFLDB-ISSUE-205's audit evidenced, and the run aborts rather
    // than silently overwriting an unaudited value.
    for (const field of ['expected_grain', 'expected_metric', 'expected_aggregation', 'expected_club', 'expected_opponent', 'expected_venue', 'expected_match_type'] as const) {
      if ((record[field] ?? '') !== '') {
        throw new Error(`Row ${id}: Family ${family} candidate's audited before-state expects "${field}"="" (blank), found "${record[field]}". Question: "${question}". Refusing to run.`);
      }
    }

    (family === 'A' ? familyA : familyB).push({ id, question });
  }

  // ---- distribution self-check: the two families' identity-derived
  // candidate sets, not the old-state filter (which by design now
  // matches only these two families' rows, never fantasy/rebound-50/etc.)
  const familyAIds = new Set(familyA.map((t) => t.id));
  const familyBIds = new Set(familyB.map((t) => t.id));
  const intersection = [...familyAIds].filter((id) => familyBIds.has(id));
  if (intersection.length > 0) {
    throw new Error(`Internal error: id(s) classified into both Family A and Family B: ${intersection.join(', ')}.`);
  }
  if (familyA.length !== EXPECTED_FAMILY_A_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_FAMILY_A_COUNT} Family A (three-quarter-time comeback) candidates identified by question text, found ${familyA.length}. Refusing to run.`);
  }
  if (familyB.length !== EXPECTED_FAMILY_B_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_FAMILY_B_COUNT} Family B (quarter-time comeback) candidates identified by question text, found ${familyB.length}. Refusing to run.`);
  }
  if (familyA.length + familyB.length !== EXPECTED_TARGET_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_TARGET_COUNT} total candidates (Family A + Family B), found ${familyA.length + familyB.length}. Refusing to run.`);
  }

  const idToIndex = new Map<number, number>();
  ids.forEach((id, index) => idToIndex.set(id, index));

  const outputRecords = originalRecords.map((record) => ({ ...record }));

  // ---- Family A: re-parse through the real, fixed parser and derive the
  // corrected expectation from the real plan. Any row that does not
  // re-parse to exactly the audited shape aborts the whole run.
  for (const { id, question } of familyA) {
    const result = await engine.parseNlQuestion(question, engine.ctx);
    if (result.status !== 'plan') {
      throw new Error(`Row ${id}: expected the fixed parser to produce a plan for "${question}", got status "${result.status}". Refusing to run -- the runtime fix may not be active, or this row is not actually part of Family A.`);
    }
    const { plan } = result;
    if (plan.grain !== 'team_match') {
      throw new Error(`Row ${id}: expected grain "team_match", got "${plan.grain}" for "${question}". Refusing to run.`);
    }
    if (plan.metric !== 'q3_deficit_overcome') {
      throw new Error(`Row ${id}: expected metric "q3_deficit_overcome", got "${plan.metric}" for "${question}". Refusing to run.`);
    }
    if (plan.agg.kind !== 'max') {
      throw new Error(`Row ${id}: expected aggregation "max", got "${plan.agg.kind}" for "${question}". Refusing to run.`);
    }
    if (plan.player !== undefined) {
      throw new Error(`Row ${id}: unexpected player "${plan.player.name}" bound for "${question}". Refusing to run -- outside the audited shape.`);
    }
    if (plan.scoreCheckpoint !== undefined) {
      throw new Error(`Row ${id}: unexpected scoreCheckpoint "${plan.scoreCheckpoint}" alongside q3_deficit_overcome for "${question}". Refusing to run -- the checkpoint/comeback fix may have regressed.`);
    }
    if (plan.scope.matchType !== undefined) {
      throw new Error(`Row ${id}: unexpected matchType "${plan.scope.matchType}" for "${question}". Refusing to run -- outside the audited shape (no corpus reverse-spelling mapping verified for this field).`);
    }

    const record = outputRecords[idToIndex.get(id)!];
    record.expected_status = 'success';
    record.verification_level = 'SEMANTIC';
    record.expected_grain = 'team_match';
    record.expected_metric = 'q3_deficit_overcome';
    record.expected_aggregation = 'max';
    record.expected_club = plan.scope.clubFor?.name ?? '';
    record.expected_opponent = plan.scope.clubAgainst?.name ?? '';
    record.expected_venue = plan.scope.venue?.name ?? '';
    record.expected_season_from = plan.scope.seasonMin !== undefined ? String(plan.scope.seasonMin) : '';
    record.expected_season_to = plan.scope.seasonMax !== undefined ? String(plan.scope.seasonMax) : '';
    record.expected_failure_reason = '';
    // Explicitly cleared, not invented: tools/nl/corpus.ts's scoreRow only
    // checks a verified answer/result value when actual.executed is true,
    // which a verification_level=SEMANTIC row never triggers on its own --
    // see AFLDB-ISSUE-205.md's scorer-contract finding. Inventing a
    // confidence floor or coverage note here would be exactly the kind of
    // guess this script's fail-closed discipline forbids; blank asserts
    // nothing (tools/nl/corpus.ts header).
    record.expected_coverage_behavior = '';
    record.expected_min_confidence = '';
  }

  // ---- Family B: re-verify the row still genuinely declines with an
  // honest unsupported_term reason post-fix, then correct only the
  // failure-reason label. Every other field is left untouched.
  for (const { id, question } of familyB) {
    const result = await engine.parseNlQuestion(question, engine.ctx);
    if (result.status === 'plan') {
      throw new Error(`Row ${id}: expected "${question}" to still decline post-fix (no q1_deficit_overcome metric exists), but it now produces a plan (grain "${result.plan.grain}", metric "${result.plan.metric}"). Refusing to run -- this row may need to move to Family A, or the fix over-broadened.`);
    }
    if (!isHonestUnsupportedTermDecline(result.report)) {
      throw new Error(`Row ${id}: expected "${question}" to decline with an unclaimed "comeback"-family leftover token, found unsupportedTerms=[${result.report.unsupportedTerms.join(', ')}] ambiguousPlayer=${String(result.report.ambiguousPlayer)}. Refusing to run.`);
    }

    const record = outputRecords[idToIndex.get(id)!];
    record.expected_failure_reason = 'unsupported_term';
  }

  // ---- post-hoc self-check: exactly the 70 targets changed, nothing else
  const changedIds: number[] = [];
  for (let index = 0; index < originalRecords.length; index++) {
    const before = originalRecords[index];
    const after = outputRecords[index];
    if (header.some((name) => before[name] !== after[name])) changedIds.push(Number(before.id));
  }
  const changedIdSet = new Set(changedIds);
  const targetIdSet = new Set([...familyA, ...familyB].map((t) => t.id));
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
      familyARowsExpected: EXPECTED_FAMILY_A_COUNT,
      familyBRowsExpected: EXPECTED_FAMILY_B_COUNT,
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

async function main(): Promise<void> {
  const corpusPath = option('corpus');
  const outPath = option('out');
  if (!corpusPath) throw new Error('--corpus <path> is required.');
  if (!outPath) throw new Error('--out <path> is required.');
  assertOutputPathIsSafe(corpusPath, outPath, flag('allow-overwrite-input'));

  loadEnv();
  guardDatabase();
  const engine = await loadEngine();

  try {
    const inputCsvText = readFileSync(corpusPath, 'utf8');
    const { outputCsvText, summary } = await correctCorpus(inputCsvText, engine);
    writeFileSync(outPath, outputCsvText, 'utf8');

    process.stdout.write(`${[
      `input rows:                ${summary.inputRows}`,
      `output rows:               ${summary.outputRows}`,
      `target rows expected:      ${summary.targetRowsExpected}`,
      `  family A (Q3, expected):   ${summary.familyARowsExpected}`,
      `  family B (Q1, expected):   ${summary.familyBRowsExpected}`,
      `target rows modified:      ${summary.targetRowsModified}`,
      `non-target rows modified:  ${summary.nonTargetRowsModified}`,
      `output path:               ${resolve(outPath)}`,
    ].join('\n')}\n`);
  } finally {
    await engine.sql.end();
  }
}

// Run only when this file is the entry point. Importing correctCorpus() --
// as a future tests/nl-issue-205-corpus-fix.test.ts would -- must not
// start a run or require a database connection.
const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
