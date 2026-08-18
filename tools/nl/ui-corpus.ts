/**
 * The UI stress corpus: `afldb_ui_nl_12000.csv`, driven through a real
 * browser against a real deployment rather than through the plan-level
 * harness in `corpus.ts` / `v2.ts`.
 *
 * This corpus is DELIBERATELY weaker than those two. It carries five
 * columns -- id, category, question, expected_status, tags -- and no
 * expected plan at all, so it cannot say whether an answer was *right*.
 * (The README shipped beside it describes a 33-column file with
 * expected_grain/expected_metric/expected_plan_json; that is a different
 * corpus and is not this one. Do not wire semantic assertions to this
 * file expecting them to mean anything.)
 *
 * What it CAN establish, at a volume the plan harness never renders:
 *
 *   1. 11,825 questions each produce a real answer panel in the browser,
 *      with no 5xx, no page error and no console error.
 *   2. 119 questions decline, and decline *safely* -- an honest panel or
 *      no panel, never a stack trace.
 *   3. Filler variants agree. ~11% of rows are the same question wearing
 *      "please" / "quick one" / "!!!", tagged `filler` + `metamorphic`.
 *      A parser that reads "Richmond biggest win" one way and "please
 *      Richmond biggest win" another is broken regardless of which
 *      reading is correct -- so this is the one strong assertion the
 *      corpus supports without an oracle, and it is checked here.
 *
 * Database-free and browser-free, like `corpus.ts`, so the scoring rules
 * are unit-testable before a two-hour run is trusted.
 */
import { readFileSync } from 'node:fs';

import { isHydrationErrorMessage } from '../../src/lib/hydration-error';
import { parseCsv } from './corpus';

// ------------------------------------------------------------------- corpus

export type UiExpectedStatus = 'plan' | 'decline' | 'unknown';

export type UiCase = {
  id: string;
  category: string;
  question: string;
  /**
   * `unknown` is a real value in the file (56 `edge_probe` rows: slang
   * like "most possies in a game", nicknames like "Danger most
   * disposals"). It means the corpus author had not decided what correct
   * behaviour was. Those rows are observed and reported but never
   * scored -- inventing an expectation for them here would be guessing.
   */
  expectedStatus: UiExpectedStatus;
  tags: string[];
};

const REQUIRED_COLUMNS = ['id', 'category', 'question', 'expected_status', 'tags'] as const;

export function readUiCorpus(path: string): UiCase[] {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (rows.length < 2) throw new Error(`${path}: no data rows`);

  const header = rows[0].map((h) => h.trim());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      throw new Error(
        `${path}: missing column "${column}". Found: ${header.join(', ')}. `
        + 'This reader is for the 5-column UI corpus, not the 33-column plan corpus.',
      );
    }
  }
  const at = (row: string[], column: string) => row[header.indexOf(column)] ?? '';

  const cases: UiCase[] = [];
  for (const row of rows.slice(1)) {
    // A trailing newline yields one empty row; anything else short is a defect.
    if (row.length === 1 && row[0].trim() === '') continue;

    const status = at(row, 'expected_status').trim();
    if (status !== 'plan' && status !== 'decline' && status !== 'unknown') {
      throw new Error(`${at(row, 'id')}: unknown expected_status "${status}"`);
    }
    const question = at(row, 'question').trim();
    if (!question) throw new Error(`${at(row, 'id')}: empty question`);

    cases.push({
      id: at(row, 'id').trim(),
      category: at(row, 'category').trim(),
      question,
      expectedStatus: status,
      tags: at(row, 'tags').split(',').map((t) => t.trim()).filter(Boolean),
    });
  }
  return cases;
}

// -------------------------------------------------------------- filler cores

/**
 * The conversational padding the corpus wraps around a core question.
 *
 * Taken from the file itself, not invented: every one of these appears
 * on rows tagged `filler`. Order matters only in that the anchored
 * prefixes are tried before the bare ones ("please tell me " must win
 * over "please ").
 *
 * The em dash in "AFL question —" is a real U+2014 in the CSV. It is
 * often mis-shown as a replacement character by terminals; matching the
 * literal dash here rather than a wildcard keeps a genuine encoding
 * regression in the corpus visible instead of silently absorbed.
 */
