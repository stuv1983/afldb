/**
 * Builds the two Phase G sweep corpora from the TRACKED corpora, deterministically.
 *
 * The `nl:ui` harness takes exactly one NL_UI_CORPUS file, but Phase G's
 * subject is six additive corpora (Phase B coaching, Phase C after-the-siren,
 * Phase E first-kick-goal) and its regression gate is two more. Attempt 1
 * (AFLDB-ISSUE-152 §19) merged them by hand into a scratch directory outside
 * the repository, which made the run unreproducible from the branch alone.
 *
 * This writes them instead into a gitignored, deterministic location under the
 * repository root, from tracked inputs, in a FIXED order. The order is not
 * cosmetic: §19.3 identifies which rows were behind the rate limiter by their
 * corpus position (first-kick-goal plan rows at 245-264), and that statement
 * only stays checkable if the merge order never moves.
 *
 * Nothing here rewrites a question, a status or a tag: rows are copied through
 * verbatim, and the merged file is re-read with the same reader the sweep uses
 * so a merge that corrupted a row fails here rather than in the browser.
 *
 *   npx tsx tools/issue-152/build-phase-g-corpora.ts new
 *   npx tsx tools/issue-152/build-phase-g-corpora.ts current
 *   npx tsx tools/issue-152/build-phase-g-corpora.ts regression
 *   npx tsx tools/issue-152/build-phase-g-corpora.ts all
 *
 * Prints one JSON object per built set on stdout, so the PowerShell runners can
 * read the row counts they gate on rather than hard-coding them twice.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { parseCsv } from '../nl/corpus';
import { readUiCorpus } from '../nl/ui-corpus';

/**
 * Gitignored -- .gitignore's `nl-ui-out-*` directory rule covers it -- but
 * inside the repository, so a Phase G run is reproducible from a checkout
 * without depending on a temporary directory another session may have cleared.
 */
export const PHASE_G_ROOT = 'nl-ui-out-152-phaseg';
const CORPORA_DIR = `${PHASE_G_ROOT}/corpora`;
const SOURCE_DIR = 'tests/nl-ui/corpora';

export type PhaseGSetName = 'new' | 'current' | 'next' | 'regression';

/**
 * `tests/nl-ui/nl-stress.spec.ts` slices the corpus into Playwright tests
 * of this size. Exported so a runner can state up front how many batches
 * a set should produce: a run that reports a different number read a
 * different corpus than the one it says it read.
 */
export const PLAYWRIGHT_BATCH_SIZE = 100;

export function expectedBatches(rows: number): number {
  return Math.ceil(rows / PLAYWRIGHT_BATCH_SIZE);
}

export type PhaseGSet = {
  name: PhaseGSetName;
  /** Written under CORPORA_DIR; regenerated on every build. */
  output: string;
  /** Concatenated in this exact order. */
  sources: string[];
  /** Asserted after the merge, so a corpus edit cannot silently change the gate. */
  expected: { rows: number; plan: number; decline: number; unknown: number };
};

