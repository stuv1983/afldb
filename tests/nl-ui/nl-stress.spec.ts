import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page, type Request } from '@playwright/test';

import { PARSER_VERSION } from '../../src/search/nl/plan';
import {
  isHydrationError, readUiCorpus, type UiAnswerShape, type UiCase, type UiObservation, type UiOutcome,
  type UiHydrationProbe, type UiRscSummary,
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
const probedPages = new WeakSet<Page>();

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

async function installHydrationProbe(page: Page): Promise<void> {
  if (probedPages.has(page)) return;
  probedPages.add(page);
  await page.addInitScript(() => {
    type ProbeSnapshot = {
      atMs: number;
      readyState: string;
      htmlAttrs: Record<string, string>;
      bodyAttrs: Record<string, string>;
      searchBoxIds: {
        labelFor: string | null;
        inputId: string | null;
        controls: string | null;
        activeDescendant: string | null;
      };
      feedbackForms: {
        action: string | null;
        method: string | null;
        hiddenNames: string[];
        actionRef: string | null;
        actionKey: string | null;
        clientRef: string | null;
        buttonTexts: string[];
        fingerprint: string;
        parentFingerprint: string | null;
      }[];
      searchBoxFingerprint: string | null;
      searchBoxParentFingerprint: string | null;
      searchSubtreeFingerprint: string | null;
      firstMutation: {
        atMs: number;
        target: string;
        type: string;
        attributeName: string | null;
        oldValue: string | null;
        newValue: string | null;
        nodePath: string;
        parentFingerprint: string | null;
        hydrationErrorAlreadyEmitted: boolean;
      } | null;
    };
    type Probe = {
      startedAt: number;
      marks: { name: string; atMs: number }[];
      mutations: {
        atMs: number;
        target: string;
        type: string;
        attributeName: string | null;
        oldValue: string | null;
        newValue: string | null;
        nodePath: string;
        parentFingerprint: string | null;
        hydrationErrorAlreadyEmitted: boolean;
      }[];
      hydrationErrorSeen: boolean;
      documentStart: ProbeSnapshot | null;
      domContentLoaded: ProbeSnapshot | null;
      hydrationError: ProbeSnapshot | null;
      final: ProbeSnapshot | null;
    };
    const win = window as typeof window & { __afldbHydrationProbe?: Probe };
    const startedAt = performance.now();
    const atMs = () => Math.round(performance.now() - startedAt);
    let observer: MutationObserver | null = null;
    const attrs = (element: Element | null): Record<string, string> => {
      const out: Record<string, string> = {};
      if (!element) return out;
      for (const attr of Array.from(element.attributes)) out[attr.name] = attr.value;
      return out;
    };
    const normalId = (value: string | null) => {
      if (!value) return null;
      return value
        .replace(/_R_[A-Za-z0-9_-]+_/g, '_R_*_')
        .replace(/_r_[A-Za-z0-9_-]+_/g, '_r_*_')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, 'uuid');
    };
    const nodePath = (node: Node | null) => {
      const parts: string[] = [];
      let current: Node | null = node;
      while (current && current !== document && parts.length < 8) {
        if (current.nodeType === Node.ELEMENT_NODE) {
          const element = current as Element;
          const parent = element.parentElement;
          const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === element.tagName) : [];
          const index = siblings.indexOf(element) + 1;
          parts.push(`${element.tagName.toLowerCase()}${element.id ? `#${normalId(element.id)}` : ''}${index > 1 ? `:nth(${index})` : ''}`);
        } else {
          parts.push(current.nodeType === Node.TEXT_NODE ? '#text' : `#node-${current.nodeType}`);
        }
        current = current.parentNode;
      }
      return parts.reverse().join('>');
    };
    const fingerprint = (root: Element | null, depth = 4): string | null => {
      if (!root) return null;
      const walk = (node: Node, level: number): string => {
        if (node.nodeType === Node.TEXT_NODE) return '#text';
        if (node.nodeType === Node.COMMENT_NODE) return '#comment';
        if (node.nodeType !== Node.ELEMENT_NODE) return `#node-${node.nodeType}`;
        const element = node as Element;
        const attrParts: string[] = [];
        for (const name of ['id', 'for', 'name', 'type', 'role', 'aria-controls', 'aria-expanded', 'aria-autocomplete', 'action', 'method']) {
          const value = element.getAttribute(name);
          if (value !== null) attrParts.push(`${name}=${normalId(value)}`);
        }
        if (element instanceof HTMLInputElement) {
          attrParts.push(`value=${normalId(element.value) ?? ''}`);
          attrParts.push(`defaultValue=${normalId(element.defaultValue) ?? ''}`);
        }
        if (element instanceof HTMLTextAreaElement) attrParts.push(`value-len=${element.value.length}`);
        const head = `${element.tagName.toLowerCase()}${attrParts.length ? `[${attrParts.join(',')}]` : ''}`;
        if (level >= depth) return head;
        const children = Array.from(element.childNodes)
          .filter((child) => child.nodeType !== Node.TEXT_NODE || child.textContent?.trim())
          .slice(0, 80)
          .map((child) => walk(child, level + 1));
        return `${head}${children.length ? `(${children.join('|')})` : ''}`;
      };
      return walk(root, 0);
    };
    const snapshot = (): ProbeSnapshot => {
      if (observer) {
        try {
          for (const mutation of observer.takeRecords()) rememberMutation(mutation);
        } catch {
          // Probe-only.
        }
      }
      const input = document.querySelector('form.search-form input[name="q"]');
      const label = document.querySelector('form.search-form label');
      const searchForm = document.querySelector('form.search-form');
      const searchRoot = document.querySelector('main .container');
      const feedbackForms = Array.from(document.querySelectorAll('form'))
        .filter((form) => form.querySelector('input[name="clientRef"]'))
        .map((form) => {
          const hidden = Array.from(form.querySelectorAll('input[type="hidden"]')) as HTMLInputElement[];
          return {
            action: form.getAttribute('action'),
            method: form.getAttribute('method'),
            hiddenNames: hidden.map((input_) => input_.name).filter(Boolean),
            actionRef: (form.querySelector('input[name="$ACTION_REF_1"]') as HTMLInputElement | null)?.value ?? null,
            actionKey: (form.querySelector('input[name="$ACTION_KEY"]') as HTMLInputElement | null)?.value ?? null,
            clientRef: (form.querySelector('input[name="clientRef"]') as HTMLInputElement | null)?.value ?? null,
            buttonTexts: Array.from(form.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? ''),
            fingerprint: fingerprint(form, 5) ?? '',
            parentFingerprint: fingerprint(form.parentElement, 3),
          };
        });
      return {
        atMs: atMs(),
        readyState: document.readyState,
        htmlAttrs: attrs(document.documentElement),
        bodyAttrs: attrs(document.body),
        searchBoxIds: {
          labelFor: label?.getAttribute('for') ?? null,
          inputId: input?.getAttribute('id') ?? null,
          controls: input?.getAttribute('aria-controls') ?? null,
          activeDescendant: input?.getAttribute('aria-activedescendant') ?? null,
        },
        feedbackForms,
        searchBoxFingerprint: fingerprint(searchForm, 5),
        searchBoxParentFingerprint: fingerprint(searchForm?.parentElement ?? null, 3),
        searchSubtreeFingerprint: fingerprint(searchRoot, 4),
        firstMutation: probe.mutations[0] ?? null,
      };
    };
    const probe: Probe = {
      startedAt,
      marks: [{ name: 'document-start-probe', atMs: 0 }],
      mutations: [],
      hydrationErrorSeen: false,
      documentStart: null,
      domContentLoaded: null,
      hydrationError: null,
      final: null,
    };
    win.__afldbHydrationProbe = probe;
    const mark = (name: string) => probe.marks.push({ name, atMs: atMs() });
    const rememberMutation = (mutation: MutationRecord) => {
      if (probe.mutations.length >= 80) return;
      const target = mutation.target === document.documentElement
        ? 'html'
        : mutation.target === document.body
          ? 'body'
          : (mutation.target as Element).tagName?.toLowerCase?.() ?? 'node';
      const element = mutation.target instanceof Element ? mutation.target : null;
      probe.mutations.push({
        atMs: atMs(),
        target,
        type: mutation.type,
        attributeName: mutation.attributeName,
        oldValue: mutation.oldValue,
        newValue: mutation.attributeName && element ? element.getAttribute(mutation.attributeName) : null,
        nodePath: nodePath(mutation.target),
        parentFingerprint: fingerprint(element?.parentElement ?? null, 2),
        hydrationErrorAlreadyEmitted: probe.hydrationErrorSeen,
      });
    };
    try {
      probe.documentStart = snapshot();
    } catch {
      probe.documentStart = null;
    }
    try {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) rememberMutation(mutation);
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeOldValue: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class', 'style', 'data-theme', 'id', 'for', 'aria-controls', 'aria-activedescendant', 'action'],
      });
    } catch {
      // Probe-only; page behaviour must not depend on it.
    }
    document.addEventListener('DOMContentLoaded', () => {
      mark('domcontentloaded');
      try {
        probe.domContentLoaded = snapshot();
      } catch {
        probe.domContentLoaded = null;
      }
    }, { once: true });
    window.addEventListener('load', () => {
      mark('load');
    }, { once: true });
    window.addEventListener('error', (event) => {
      const message = String(event.error?.message ?? event.message ?? '');
      if (/minified react error #(418|419|420|421|422|423|424|425)\b/i.test(message)
        || message.toLowerCase().includes('hydration')) {
        probe.hydrationErrorSeen = true;
        mark('hydration-error');
        try {
          probe.hydrationError = snapshot();
        } catch {
          probe.hydrationError = null;
        }
      }
    }, true);
  });
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
  previous: PreviousObservation | null,
): Promise<UiObservation & { serverHtml: string | null; network: NetworkEvent[]; rscRequests: RscRequest[] }> {
  await installHydrationProbe(page);
  const errors: string[] = [];
  const clientEvents: ClientEvent[] = [];
  const onPageError = (error: Error) => {
    const atMs = Date.now() - started;
    const text = `pageerror: ${error.message}`;
    errors.push(text);
    clientEvents.push({ kind: 'pageerror', text, atMs });
  };
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() !== 'error') return;
    const atMs = Date.now() - started;
    const text = `console: ${message.text()}`;
    errors.push(text);
    clientEvents.push({ kind: 'console', text, atMs });
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
  const rscRequests: RscRequest[] = [];
  const rscByRequest = new Map<Request, RscRequest>();
  let requestSeq = 0;
  let completionSeq = 0;
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
  const onRequest = (request: Request) => {
    if (!isRscUrl(request.url())) return;
    const path = pathWithSearch(request.url());
    const rsc: RscRequest = {
      url: request.url(),
      path,
      kind: classifyRequestKind(request),
      resourceType: request.resourceType(),
      startSeq: ++requestSeq,
      startAtMs: Date.now() - started,
      completionSeq: null,
      responseAtMs: null,
      finishAtMs: null,
      failureAtMs: null,
      status: null,
      worker: null,
      pid: null,
      requestId: null,
      build: null,
      failureText: null,
      linkClass: classifyRscPath(path),
    };
    rscByRequest.set(request, rsc);
    rscRequests.push(rsc);
  };
  const onResponse = (response: {
    headers(): Record<string, string>;
    url(): string;
    status(): number;
    request(): Request;
    text(): Promise<string>;
  }) => {
    const worker = response.headers()['x-afldb-worker'] ?? null;
    const pid = response.headers()['x-afldb-pid'] ?? null;
    const requestId = response.headers()['x-afldb-request-id'] ?? null;
    const build = response.headers()['x-afldb-build'] ?? null;
    const resourceType = response.request().resourceType();
    const atMs = Date.now() - started;
    network.push({
      url: response.url(), status: response.status(), resourceType, worker, pid, requestId, build, atMs,
    });
    const rsc = rscByRequest.get(response.request());
    if (rsc) {
      rsc.responseAtMs = atMs;
      rsc.status = response.status();
      rsc.worker = worker;
      rsc.pid = pid;
      rsc.requestId = requestId;
      rsc.build = build;
    }
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
  const onRequestFinished = (request: Request) => {
    const rsc = rscByRequest.get(request);
    if (!rsc) return;
    rsc.finishAtMs = Date.now() - started;
    rsc.completionSeq = ++completionSeq;
  };
  const onRequestFailed = (request: Request) => {
    const rsc = rscByRequest.get(request);
    if (!rsc) return;
    rsc.failureAtMs = Date.now() - started;
    rsc.completionSeq = ++completionSeq;
    rsc.failureText = request.failure()?.errorText ?? null;
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFailed);

  let outcome: UiOutcome;
  let httpStatus: number | null = null;
  let headline: string | null = null;
  let interpretation: string | null = null;
  let trace: UiObservation['trace'];
  let firstVisibleResultAtMs: number | null = null;

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
        firstVisibleResultAtMs = Date.now() - started;
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
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfinished', onRequestFinished);
    page.off('requestfailed', onRequestFailed);
  }

  const serverHtml = doc.serverHtmlPromise ? await doc.serverHtmlPromise.catch(() => null) : null;
  const hydrationErrorAtMs = clientEvents.find((event) => isHydrationError(event.text))?.atMs ?? null;
  const answerShape = await readAnswerShape(page, outcome, headline, interpretation).catch(() => null);
  const hydrationProbe = await readHydrationProbe(page).catch(() => null);
  const timingSummary = summarizeTiming(network, rscRequests, hydrationProbe, hydrationErrorAtMs, firstVisibleResultAtMs);
  const rscSummary = summarizeRscRequests(
    rscRequests,
    hydrationErrorAtMs,
    { worker: trace?.worker ?? doc.worker, pid: trace?.pid ?? null, build: trace?.build ?? null },
  );

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
    ...(answerShape ? { answerShape } : {}),
    previous,
    clientEvents,
    ...(hydrationProbe ? { hydrationProbe } : {}),
    timingSummary,
    rscSummary,
    serverHtml,
    network,
    rscRequests,
  };
}

