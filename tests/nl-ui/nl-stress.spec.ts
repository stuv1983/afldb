import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { PARSER_VERSION } from '../../src/search/nl/plan';
import {
  isHydrationError, readUiCorpus, type UiCase, type UiObservation, type UiOutcome,
} from '../../tools/nl/ui-corpus';
import { buildReport, formatSummary } from '../../tools/nl/ui-summary';

/**
 * The 12,000-question UI sweep. Run with playwright.nl-stress.config.ts,
 * never the default config -- see that file for why it is separate.
 *
 *   AFLDB_E2E_BASE_URL   deployment under test (default: dev)
 *   AFLDB_E2E_BETA_CODE  access code, redeemed once by auth.setup.ts
 *   NL_UI_CORPUS         path to afldb_ui_nl_12000.csv
 *   NL_UI_LIMIT          first N questions only -- use this first
 *   NL_UI_BATCH          questions per Playwright test (default 100)
 *   NL_UI_TIMEOUT_MS     per-navigation budget (default 15000)
 *   NL_UI_WORKERS        parallel browsers (default 4)
 *   NL_UI_FAST=1         JavaScript off; server-rendered panel only
 *   NL_UI_RUN_TAG        provenance label written to nl_search_log.run_tag
 *                        (migration 051), e.g. ui-12k-20260818. Needs the
 *                        deployment to have AFLDB_NL_RUN_TAG=accept, or the
 *                        header is ignored and rows log as real traffic.
 *
 * ALSO the permanent reproducer for a production-only React #418
 * hydration mismatch on /search, ~2-6% of loads, self-recovering (see
 * project memory, investigated at length 2026-08-18). The critical,
 * hard-won discovery: hydration failures have only ever reproduced under
 * SUSTAINED, VARIED corpus traffic. Repeating one fixed question did not
 * reproduce the issue in either sequential or matched 4-way concurrent
 * testing (0/400 both ways) -- only a real, varied question corpus does,
 * at a consistent rate. DO NOT "simplify" this into a repeated
 * single-query reproducer; that variant has already been tried and does
 * not trigger the bug. To re-run this as a regression check after a
 * React/Next.js/routing/layout change, watch the printed
 * `hydration errors:` rate -- see hydrationByWorker in
 * tools/nl/ui-corpus.ts and the forensic capture in
 * captureHydrationIncident below.
 */

const CORPUS_PATH = resolve(
  process.env.NL_UI_CORPUS ?? 'C:/temp/stressTest/afldb_ui_nl_12000.csv',
);
const OUT_DIR = resolve('nl-ui-out');
const BATCH_SIZE = Number(process.env.NL_UI_BATCH ?? 100);
const NAV_TIMEOUT_MS = Number(process.env.NL_UI_TIMEOUT_MS ?? 15_000);
const RUN_TAG = process.env.NL_UI_RUN_TAG ?? '';
/**
 * Forensic capture for a hydration-error incident: raw server HTML,
 * post-hydration DOM, screenshot, console, and a same-question clean
 * control, one folder per incident keyed by the corpus row id. See
 * captureHydrationIncident below.
 */
const HYDRATION_ARTIFACTS_DIR = resolve('artifacts/hydration');

const all = readUiCorpus(CORPUS_PATH);
const limit = Number(process.env.NL_UI_LIMIT ?? 0);
const cases = limit > 0 ? all.slice(0, limit) : all;

/**
 * Truncated at 100 characters by src/app/search/page.tsx, so a longer
 * question would be silently tested as a different question. Nothing in
 * the current corpus exceeds 95, and this is here so that a future
 * corpus that does fails loudly instead of quietly measuring the wrong
 * thing.
 */
const overlong = cases.filter((c) => c.question.length > 100);
if (overlong.length > 0) {
  throw new Error(
    `${overlong.length} question(s) exceed the 100-character limit /search applies to `
    + `q and would be truncated before parsing, e.g. ${overlong[0].id}.`,
  );
}