export const PHASE_G_SETS: Record<PhaseGSetName, PhaseGSet> = {
  /**
   * The 271 rows Phase G P3 is about: the three new families, plan corpus then
   * decline corpus, in phase order (B, C, E).
   *
   * Was 270 until the P3-r1 close-out (AFLDB-ISSUE-152 §20). `fkg_005` asked
   * about an unsuffixed "Gary Ablett", which the resolver's own contract makes
   * ambiguous, so the row was a corpus-contract defect rather than a parser
   * one: the plan row now names "Gary Ablett Jr" and the bare form moved to
   * the decline corpus as `fkg_dec_007`. Plan stayed 212 -- the row was
   * replaced, not added -- and decline went 58 -> 59.
   */
  new: {
    name: 'new',
    output: `${CORPORA_DIR}/phase-g-new-family-271.csv`,
    sources: [
      `${SOURCE_DIR}/afldb-ui-questions-coaching-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-coaching-decline-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-after-siren-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-after-siren-decline-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-first-kick-goal-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-first-kick-goal-decline-v1-20260908.csv`,
    ],
    expected: { rows: 271, plan: 212, decline: 59, unknown: 0 },
  },

  /**
   * AFLDB-ISSUE-152 Phase D. The CURRENT new-family acceptance set: the
   * pinned 271 above plus the two additive relationship corpora, 319 rows.
   *
   * This is a SEPARATE set, not an edit to `new`. Phase G's accepted
   * evidence is the historical statement "271 = 212 plan + 59 decline,
   * green at P3-r2" (§21.3), and that statement stays checkable only
   * while the corpus it names keeps its size and its row order. Phase D
   * therefore appends: the six Phase B/C/E sources are listed here in the
   * SAME order as `new`, so rows 1-271 of this file are byte-for-byte the
   * rows 1-271 of the 271-row file and §19.3's position-based statements
   * survive unchanged. The 48 Phase D rows are 272-319.
   *
   * 242 plan = 212 + 26 + 4. 77 decline = 59 + 22 - 4.
   *
   * AFLDB-ISSUE-153 reclassified four rows IN PLACE -- same file, same
   * position, same id, `expected_status` decline -> plan -- because the
   * semantics they pinned as unreachable now ship. Row count and row order
   * are unchanged, so every position-based statement above still holds:
   *
   *   rel_dec_003  FS1, Stage 2  -- operator decision Q1/Q1a(a) narrowed
   *                                the blanket D8 guard to the bare and
   *                                collective forms; naming the RULE now
   *                                binds to father_son_selections (99);
   *   rel_dec_004  FS2, Stage 3  -- father_son_selection_for_club, the
   *                                SELECTING club folded by organization;
   *   rel_dec_005  FS3, Stage 3  -- father_son_selection_between, over
   *                                draft_year and labelled a draft year;
   *   rel_dec_006  FS6, Stage 4  -- the fatherSonSummary distribution,
   *                                denominator 127 selection events (Q2).
   *
   * The four categories keep their `rel_decline_*` names. Renaming them
   * would break the position-and-name pins in tests/nl-ui-corpus.test.ts
   * for no gain: the name records which boundary the row was written for,
   * and `expected_status` is what the sweep actually scores.
   */
  current: {
    name: 'current',
    output: `${CORPORA_DIR}/phase-d-current-new-family-319.csv`,
    sources: [
      `${SOURCE_DIR}/afldb-ui-questions-coaching-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-coaching-decline-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-after-siren-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-after-siren-decline-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-first-kick-goal-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-first-kick-goal-decline-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-relationships-v1-20260909.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-relationships-decline-v1-20260909.csv`,
    ],
    expected: { rows: 319, plan: 242, decline: 77, unknown: 0 },
  },

  /**
   * AFLDB-ISSUE-152 Phase F. The NEXT new-family acceptance set: the
   * pinned 319 above plus the two additive cross-domain corpora, 349
   * rows.
   *
   * A third generation, appended for the same reason Phase D appended a
   * second. Phase D's accepted evidence is "319 = 238 plan + 81 decline,
   * green at P5-r2" (§24.3) -- a HISTORICAL run result, preserved as run,
   * and superseded rather than rewritten by AFLDB-ISSUE-153's 242/77 --
   * and that statement stays checkable only
   * while the corpus it names keeps its size and its row order. The eight
   * Phase B/C/E/D sources are therefore listed here in the SAME order as
   * `current`, so rows 1-319 of this file are byte-for-byte the 319-row
   * file and every position-based statement in §19.3, §23 and §24
   * survives. The 30 Phase F rows are 320-349.
   *
   * 258 plan = 242 + 15 + 1. 91 decline = 77 + 15 - 1.
   *
   * The 30 Phase F rows now contribute 16 plan / 14 decline. The
   * `coach_record` collision row -- "Richmond's coaching record", which must
   * still ANSWER -- remains in the plan column, and AFLDB-ISSUE-153 has moved
   * X3 from decline to plan in place. The set total, 349, and its batch count,
   * 4, are unchanged.
   *
   * AFLDB-ISSUE-153 inherits the four `current` reclassifications above
   * and adds a fifth of its own, again IN PLACE, again at the same
   * position and id:
   *
   *   xd_dec_014  X3, Stage 5  -- operator decision Q6 lifted the F-D1
   *                              deferral, so "selected under the
   *                              father-son rule who also coached"
   *                              composes and answers (1, Rhyce Shaw).
   *
   * xd_dec_012, xd_dec_013 and xd_dec_015 are its immediate neighbours in
   * the same category and each still DECLINES -- the two vague/collective
   * forms in the parser, the ranked form at V6 -- which is why
   * tests/nl-ui-corpus.test.ts pins all four by name rather than pinning
   * the category.
   */
  next: {
    name: 'next',
    output: `${CORPORA_DIR}/phase-f-next-new-family-349.csv`,
    sources: [
      `${SOURCE_DIR}/afldb-ui-questions-coaching-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-coaching-decline-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-after-siren-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-after-siren-decline-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-first-kick-goal-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-first-kick-goal-decline-v1-20260908.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-relationships-v1-20260909.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-relationships-decline-v1-20260909.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-cross-domain-v1-20260909.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-cross-domain-decline-v1-20260909.csv`,
    ],
    expected: { rows: 349, plan: 258, decline: 91, unknown: 0 },
  },

  /**
   * The pre-existing gate, unchanged by ISSUE-152 and asserted untouched by
   * tests/nl-ui-corpus.test.ts. Every row is scored: unlike the 12,000-row
   * corpus these two carry no `unknown` edge probes, so `pass + fail` must
   * equal the observed count and an `unscored` row is itself a defect.
   */
  regression: {
    name: 'regression',
    output: `${CORPORA_DIR}/phase-g-regression-1495.csv`,
    sources: [
      `${SOURCE_DIR}/afldb-ui-questions-1440-real-user-v3-20260822.csv`,
      `${SOURCE_DIR}/afldb-ui-questions-60-real-user-decline-v3-20260822.csv`,
    ],
    expected: { rows: 1495, plan: 1435, decline: 60, unknown: 0 },
  },
};

