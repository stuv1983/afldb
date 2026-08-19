import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * Admin navigation timing diagnostic.
 *
 * Symptom under investigation: clicking an admin nav link appears to do
 * nothing for a noticeable pause, then the destination suddenly appears.
 *
 * The instrument clicks REAL sidebar links (never page.goto) so the
 * measurement path is the App Router client navigation a human uses.
 * For every click it captures:
 *
 *   t0            click issued (Node clock)
 *   firstMutation first DOM mutation after the click (page clock, mapped)
 *   rscStart/rscFirstByte/rscEnd   the navigation's RSC fetch
 *   urlChange     framenavigated (URL/pathname commit)
 *   contentReady  destination h1 present under the new pathname
 *   docRequest    whether a full document request happened (MPA fallback)
 *   hydration     any React hydration console error during the nav
 *
 * The headline metric is click -> first *visible* change, because the
 * symptom is "it looked like nothing happened".
 */

const OUT_DIR = resolve('artifacts/admin-nav');

/** Super-admin sidebar inventory, from src/app/admin/nav-model.ts. */
const ROUTES = [
  '/admin',
  '/admin/upload',
  '/admin/query-builder',
  '/admin/player-links',
  '/admin/data-editor',
  '/admin/db-health',
  '/admin/app-health',
  '/admin/nl-search',
  '/admin/nl-search/feedback',
  '/admin/access',
  '/admin/admins',
  '/admin/content',
  '/admin/settings',
  '/admin/password',
];

const ROUNDS = 3;

type NavSample = {
  round: number;
  from: string;
  to: string;
  clickToFirstMutationMs: number | null;
  clickToRscStartMs: number | null;
  rscTtfbMs: number | null;
  rscDurationMs: number | null;
  clickToUrlChangeMs: number | null;
  clickToContentMs: number;
  fullDocumentNav: boolean;
  duplicateRscRequests: number;
  hydrationErrors: string[];
  consoleErrors: string[];
  mutationTargets: string[];
};

function isHydrationError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('hydration')
    || lower.includes('did not match')
    || /minified react error #(418|419|420|421|422|423|424|425)\b/.test(lower);
}

function shuffle<T>(arr: T[], seedRound: number): T[] {
  // Deterministic per round so runs are comparable: simple LCG.
  const out = [...arr];
  let s = 987654321 + seedRound * 2654435761;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Arm a MutationObserver and a performance.now/Date.now pairing in the page. */
async function armProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Probe = { armedAt: number; firstMutationAt: number | null; targets: string[] };
    const w = window as unknown as { __navProbe?: Probe; __navObserver?: MutationObserver };
    w.__navObserver?.disconnect();
    const probe: Probe = { armedAt: performance.now(), firstMutationAt: null, targets: [] };
    w.__navProbe = probe;
    const obs = new MutationObserver((records) => {
      if (probe.firstMutationAt === null) probe.firstMutationAt = performance.now();
      for (const r of records.slice(0, 3)) {
        if (probe.targets.length < 8) {
          const t = r.target as Element;
          probe.targets.push(`${r.type}:${t.nodeName?.toLowerCase() ?? '?'}${(t as Element).className ? '.' + String((t as Element).className).split(' ')[0] : ''}`);
        }
      }
    });
    obs.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
    w.__navObserver = obs;
  });
}