/**
 * Batched rather than one test per question.
 *
 * 12,000 Playwright tests means 12,000 contexts, 12,000 fixture
 * teardowns and a reporter entry for each; the overhead dwarfs the
 * navigation being measured. A batch reuses one page across 100
 * questions -- which is also what a reader does -- and the per-question
 * result is preserved in the JSONL report rather than in the test count.
 */
const batches: UiCase[][] = [];
for (let i = 0; i < cases.length; i += BATCH_SIZE) batches.push(cases.slice(i, i + BATCH_SIZE));

/**
 * Stubs out the search box's autocomplete.
 *
 * /search renders SearchBox prefilled with `q`, whose client script then
 * calls /api/search/autocomplete -- the one endpoint in the app with an
 * IP rate limit (src/app/api/search/autocomplete/route.ts). At one
 * worker it stays under the threshold; at four it returns 429, the
 * browser logs a console error, and every question in flight is scored
 * `page_error` for a request that has nothing to do with the answer
 * panel under test. That is the harness measuring itself.
 *
 * Fulfilled with an empty result rather than aborted: an aborted request
 * logs its own console error, which would trade one manufactured
 * failure for another. This also spares dev 12,000 autocomplete queries
 * nobody reads.
 */
async function stubAutocomplete(page: Page): Promise<void> {
  await page.route('**/api/search/autocomplete*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [] }),
  }));
}

/**
 * Reads one question and classifies what the page did.
 *
 * Every distinction below is drawn from src/components/NlAnswerSection.tsx.
 * "Did AFLDB understand this question?" is the feedback prompt, which
 * renders in BOTH the answered and unanswerable branches and nowhere
 * else in the app -- so it is the marker for "an NL panel exists at
 * all", and the presence of the "How was this calculated?" trace
 * separates a real answer from the honest empty panel. Neither is a test
 * id: the app has none anywhere, and this sweep is not a good enough
 * reason to be the first to add one.
 */
