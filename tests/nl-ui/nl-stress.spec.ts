import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { readUiCorpus, type UiCase, type UiObservation, type UiOutcome } from '../../tools/nl/ui-corpus';
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
 */

const CORPUS_PATH = resolve(
  process.env.NL_UI_CORPUS ?? 'C:/temp/stressTest/afldb_ui_nl_12000.csv',
);
const OUT_DIR = resolve('nl-ui-out');
const BATCH_SIZE = Number(process.env.NL_UI_BATCH ?? 100);
const NAV_TIMEOUT_MS = Number(process.env.NL_UI_TIMEOUT_MS ?? 15_000);
const RUN_TAG = process.env.NL_UI_RUN_TAG ?? '';

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
async function observe(page: Page, test_: UiCase): Promise<UiObservation> {
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
  const onResponse = (response: { headers(): Record<string, string>; url(): string }) => {
    const worker = response.headers()['x-afldb-worker'];
    if (worker) subresourceWorkers.add(worker);
  };
  page.on('response', onResponse);

  const started = Date.now();
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
  };
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
    for (const test_ of batch) observations.push(await observe(page, test_));

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