function summarizeTiming(
  network: NetworkEvent[],
  rscRequests: RscRequest[],
  hydrationProbe: UiHydrationProbe | null,
  hydrationErrorAtMs: number | null,
  firstVisibleResultAtMs: number | null,
): UiObservation['timingSummary'] {
  const markAt = (name: string) => hydrationProbe?.marks.find((mark) => mark.name === name)?.atMs ?? null;
  const scriptResponses = network
    .filter((event) => event.resourceType === 'script' && event.url.includes('/_next/static/'))
    .map((event) => event.atMs);
  const firstRsc = rscRequests.length > 0
    ? Math.min(...rscRequests.map((request) => request.startAtMs))
    : null;
  return {
    navigationStartAtMs: 0,
    domContentLoadedAtMs: markAt('domcontentloaded'),
    firstApplicationScriptResponseAtMs: scriptResponses.length > 0 ? Math.min(...scriptResponses) : null,
    hydrationErrorAtMs,
    firstRscRequestAtMs: firstRsc,
    firstVisibleResultAtMs,
    loadAtMs: markAt('load'),
  };
}

async function readHydrationProbe(page: Page): Promise<UiHydrationProbe | null> {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __afldbHydrationProbe?: UiHydrationProbe & { startedAt: number };
    };
    const probe = win.__afldbHydrationProbe;
    if (!probe) return null;
    const attrs = (element: Element | null): Record<string, string> => {
      const out: Record<string, string> = {};
      if (!element) return out;
      for (const attr of Array.from(element.attributes)) out[attr.name] = attr.value;
      return out;
    };
    const normalId = (value: string | null) => {
      if (!value) return null;
      return value
        .replace(/_R_[A-Za-z0-9_-]+_/g, '_R_*_')
        .replace(/_r_[A-Za-z0-9_-]+_/g, '_r_*_')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, 'uuid');
    };
    const fingerprint = (root: Element | null, depth = 4): string | null => {
      if (!root) return null;
      const walk = (node: Node, level: number): string => {
        if (node.nodeType === Node.TEXT_NODE) return '#text';
        if (node.nodeType === Node.COMMENT_NODE) return '#comment';
        if (node.nodeType !== Node.ELEMENT_NODE) return `#node-${node.nodeType}`;
        const element = node as Element;
        const attrParts: string[] = [];
        for (const name of ['id', 'for', 'name', 'type', 'role', 'aria-controls', 'aria-expanded', 'aria-autocomplete', 'action', 'method']) {
          const value = element.getAttribute(name);
          if (value !== null) attrParts.push(`${name}=${normalId(value)}`);
        }
        if (element instanceof HTMLInputElement) {
          attrParts.push(`value=${normalId(element.value) ?? ''}`);
          attrParts.push(`defaultValue=${normalId(element.defaultValue) ?? ''}`);
        }
        if (element instanceof HTMLTextAreaElement) attrParts.push(`value-len=${element.value.length}`);
        const head = `${element.tagName.toLowerCase()}${attrParts.length ? `[${attrParts.join(',')}]` : ''}`;
        if (level >= depth) return head;
        const children = Array.from(element.childNodes)
          .filter((child) => child.nodeType !== Node.TEXT_NODE || child.textContent?.trim())
          .slice(0, 80)
          .map((child) => walk(child, level + 1));
        return `${head}${children.length ? `(${children.join('|')})` : ''}`;
      };
      return walk(root, 0);
    };
    const input = document.querySelector('form.search-form input[name="q"]');
    const label = document.querySelector('form.search-form label');
    const searchForm = document.querySelector('form.search-form');
    const searchRoot = document.querySelector('main .container');
    const feedbackForms = Array.from(document.querySelectorAll('form'))
      .filter((form) => form.querySelector('input[name="clientRef"]'))
      .map((form) => {
        const hidden = Array.from(form.querySelectorAll('input[type="hidden"]')) as HTMLInputElement[];
        return {
          action: form.getAttribute('action'),
          method: form.getAttribute('method'),
          hiddenNames: hidden.map((input_) => input_.name).filter(Boolean),
          actionRef: (form.querySelector('input[name="$ACTION_REF_1"]') as HTMLInputElement | null)?.value ?? null,
          actionKey: (form.querySelector('input[name="$ACTION_KEY"]') as HTMLInputElement | null)?.value ?? null,
          clientRef: (form.querySelector('input[name="clientRef"]') as HTMLInputElement | null)?.value ?? null,
          buttonTexts: Array.from(form.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? ''),
          fingerprint: fingerprint(form, 5) ?? '',
          parentFingerprint: fingerprint(form.parentElement, 3),
        };
      });
    probe.final = {
      atMs: Math.round(performance.now() - probe.startedAt),
      readyState: document.readyState,
      htmlAttrs: attrs(document.documentElement),
      bodyAttrs: attrs(document.body),
      searchBoxIds: {
        labelFor: label?.getAttribute('for') ?? null,
        inputId: input?.getAttribute('id') ?? null,
        controls: input?.getAttribute('aria-controls') ?? null,
        activeDescendant: input?.getAttribute('aria-activedescendant') ?? null,
      },
      feedbackForms,
      searchBoxFingerprint: fingerprint(searchForm, 5),
      searchBoxParentFingerprint: fingerprint(searchForm?.parentElement ?? null, 3),
      searchSubtreeFingerprint: fingerprint(searchRoot, 4),
      firstMutation: probe.mutations[0] ?? null,
    };
    return {
      marks: probe.marks,
      mutations: probe.mutations,
      documentStart: probe.documentStart,
      domContentLoaded: probe.domContentLoaded,
      hydrationError: probe.hydrationError,
      final: probe.final,
    };
  });
}