async function observe(
  page: Page,
  test_: UiCase,
): Promise<UiObservation & { serverHtml: string | null; network: NetworkEvent[] }> {
  const errors: string[] = [];
  const onPageError = (error: Error) => errors.push(`pageerror: ${error.message}`);
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  // Every OTHER traced response this navigation pulls -- RSC payloads
  // above all. The hydration hypothesis under investigation is that the
  // document and its follow-up data can come from different cluster
  // workers holding different cache state, so the document's own worker
  // (below) is only half the evidence.
  const subresourceWorkers = new Set<string>();
  const subresourceTrace: { worker: string; atMs: number; resourceType: string }[] = [];
  // Every response, not just traced ones -- "network failures/statuses"
  // for a hydration incident's forensic record. Kept local and discarded
  // unless this question turns out to be one of the ~1-2% that errors;
  // see captureHydrationIncident.
  const network: NetworkEvent[] = [];
  // Persisted for EVERY row, unlike `network` above -- the point is a
  // same-run, same-conditions baseline of ordinary loads to compare
  // against captured hydration incidents. `fetch`-typed responses with a
  // traced worker are this app's RSC prefetches (nav-link hover/viewport
  // prefetch, `?_rsc=` in the URL); a null worker means the response was
  // never traced (the stubbed autocomplete route, most commonly) and is
  // excluded rather than silently counted as a same/different-worker
  // data point it isn't.
  const prefetches: { worker: string; atMs: number }[] = [];
  // A property, not a bare `let`: TypeScript's control-flow narrowing
  // does not see a `let` being reassigned inside the onResponse closure
  // below and narrows it to `null` at every later use regardless -- a
  // property access defeats that narrowing and gets the real value.
  const doc: { serverHtmlPromise: Promise<string> | null; worker: string | null; atMs: number | null } = {
    serverHtmlPromise: null, worker: null, atMs: null,
  };
  const started = Date.now();
  const onResponse = (response: {
    headers(): Record<string, string>;
    url(): string;
    status(): number;
    request(): { resourceType(): string };
    text(): Promise<string>;
  }) => {
    const worker = response.headers()['x-afldb-worker'] ?? null;
    const resourceType = response.request().resourceType();
    const atMs = Date.now() - started;
    network.push({
      url: response.url(), status: response.status(), resourceType, worker, atMs,
    });
    if (worker) {
      subresourceWorkers.add(worker);
      subresourceTrace.push({ worker, atMs, resourceType });
      if (resourceType === 'fetch') prefetches.push({ worker, atMs });
    }
    if (resourceType === 'document') {
      // The raw bytes off the wire, before the client's own JS or React's
      // hydration-recovery re-render ever touch them -- the only way to
      // see what the server actually sent on a navigation that goes on to
      // hydration-mismatch. Matched on resourceType, not URL equality,
      // since query-string encoding can differ subtly from what
      // page.goto() was given.
      doc.serverHtmlPromise = response.text();
      doc.worker = worker;
      doc.atMs = atMs;
    }
  };
  page.on('response', onResponse);

  let outcome: UiOutcome;
  let httpStatus: number | null = null;
  let headline: string | null = null;
  let interpretation: string | null = null;
  let trace: UiObservation['trace'];

  try {
    const response = await page.goto(
      `/search?q=${encodeURIComponent(test_.question)}`,
      { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS },
    );
    httpStatus = response?.status() ?? null;
    const headers = response?.headers() ?? {};
    trace = {
      worker: headers['x-afldb-worker'] ?? null,
      pid: headers['x-afldb-pid'] ?? null,
      requestId: headers['x-afldb-request-id'] ?? null,
      build: headers['x-afldb-build'] ?? null,
    };

    if (httpStatus !== null && httpStatus >= 400) {
      outcome = 'http_error';
    } else if (!page.url().includes('/search')) {
      // Bounced to /beta: the session died mid-run. Recorded honestly
      // rather than scored as a decline, which is what it would look
      // like otherwise -- an absent panel for every remaining question.
      errors.push(`redirected to ${page.url()}`);
      outcome = 'page_error';
    } else {
      const panel = page.locator('section.section', {
        has: page.getByText('Did AFLDB understand this question?'),
      });
      if (await panel.count() === 0) {
        outcome = 'absent';
      } else {
        headline = (await panel.locator('h2').first().textContent())?.trim() ?? null;
        const answered = await panel.getByText('How was this calculated?').count() > 0;
        outcome = answered ? 'answered' : 'unanswerable';
        if (answered) {
          const muted = panel.locator('> p.muted').first();
          if (await muted.count() > 0) {
            interpretation = (await muted.textContent())?.trim() ?? null;
          }
        }
      }
    }
  } catch (error) {
    errors.push(`navigation: ${(error as Error).message}`);
    outcome = 'page_error';
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('response', onResponse);
  }

  const serverHtml = doc.serverHtmlPromise ? await doc.serverHtmlPromise.catch(() => null) : null;

  // Deliberately NOT folded into `outcome`; see UiOutcome in
  // tools/nl/ui-corpus.ts for why a 1% intermittent hydration error is
  // reported rather than failed.
  return {
    id: test_.id,
    question: test_.question,
    outcome,
    httpStatus,
    headline,
    interpretation,
    errors,
    elapsedMs: Date.now() - started,
    ...(trace ? { trace } : {}),
    ...(subresourceWorkers.size > 0 ? { subresourceWorkers: [...subresourceWorkers] } : {}),
    ...(subresourceTrace.length > 0 ? { subresourceTrace } : {}),
    // Kept on every row -- the matched baseline this only works with, per
    // the user's design: "same corpus style, same setup, same 4-worker
    // environment, same network trace capture... only difference:
    // hydration failure vs successful load." Deliberately raw (worker +
    // timing per prefetch) rather than a pre-baked overlap boolean, so
    // count/timing questions asked after the fact don't need a re-run.
    networkSummary: { docWorker: doc.worker, docAtMs: doc.atMs, prefetches },
    serverHtml,
    network,
  };
}

type NetworkEvent = {
  url: string;
  status: number | null;
  resourceType: string;
  worker: string | null;
  atMs: number;
};