const FILLER_PREFIXES = [
  /^AFL question\s*—\s*/i,
  /^hey mate,\s*/i,
  /^can you tell me\s+/i,
  /^please tell me\s+/i,
  /^quick one\s+/i,
  /^show me\s+/i,
  /^please\s+/i,
];

const FILLER_SUFFIXES = [
  /\s+please$/i,
  /[!?]+$/,
];

/**
 * Strips filler down to the semantic core, so metamorphic variants of
 * one question collapse to one key.
 *
 * Applied repeatedly because the corpus stacks them ("quick one … please",
 * "please … ??"), and a single pass would leave a suffix behind and split
 * a group that should have been one.
 */
export function questionCore(question: string): string {
  let core = question.trim();
  for (let pass = 0; pass < 4; pass++) {
    const before = core;
    for (const pattern of FILLER_PREFIXES) core = core.replace(pattern, '');
    for (const pattern of FILLER_SUFFIXES) core = core.replace(pattern, '');
    core = core.trim();
    if (core === before) break;
  }
  return core.toLowerCase().replace(/\s+/g, ' ');
}

export function groupByCore(cases: UiCase[]): Map<string, UiCase[]> {
  const groups = new Map<string, UiCase[]>();
  for (const test of cases) {
    const key = questionCore(test.question);
    const existing = groups.get(key);
    if (existing) existing.push(test);
    else groups.set(key, [test]);
  }
  return groups;
}

// ------------------------------------------------------------- observations

/**
 * What the rendered page was, reduced to the only distinctions /search
 * actually draws. See src/components/NlAnswerSection.tsx:
 *
 *   answered      the answer section, with its "How was this calculated?"
 *                 trace -- the engine understood and answered.
 *   unanswerable  the section's honest `.empty` panel: understood, but
 *                 cannot be answered (no coaching data, streaks unsupported).
 *   absent        no NL section at all -- the question was not recognised
 *                 as one. Ordinary search results or the "No results"
 *                 state may still be on the page.
 *   http_error    non-2xx from the server.
 *   page_error    the navigation itself failed: a timeout, or a bounce
 *                 back to /beta because the session died mid-run.
 *
 * `absent` is a legitimate decline, not a failure: declining by saying
 * nothing is the safe behaviour for "top potato disposals". It is only a
 * failure against an `expected_status` of `plan`.
 *
 * Console errors and uncaught exceptions are recorded in `errors` but do
 * NOT change the outcome. /search raises an intermittent React #418
 * hydration mismatch on roughly 1% of loads, reproducibly under every
 * `waitUntil` strategy and never twice on the same question -- so it is
 * a property of the page, not of the question being asked. Folding that
 * into the outcome would fail ~120 questions per run at random and bury
 * the corpus signal underneath it. It is counted separately and reported
 * instead, which is where a 1% intermittent defect belongs.
 */
export type UiOutcome = 'answered' | 'unanswerable' | 'absent' | 'http_error' | 'page_error';

export type UiObservation = {
  id: string;
  question: string;
  outcome: UiOutcome;
  httpStatus: number | null;
  /** The answer panel's <h2>, used to check filler variants agree. */
  headline: string | null;
  /** The one-line reading-back of the question, when shown. */
  interpretation: string | null;
  errors: string[];
  elapsedMs: number;
  /**
   * Which cluster worker served this navigation, from deploy/server-cluster.mjs's
   * tracing headers (AFLDB_TRACE_REQUESTS=on). Absent when tracing is off,
   * so every field here is optional and nothing depends on it.
   *
   * `trace` is the SSR document request; `subresourceWorkers` is every
   * OTHER traced response the page pulled (RSC payloads especially). The
   * pair is the point: the hydration-mismatch hypothesis is that a
   * document rendered by one worker gets its follow-up data from another
   * holding different cache state, which only a comparison between the
   * two can show.
   */
  trace?: {
    worker: string | null;
    pid: string | null;
    requestId: string | null;
    build: string | null;
  };
  /** Distinct `x-afldb-worker` values seen on non-document responses for this navigation. */
  subresourceWorkers?: string[];
  /**
   * Full per-response detail behind `subresourceWorkers`, in arrival order:
   * every traced response (not just the distinct workers), each with its
   * timing relative to navigation start and Playwright's resource-type
   * classification. Exists to test the more specific cross-worker-timing
   * hypothesis -- e.g. "the data-bearing request lands on a different
   * worker within N ms of the document" -- which a deduplicated worker set
   * cannot distinguish from an unrelated image or font request.
   */
  subresourceTrace?: { worker: string; atMs: number; resourceType: string }[];
  /**
   * The document's worker plus every RSC prefetch (`fetch`-typed
   * response with a traced worker header -- this app's nav-link
   * hover/viewport prefetching, `?_rsc=` in the URL) this navigation
   * triggered, on EVERY row, not just ones that hydration-error. Exists
   * to give a same-run, same-conditions baseline: whether same-worker
   * overlap between the document and a prefetch is more common on
   * failing loads than ordinary ones is only answerable by comparing
   * against ordinary loads captured under identical conditions in the
   * same sweep, not a separately-run sample with a different traffic
   * shape.
   */
  networkSummary?: {
    docWorker: string | null;
    docAtMs: number | null;
    prefetches: { worker: string; atMs: number }[];
  };
};