type NetworkEvent = {
  url: string;
  status: number | null;
  resourceType: string;
  worker: string | null;
  pid: string | null;
  requestId: string | null;
  build: string | null;
  atMs: number;
};

type ClientEvent = {
  kind: 'console' | 'pageerror';
  text: string;
  atMs: number;
};

type PreviousObservation = {
  id: string;
  question: string;
  answerShape: UiAnswerShape | null;
};

type RscRequest = {
  url: string;
  path: string;
  kind: 'navigation' | 'automatic_prefetch' | 'user_triggered';
  resourceType: string;
  startSeq: number;
  startAtMs: number;
  completionSeq: number | null;
  responseAtMs: number | null;
  finishAtMs: number | null;
  failureAtMs: number | null;
  status: number | null;
  worker: string | null;
  pid: string | null;
  requestId: string | null;
  build: string | null;
  failureText: string | null;
  linkClass: 'home_about' | 'answer_result' | 'search' | 'other';
};

function isRscUrl(url: string): boolean {
  return url.includes('_rsc=');
}

function pathWithSearch(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function classifyRequestKind(request: Request): RscRequest['kind'] {
  if (request.isNavigationRequest()) return 'navigation';
  return request.resourceType() === 'fetch' ? 'automatic_prefetch' : 'user_triggered';
}

function classifyRscPath(path: string): RscRequest['linkClass'] {
  const pathname = path.split('?')[0];
  if (pathname === '/' || pathname === '/about') return 'home_about';
  if (pathname === '/search') return 'search';
  if (/^\/(players|matches|clubs|seasons|records|grid-solver)\b/.test(pathname)) return 'answer_result';
  return 'other';
}

async function readAnswerShape(
  page: Page,
  outcome: UiOutcome,
  headline: string | null,
  interpretation: string | null,
): Promise<UiAnswerShape | null> {
  const panel = page.locator('section.section', {
    has: page.getByText('Did AFLDB understand this question?'),
  });
  if (await panel.count() === 0) {
    return {
      outcome,
      headline,
      interpretation,
      tableTitle: null,
      tableNote: null,
      columnHeaders: [],
      rowCount: 0,
      linkPaths: [],
    };
  }

  const summary = panel.locator('details summary').filter({ hasNotText: 'How was this calculated?' }).first();
  const tableTitle = await summary.count() > 0 ? (await summary.textContent())?.trim() ?? null : null;
  /**
   * count()-guarded, exactly like tableTitle above and the panel guard at
   * the top of this function. NlAnswerSection's unanswerable branch renders
   * no <details> at all, and an unguarded textContent() auto-waits for an
   * element that can never attach -- unbounded, because Playwright Test's
   * default actionTimeout is 0 and the only backstop is the 30-minute
   * per-batch timeout, which discards the whole batch's observations.
   */
  const note = panel.locator('details .muted').first();
  const tableNote = await note.count() > 0 ? await note.textContent().catch(() => null) : null;
  const columnHeaders = await panel.locator('table thead th').evaluateAll((nodes) => (
    nodes.map((node) => node.textContent?.trim() ?? '').filter(Boolean)
  ));
  const rowCount = await panel.locator('table tbody tr').count();
  const linkPaths = await panel.locator('a').evaluateAll((nodes) => {
    const paths: string[] = [];
    for (const node of nodes) {
      const href = node.getAttribute('href');
      if (!href) continue;
      try {
        const url = new URL(href, window.location.origin);
        paths.push(`${url.pathname}${url.search}`);
      } catch {
        paths.push(href);
      }
    }
    return paths;
  });

  return {
    outcome,
    headline,
    interpretation,
    tableTitle,
    tableNote: tableNote?.trim() ?? null,
    columnHeaders,
    rowCount,
    linkPaths: [...new Set(linkPaths)].slice(0, 50),
  };
}

function summarizeRscRequests(
  rscRequests: RscRequest[],
  hydrationErrorAtMs: number | null,
  doc: { worker: string | null; pid: string | null; build: string | null },
): UiRscSummary {
  const cutoff = hydrationErrorAtMs ?? Number.POSITIVE_INFINITY;
  const before = rscRequests.filter((request) => request.startAtMs <= cutoff);
  const responseBuilds = [...new Set([
    doc.build,
    ...rscRequests.map((request) => request.build),
  ].filter((value): value is string => Boolean(value)))];
  const crossCandidates = before
    .map((request) => request.worker)
    .filter((worker): worker is string => Boolean(worker));
  const crossWorkerRsc = !doc.worker || crossCandidates.length === 0
    ? null
    : crossCandidates.some((worker) => worker !== doc.worker);

  return {
    hydrationErrorAtMs,
    cutoffReason: hydrationErrorAtMs === null ? 'observation_window' : 'hydration_error',
    docWorker: doc.worker,
    docPid: doc.pid,
    docBuild: doc.build,
    responseBuilds,
    rscStartedBeforeCutoff: before.length,
    concurrentRscBeforeCutoff: maxConcurrent(before),
    hasHomeOrAboutRsc: before.some((request) => request.linkClass === 'home_about'),
    hasAnswerResultLinkRsc: before.some((request) => request.linkClass === 'answer_result'),
    crossWorkerRsc,
    pathsBeforeCutoff: before.map((request) => request.path),
  };
}

function maxConcurrent(requests: RscRequest[]): number {
  const events: { atMs: number; delta: 1 | -1 }[] = [];
  for (const request of requests) {
    events.push({ atMs: request.startAtMs, delta: 1 });
    const end = request.finishAtMs ?? request.failureAtMs ?? request.responseAtMs;
    if (end !== null) events.push({ atMs: end, delta: -1 });
  }
  events.sort((a, b) => a.atMs - b.atMs || b.delta - a.delta);
  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.delta;
    if (current > max) max = current;
  }
  return max;
}

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
  rscRequests: RscRequest[],
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
    previous: observation.previous ?? null,
    answerShape: observation.answerShape ?? null,
    consoleErrors: observation.errors,
    clientEvents: observation.clientEvents ?? [],
    hydrationProbe: observation.hydrationProbe ?? null,
    timingSummary: observation.timingSummary ?? null,
    rscSummary: observation.rscSummary ?? null,
    rscRequests,
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
  answerShape: UiAnswerShape | null;
  rscSummary: UiRscSummary | null;
  hydrationProbe: UiHydrationProbe | null;
  rscRequests: RscRequest[];
}> {
  const context = page.context();

  for (let attempt = 1; attempt <= 3; attempt++) {
    const retryPage = await context.newPage();
    await stubAutocomplete(retryPage);
    if (RUN_TAG) await retryPage.setExtraHTTPHeaders({ 'x-afldb-run-tag': RUN_TAG });

    let observation: UiObservation & { serverHtml: string | null; rscRequests: RscRequest[] };
    try {
      const { network: _network, ...observed } = await observe(retryPage, test_, null);
      observation = observed;
      await retryPage.waitForTimeout(300);
    } catch (error) {
      observation = {
        id: test_.id,
        question: test_.question,
        outcome: 'page_error',
        httpStatus: null,
        headline: null,
        interpretation: null,
        errors: [`navigation: ${(error as Error).message}`],
        elapsedMs: 0,
        previous: null,
        serverHtml: null,
        rscRequests: [],
      };
    }

    const domHtml = await retryPage.content().catch(() => null);
    const screenshot = await retryPage.screenshot({ fullPage: true }).catch(() => null);
    await retryPage.close();

    const hydro = observation.errors.some(isHydrationError);
    if (!hydro || attempt === 3) {
      if (observation.serverHtml !== null) writeFileSync(resolve(dir, 'clean-server.html'), observation.serverHtml, 'utf8');
      if (domHtml !== null) writeFileSync(resolve(dir, 'clean-dom.html'), domHtml, 'utf8');
      if (screenshot) writeFileSync(resolve(dir, 'clean.png'), screenshot);
      return {
        attempts: attempt,
        cleanCaptureSucceeded: !hydro,
        trace: observation.trace ?? null,
        errors: observation.errors,
        answerShape: observation.answerShape ?? null,
        rscSummary: observation.rscSummary ?? null,
        hydrationProbe: observation.hydrationProbe ?? null,
        rscRequests: observation.rscRequests,
      };
    }
  }
  /* istanbul ignore next -- loop above always returns by attempt 3 */
  return {
    attempts: 3,
    cleanCaptureSucceeded: false,
    trace: null,
    errors: [],
    answerShape: null,
    rscSummary: null,
    hydrationProbe: null,
    rscRequests: [],
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
    let previous: PreviousObservation | null = null;
    for (const test_ of batch) {
      const { serverHtml, network, rscRequests, ...observation } = await observe(page, test_, previous);
      observations.push(observation);
      if (observation.errors.some(isHydrationError)) {
        // Best-effort: a capture failure (disk, a closed page) must not
        // sink the batch or cost the observation already recorded above.
        await captureHydrationIncident(page, test_, observation, serverHtml, network, rscRequests).catch((error) => {
          console.error(`[hydration-capture] failed for ${test_.id}: ${(error as Error).message}`);
        });
      }
      previous = {
        id: observation.id,
        question: observation.question,
        answerShape: observation.answerShape ?? null,
      };
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