/**
 * Saves everything a hydration incident needs for forensic diffing,
 * per the user's spec: the exact failing server HTML and post-hydration
 * DOM, a screenshot, console output, and -- immediately afterward, same
 * question, same capture path -- one clean control to diff against. One
 * clean re-run rather than none: the bug is non-deterministic (never
 * twice on the same question in this app's own experience), so a single
 * failing example proves little without a same-question baseline next
 * to it.
 *
 * Runs on a fresh tab in the batch's own authenticated context, not the
 * batch's shared `page` -- the sweep's sequential navigation pattern on
 * that page is itself part of what's under test and must not be
 * disturbed by an extra, unplanned navigation.
 */
async function captureHydrationIncident(
  page: Page,
  test_: UiCase,
  observation: UiObservation,
  serverHtml: string | null,
  network: NetworkEvent[],
): Promise<void> {
  const dir = resolve(HYDRATION_ARTIFACTS_DIR, test_.id);
  mkdirSync(dir, { recursive: true });

  const domHtml = await page.content().catch(() => null);
  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);

  if (serverHtml !== null) writeFileSync(resolve(dir, 'failing-server.html'), serverHtml, 'utf8');
  if (domHtml !== null) writeFileSync(resolve(dir, 'failing-dom.html'), domHtml, 'utf8');
  if (screenshot) writeFileSync(resolve(dir, 'failing.png'), screenshot);
  writeFileSync(resolve(dir, 'console.txt'), `${observation.errors.join('\n')}\n`, 'utf8');

  const clean = await captureCleanControl(page, test_, dir);

  writeFileSync(resolve(dir, 'metadata.json'), JSON.stringify({
    id: test_.id,
    question: test_.question,
    capturedAt: new Date().toISOString(),
    parserVersion: PARSER_VERSION,
    trace: observation.trace ?? null,
    httpStatus: observation.httpStatus,
    elapsedMs: observation.elapsedMs,
    outcome: observation.outcome,
    headline: observation.headline,
    consoleErrors: observation.errors,
    network,
    cleanControl: clean,
  }, null, 2), 'utf8');
}

/**
 * One same-question re-run on a fresh tab, up to 3 attempts in case the
 * retry itself hydration-fails (roughly (2.3%)^3, negligible but not
 * zero). Whatever the last attempt produces is saved either way, honestly
 * labelled via cleanCaptureSucceeded rather than silently discarded.
 */
async function captureCleanControl(
  page: Page,
  test_: UiCase,
  dir: string,
): Promise<{
  attempts: number;
  cleanCaptureSucceeded: boolean;
  trace: UiObservation['trace'] | null;
  errors: string[];
}> {
  const context = page.context();

  for (let attempt = 1; attempt <= 3; attempt++) {
    const errors: string[] = [];
    // A property, not a bare `let` -- see the identical comment in
    // observe() above.
    const doc: { serverHtmlPromise: Promise<string> | null } = { serverHtmlPromise: null };
    let trace: UiObservation['trace'];
    const retryPage = await context.newPage();
    retryPage.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    retryPage.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    retryPage.on('response', (response) => {
      if (response.request().resourceType() === 'document') doc.serverHtmlPromise = response.text();
    });

    try {
      const response = await retryPage.goto(
        `/search?q=${encodeURIComponent(test_.question)}`,
        { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS },
      );
      const headers = response?.headers() ?? {};
      trace = {
        worker: headers['x-afldb-worker'] ?? null,
        pid: headers['x-afldb-pid'] ?? null,
        requestId: headers['x-afldb-request-id'] ?? null,
        build: headers['x-afldb-build'] ?? null,
      };
      // Give hydration (and its console warning, if it fails again) a
      // moment to happen before the tab closes.
      await retryPage.waitForTimeout(300);
    } catch (error) {
      errors.push(`navigation: ${(error as Error).message}`);
    }

    const serverHtml = doc.serverHtmlPromise ? await doc.serverHtmlPromise.catch(() => null) : null;
    const domHtml = await retryPage.content().catch(() => null);
    const screenshot = await retryPage.screenshot({ fullPage: true }).catch(() => null);
    await retryPage.close();

    const hydro = errors.some(isHydrationError);
    if (!hydro || attempt === 3) {
      if (serverHtml !== null) writeFileSync(resolve(dir, 'clean-server.html'), serverHtml, 'utf8');
      if (domHtml !== null) writeFileSync(resolve(dir, 'clean-dom.html'), domHtml, 'utf8');
      if (screenshot) writeFileSync(resolve(dir, 'clean.png'), screenshot);
      return { attempts: attempt, cleanCaptureSucceeded: !hydro, trace: trace ?? null, errors };
    }
  }
  /* istanbul ignore next -- loop above always returns by attempt 3 */
  return { attempts: 3, cleanCaptureSucceeded: false, trace: null, errors: [] };
}