export type UiVerdict = 'pass' | 'fail' | 'unscored';

/**
 * `unknown` rows are recorded, never scored -- except that a crash is
 * still a crash. An edge probe whose behaviour nobody has decided on
 * must still not 500.
 */
export function scoreObservation(expected: UiExpectedStatus, outcome: UiOutcome): UiVerdict {
  if (outcome === 'http_error' || outcome === 'page_error') return 'fail';
  if (expected === 'unknown') return 'unscored';
  if (expected === 'plan') return outcome === 'answered' ? 'pass' : 'fail';
  return outcome === 'answered' ? 'fail' : 'pass';
}

// -------------------------------------------------------------- metamorphic

export type MetamorphicViolation = {
  core: string;
  field: 'outcome' | 'headline';
  /** id -> the value that disagreed, for every distinct value seen. */
  values: Record<string, string>;
};

/**
 * Filler must not change the answer.
 *
 * Outcome is compared for every group. Headline is compared only across
 * members that all answered: comparing the headline of an `answered` row
 * against an `absent` one would report the same defect twice, and the
 * outcome disagreement is the clearer statement of it.
 *
 * Crashes are excluded from both comparisons. A group where one member
 * timed out has already failed on that member; letting the timeout also
 * manufacture a "filler changed the answer" finding would double-count
 * one defect as two, which is exactly the mis-scoring tests/nl-stress-corpus
 * exists to prevent.
 */
export function metamorphicViolations(
  groups: Map<string, UiCase[]>,
  observations: Map<string, UiObservation>,
): MetamorphicViolation[] {
  const violations: MetamorphicViolation[] = [];

  for (const [core, members] of groups) {
    if (members.length < 2) continue;

    const seen = members
      .map((m) => observations.get(m.id))
      .filter((o): o is UiObservation => o !== undefined)
      .filter((o) => o.outcome !== 'http_error' && o.outcome !== 'page_error');
    if (seen.length < 2) continue;

    const outcomes: Record<string, string> = {};
    for (const observation of seen) outcomes[observation.id] = observation.outcome;
    if (new Set(Object.values(outcomes)).size > 1) {
      violations.push({ core, field: 'outcome', values: outcomes });
      continue;
    }

    if (seen[0].outcome !== 'answered') continue;
    const headlines: Record<string, string> = {};
    for (const observation of seen) headlines[observation.id] = observation.headline ?? '';
    if (new Set(Object.values(headlines)).size > 1) {
      violations.push({ core, field: 'headline', values: headlines });
    }
  }

  return violations;
}

// ------------------------------------------------------------------ summary

export type UiSummary = {
  total: number;
  pass: number;
  fail: number;
  unscored: number;
  byOutcome: Record<UiOutcome, number>;
  /** Failures grouped by category, worst first -- where to look next. */
  failuresByCategory: [string, number][];
  metamorphic: number;
  /**
   * Loads that raised a console error or uncaught exception while still
   * rendering correctly. Reported rather than failed -- see UiOutcome.
   */
  clientErrors: number;
};