const COLUMNS = ['id', 'category', 'question', 'expected_status', 'tags'] as const;

/**
 * Re-emitted rather than concatenated as text.
 *
 * `tags` is a comma-separated list inside one CSV field, so a line-level merge
 * only works while every source file happens to quote identically. Parsing and
 * re-writing makes the merged file well-formed by construction.
 */
function toCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function mergeRows(sources: string[]): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  for (const source of sources) {
    const parsed = parseCsv(readFileSync(resolve(source), 'utf8'));
    if (parsed.length < 2) throw new Error(`${source}: no data rows`);

    const header = parsed[0].map((h) => h.trim());
    for (const column of COLUMNS) {
      if (!header.includes(column)) {
        throw new Error(`${source}: missing column "${column}" (found: ${header.join(', ')})`);
      }
    }
    for (const row of parsed.slice(1)) {
      if (row.length === 1 && row[0].trim() === '') continue;
      rows.push(COLUMNS.map((column) => row[header.indexOf(column)] ?? ''));
    }
  }
  return { header: [...COLUMNS], rows };
}

export type PhaseGBuildResult = {
  set: PhaseGSetName;
  path: string;
  rows: number;
  plan: number;
  decline: number;
  unknown: number;
  sources: string[];
};

export function buildSet(set: PhaseGSet, outDir?: string): PhaseGBuildResult {
  const outputPath = outDir ? resolve(outDir, set.output.split('/').pop()!) : resolve(set.output);
  const { header, rows } = mergeRows(set.sources);

  const duplicates = new Map<string, number>();
  for (const row of rows) duplicates.set(row[0], (duplicates.get(row[0]) ?? 0) + 1);
  const clashes = [...duplicates.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (clashes.length > 0) {
    // Ids key the observation files and the metamorphic grouping; a collision
    // would silently drop one row's result in favour of another's.
    throw new Error(`duplicate corpus ids across the merged sources: ${clashes.slice(0, 5).join(', ')}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const text = [header, ...rows].map((row) => row.map(toCsvField).join(',')).join('\n');
  writeFileSync(outputPath, `${text}\n`, 'utf8');

  // Read back through the harness's own reader: the merge is only as good as
  // what readUiCorpus will make of it at the start of a two-hour run.
  const cases = readUiCorpus(outputPath);
  const counts = {
    rows: cases.length,
    plan: cases.filter((c) => c.expectedStatus === 'plan').length,
    decline: cases.filter((c) => c.expectedStatus === 'decline').length,
    unknown: cases.filter((c) => c.expectedStatus === 'unknown').length,
  };

  for (const key of ['rows', 'plan', 'decline', 'unknown'] as const) {
    if (counts[key] !== set.expected[key]) {
      throw new Error(
        `${set.name}: expected ${set.expected[key]} ${key}, merged ${counts[key]}. `
        + 'A tracked corpus changed size -- update PHASE_G_SETS and the issue record together, '
        + 'rather than loosening the gate.',
      );
    }
  }

  const overlong = cases.filter((c) => c.question.length > 100);
  if (overlong.length > 0) {
    throw new Error(`${overlong.length} question(s) exceed /search's 100-character limit, e.g. ${overlong[0].id}`);
  }

  return { set: set.name, path: outputPath, ...counts, sources: set.sources };
}

/**
 * Only when run as a script. tests/nl-ui-corpus.test.ts imports
 * PHASE_G_SETS to pin the merged sizes, and an unguarded top-level build
 * would write into the evidence tree every time the unit suite runs.
 */
if (/build-phase-g-corpora/.test(process.argv[1] ?? '')) {
  const requested = process.argv[2] ?? 'all';
  const names: PhaseGSetName[] = requested === 'all'
    ? ['new', 'current', 'next', 'regression']
    : requested === 'new' || requested === 'current' || requested === 'next' || requested === 'regression'
      ? [requested]
      : (() => { throw new Error(`unknown set "${requested}"; expected new, current, next, regression or all`); })();

  for (const name of names) console.log(JSON.stringify(buildSet(PHASE_G_SETS[name])));
}