async function navigateAndMeasure(
  page: Page,
  round: number,
  from: string,
  to: string,
): Promise<NavSample> {
  const consoleErrors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  };
  const onPageError = (e: Error) => consoleErrors.push(`pageerror: ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  const rsc: { start: number; firstByte: number | null; end: number | null }[] = [];
  let docRequests = 0;
  const started = () => Date.now();
  let t0 = 0;

  const onRequest = (req: { url(): string; resourceType(): string }) => {
    const url = req.url();
    if (req.resourceType() === 'document') docRequests += 1;
    if (url.includes('_rsc=')) rsc.push({ start: Date.now() - t0, firstByte: null, end: null });
  };
  const onResponse = (res: { url(): string }) => {
    if (res.url().includes('_rsc=')) {
      const open = rsc.find((r) => r.firstByte === null);
      if (open) open.firstByte = Date.now() - t0;
    }
  };
  const onFinished = (req: { url(): string }) => {
    if (req.url().includes('_rsc=')) {
      const open = rsc.find((r) => r.end === null);
      if (open) open.end = Date.now() - t0;
    }
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onFinished);

  let urlChangeAt: number | null = null;
  const onFrameNav = (frame: { url(): string }) => {
    if (urlChangeAt === null && frame.url().includes(to)) urlChangeAt = Date.now() - t0;
  };
  page.on('framenavigated', onFrameNav);

  await armProbe(page);
  const link = page.locator(`.admin-nav a[href="${to}"], nav a[href="${to}"], a[href="${to}"]`).first();
  await expect(link).toBeVisible();

  t0 = started();
  await link.click();

  // Settled: pathname committed AND an h1 is present in the new document state.
  await page.waitForFunction(
    (target) => location.pathname === target && !!document.querySelector('main h1, h1'),
    to,
    { timeout: 60_000, polling: 16 },
  );
  const contentAt = Date.now() - t0;

  // Pull the probe: map page-perf timestamps onto the Node t0 axis.
  const probe = await page.evaluate(() => {
    const w = window as unknown as {
      __navProbe?: { armedAt: number; firstMutationAt: number | null; targets: string[] };
      __navObserver?: MutationObserver;
    };
    w.__navObserver?.disconnect();
    return { probe: w.__navProbe ?? null, nowPerf: performance.now(), nowDate: Date.now() };
  });
  let firstMutationMs: number | null = null;
  if (probe.probe?.firstMutationAt != null) {
    const perfToEpoch = probe.nowDate - probe.nowPerf;
    firstMutationMs = Math.round(probe.probe.firstMutationAt + perfToEpoch - t0);
  }

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('request', onRequest);
  page.off('response', onResponse);
  page.off('requestfinished', onFinished);
  page.off('framenavigated', onFrameNav);

  const first = rsc[0];
  return {
    round,
    from,
    to,
    clickToFirstMutationMs: firstMutationMs,
    clickToRscStartMs: first ? first.start : null,
    rscTtfbMs: first && first.firstByte !== null ? first.firstByte - first.start : null,
    rscDurationMs: first && first.end !== null ? first.end - first.start : null,
    clickToUrlChangeMs: urlChangeAt,
    clickToContentMs: contentAt,
    fullDocumentNav: docRequests > 0,
    duplicateRscRequests: Math.max(0, rsc.length - 1),
    hydrationErrors: consoleErrors.filter(isHydrationError),
    consoleErrors: consoleErrors.filter((e) => !isHydrationError(e)),
    mutationTargets: probe.probe?.targets ?? [],
  };
}

test('admin navigation timing sweep', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = resolve(OUT_DIR, 'timings.jsonl');
  writeFileSync(outFile, '');

  await page.goto('/admin');
  await expect(page.locator('h1').first()).toBeVisible();

  const samples: NavSample[] = [];
  let current = '/admin';
  for (let round = 1; round <= ROUNDS; round++) {
    for (const target of shuffle(ROUTES, round)) {
      if (target === current) continue;
      const sample = await navigateAndMeasure(page, round, current, target);
      samples.push(sample);
      appendFileSync(outFile, JSON.stringify(sample) + '\n');
      current = target;
      await page.waitForTimeout(250);
    }
  }

  // Console summary: per-destination medians of the headline metrics.
  const byRoute = new Map<string, NavSample[]>();
  for (const s of samples) {
    byRoute.set(s.to, [...(byRoute.get(s.to) ?? []), s]);
  }
  const med = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  console.log('\nADMIN NAV TIMINGS (medians, ms) — click->feedback | click->rscStart | rsc ttfb | rsc total | click->url | click->content | n');
  for (const [route, ss] of [...byRoute.entries()].sort(
    (a, b) => (med(b[1].map((s) => s.clickToContentMs)) ?? 0) - (med(a[1].map((s) => s.clickToContentMs)) ?? 0),
  )) {
    console.log(
      `${route.padEnd(28)} ${String(med(ss.map((s) => s.clickToFirstMutationMs))).padStart(6)} | `
      + `${String(med(ss.map((s) => s.clickToRscStartMs))).padStart(5)} | `
      + `${String(med(ss.map((s) => s.rscTtfbMs))).padStart(6)} | `
      + `${String(med(ss.map((s) => s.rscDurationMs))).padStart(6)} | `
      + `${String(med(ss.map((s) => s.clickToUrlChangeMs))).padStart(5)} | `
      + `${String(med(ss.map((s) => s.clickToContentMs))).padStart(6)} | ${ss.length}`,
    );
  }
  const fullDocs = samples.filter((s) => s.fullDocumentNav).length;
  const hydro = samples.filter((s) => s.hydrationErrors.length > 0).length;
  const dupes = samples.filter((s) => s.duplicateRscRequests > 0).length;
  console.log(`\nfull-document navs: ${fullDocs}/${samples.length}`);
  console.log(`navs with hydration errors: ${hydro}/${samples.length}`);
  console.log(`navs with duplicate RSC requests: ${dupes}/${samples.length}`);
  console.log(`raw samples: ${outFile}`);
});

/**
 * Visual pass: time-lapse screenshots of the slowest known-heavy route,
 * to show exactly what a human sees between click and content. Kept
 * separate from the timing pass so screenshot cost cannot perturb the
 * timing numbers above.
 */
test('admin navigation visual capture (db-health)', async ({ page }) => {
  const dir = resolve(OUT_DIR, 'visual-db-health');
  mkdirSync(dir, { recursive: true });

  await page.goto('/admin');
  await expect(page.locator('h1').first()).toBeVisible();

  const link = page.locator('a[href="/admin/db-health"]').first();
  await expect(link).toBeVisible();
  await page.screenshot({ path: resolve(dir, 't-000-before.png') });

  const t0 = Date.now();
  await link.click();
  for (const at of [100, 300, 750, 1500, 3000]) {
    const wait = t0 + at - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    if (page.url().includes('/admin/db-health')
      && await page.locator('h1').count() > 0
      && await page.evaluate(() => location.pathname) === '/admin/db-health') {
      // Content may already be there; screenshot anyway to show it.
    }
    await page.screenshot({ path: resolve(dir, `t-${String(at).padStart(3, '0')}ms.png`) });
  }
  await page.waitForFunction(
    () => location.pathname === '/admin/db-health' && !!document.querySelector('h1'),
    undefined,
    { timeout: 60_000 },
  );
  const settled = Date.now() - t0;
  await page.screenshot({ path: resolve(dir, `t-settled-${settled}ms.png`) });
  console.log(`db-health settled after ${settled}ms; screenshots in ${dir}`);
});