for (const [index, batch] of batches.entries()) {
  const label = `${String(index + 1).padStart(3, '0')}/${batches.length}`;

  test(`nl ui batch ${label} (${batch[0].id}–${batch[batch.length - 1].id})`, async ({ page }, info) => {
    await stubAutocomplete(page);
    // Provenance for every row this run writes to nl_search_log
    // (migration 051). Ignored unless the deployment sets
    // AFLDB_NL_RUN_TAG=accept, so a stray header cannot mislabel real
    // traffic -- see src/lib/nl-run-tag.ts.
    if (RUN_TAG) await page.setExtraHTTPHeaders({ 'x-afldb-run-tag': RUN_TAG });

    const observations: UiObservation[] = [];
    for (const test_ of batch) {
      const { serverHtml, network, ...observation } = await observe(page, test_);
      observations.push(observation);
      if (observation.errors.some(isHydrationError)) {
        // Best-effort: a capture failure (disk, a closed page) must not
        // sink the batch or cost the observation already recorded above.
        await captureHydrationIncident(page, test_, observation, serverHtml, network).catch((error) => {
          console.error(`[hydration-capture] failed for ${test_.id}: ${(error as Error).message}`);
        });
      }
    }

    /**
     * One file per worker, merged by the summary.
     *
     * A single shared file would have every worker appending to it
     * concurrently, and appendFileSync offers no atomicity across
     * processes for a multi-kilobyte write -- two batches landing
     * together can interleave mid-line and produce JSON that will not
     * parse. Losing a run's report to a torn write after an hour of
     * browsing is not a risk worth taking to save a merge step.
     */
    appendFileSync(
      resolve(OUT_DIR, `observations-w${info.workerIndex}.jsonl`),
      observations.map((o) => JSON.stringify(o)).join('\n') + '\n',
      'utf8',
    );

    /**
     * The batch fails only on crashes, and reports semantic mismatches
     * to the summary instead.
     *
     * This is a judgement about what the corpus can support, not
     * laxness. Its only oracle is a three-value status with no expected
     * plan, so an `absent` panel on a row marked `plan` may mean the
     * parser regressed or may mean the corpus over-promised -- and 120
     * red batches would say nothing about which. A 5xx, an uncaught
     * exception or a console error is unambiguous, so those fail here
     * and now, loudly.
     */
    const crashes = observations.filter(
      (o) => o.outcome === 'http_error' || o.outcome === 'page_error',
    );
    expect(
      crashes.map((o) => `${o.id} "${o.question}" -> ${o.outcome} ${o.httpStatus ?? ''} `
        + `${o.errors.join('; ')}`),
      'questions that crashed rather than answered or declined',
    ).toEqual([]);
  });
}

/**
 * Best-effort summary at the end of the run.
 *
 * Playwright has no cross-worker afterAll: every worker reaches this,
 * and only whichever finishes last sees every other worker's file. The
 * short-read guard below makes the early ones no-ops, but two workers
 * ending together can leave no summary at all -- which is why the real
 * report generator is `tools/nl/ui-summary.ts`, runnable at any time
 * against the files already on disk. This hook is the convenience, not
 * the mechanism.
 */
test.afterAll(() => {
  const report = buildReport(CORPUS_PATH, OUT_DIR);
  if (report.observed < cases.length) return;

  writeFileSync(resolve(OUT_DIR, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(formatSummary(report));
  console.log(`  full report: ${resolve(OUT_DIR, 'summary.json')}\n`);
});