/**
 * Hydration errors broken down by which cluster worker served the page.
 *
 * The question this exists to answer, and the reason it reports rates
 * rather than raw counts: a worker that served twice as many requests
 * will show twice as many errors while being no more faulty. Only the
 * per-worker RATE distinguishes "one bad process" from "evenly spread".
 *
 * `crossWorker` is the second hypothesis: a document served by one worker
 * whose follow-up RSC request came from another. If hydration errors
 * concentrate there rather than on any single worker, the cause is the
 * cluster's per-process cache divergence rather than any one process.
 */
export type HydrationByWorker = {
  /** worker id -> { loads, hydrationErrors, ratePercent } */
  byWorker: Record<string, { loads: number; hydrationErrors: number; ratePercent: number }>;
  crossWorker: {
    sameWorker: { loads: number; hydrationErrors: number; ratePercent: number };
    differentWorker: { loads: number; hydrationErrors: number; ratePercent: number };
  };
  /** Loads carrying no trace headers at all -- tracing off, or an untraced deployment. */
  untraced: number;
  totalHydrationErrors: number;
};

/**
 * React's hydration-mismatch errors, minified (#418/#423/#425) or not.
 * Re-exported under this tool's existing name from the shared classifier
 * in src/lib/hydration-error.ts, which the production client-side health
 * reporter now also uses -- one definition, not two that can drift apart.
 */
export const isHydrationError = isHydrationErrorMessage;

export function hydrationByWorker(observations: Iterable<UiObservation>): HydrationByWorker {
  const byWorker: Record<string, { loads: number; hydrationErrors: number; ratePercent: number }> = {};
  const same = { loads: 0, hydrationErrors: 0, ratePercent: 0 };
  const different = { loads: 0, hydrationErrors: 0, ratePercent: 0 };
  let untraced = 0;
  let totalHydrationErrors = 0;

  for (const observation of observations) {
    const hydrated = observation.errors.some(isHydrationError);
    if (hydrated) totalHydrationErrors++;

    const worker = observation.trace?.worker;
    if (!worker) { untraced++; continue; }

    byWorker[worker] ??= { loads: 0, hydrationErrors: 0, ratePercent: 0 };
    byWorker[worker].loads++;
    if (hydrated) byWorker[worker].hydrationErrors++;

    // Only meaningful when the page actually made a traced subrequest;
    // a document with none says nothing either way about cross-worker
    // divergence and must not be counted as evidence of agreement.
    const others = observation.subresourceWorkers ?? [];
    if (others.length > 0) {
      const bucket = others.every((w) => w === worker) ? same : different;
      bucket.loads++;
      if (hydrated) bucket.hydrationErrors++;
    }
  }

  const rate = (bucket: { loads: number; hydrationErrors: number; ratePercent: number }) => {
    bucket.ratePercent = bucket.loads === 0
      ? 0
      : Number(((bucket.hydrationErrors / bucket.loads) * 100).toFixed(3));
  };
  for (const bucket of Object.values(byWorker)) rate(bucket);
  rate(same);
  rate(different);

  return { byWorker, crossWorker: { sameWorker: same, differentWorker: different }, untraced, totalHydrationErrors };
}

export function summarise(
  cases: UiCase[],
  observations: Map<string, UiObservation>,
  violations: MetamorphicViolation[],
): UiSummary {
  const byOutcome: Record<UiOutcome, number> = {
    answered: 0, unanswerable: 0, absent: 0, http_error: 0, page_error: 0,
  };
  const failuresByCategory = new Map<string, number>();
  let pass = 0; let fail = 0; let unscored = 0; let clientErrors = 0;

  for (const test of cases) {
    const observation = observations.get(test.id);
    if (!observation) continue;
    byOutcome[observation.outcome]++;
    if (observation.errors.length > 0) clientErrors++;

    const verdict = scoreObservation(test.expectedStatus, observation.outcome);
    if (verdict === 'pass') pass++;
    else if (verdict === 'unscored') unscored++;
    else {
      fail++;
      failuresByCategory.set(test.category, (failuresByCategory.get(test.category) ?? 0) + 1);
    }
  }

  return {
    total: observations.size,
    pass,
    fail,
    unscored,
    byOutcome,
    failuresByCategory: [...failuresByCategory].sort((a, b) => b[1] - a[1]),
    metamorphic: violations.length,
    clientErrors,
  };
}
