/**
 * D-316-12 local visual evidence (STATIC RENDER, not the authenticated live page). Local only.
 *   node node_modules/tsx/dist/cli.mjs docs/v2/evidence/d31612-wording-20261102/static-render.mts <new-output-dir>
 * Renders the REAL AflApiSettleUnitsPanel component and the page subtitle text read from the REAL page.tsx,
 * inside a minimal admin-like shell, with the project's own CSS (globals, themes, layouts), then captures
 * 1280x800 and 390x844. It does NOT render src/app/admin/current-season/page.tsx (that needs the database and a
 * Super Admin session), so the live page remains VISUAL: UNVERIFIED until the release is deployed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import { AflApiSettleUnitsPanel } from '@/app/admin/current-season/AflApiSettleUnitsPanel';

const [outDir] = process.argv.slice(2);
if (!outDir || existsSync(outDir)) throw new Error('usage: static-render.mts <new-output-dir> (must not exist)');
mkdirSync(outDir, { recursive: true });

const page = readFileSync('src/app/admin/current-season/page.tsx', 'utf8');
const m = page.match(/<p className="subtitle">([\s\S]*?)<\/p>/);
if (!m) throw new Error('subtitle not found in page.tsx');
const subtitle = m[1].replace(/\s+/g, ' ').trim();

const idle = { loadState: 'loaded', phase: 'idle', activeState: 'inactive', subState: 'dead', result: 'success', exitStatus: 0,
  activeEnterTimestamp: '', inactiveEnterTimestamp: '' };
const units = {
  afltables: { unit: idle, unitError: null, latestRun: null, latestRunError: null },
  afl_api: { unit: idle, unitError: null, latestRunError: null, latestRun: { batchId: '32', snapshotLabel: 'afl-api-2026-2026-09-25-235854',
    season: 2026, status: 'completed', startedAt: '2026-09-28 07:00:00+10', completedAt: '2026-09-28 07:12:53+10', recordsRead: 10417, recordsRejected: 0, counters: null } },
  afl_api_brownlow: { unit: idle, unitError: null, latestRunError: null, latestRun: { batchId: '74', snapshotLabel: null,
    season: 2025, status: 'completed', startedAt: '2026-11-02 14:17:42+11', completedAt: '2026-11-02 14:18:18+11', recordsRead: 207, recordsRejected: 0, counters: null } },
};
const panel = renderToStaticMarkup(createElement(AflApiSettleUnitsPanel, { units: units as never, error: null }));
const css = ['globals', 'themes', 'layouts'].map((n) => readFileSync(`src/styles/${n}.css`, 'utf8')).join('\n');
const html = `<!doctype html><html lang="en-AU" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body><main id="main" class="container"><div class="page-header"><h1>Current season</h1><p class="subtitle">${subtitle}</p></div>${panel}</main></body></html>`;
writeFileSync(`${outDir}/static.html`, html);

const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport] of [['desktop-1280x800', { width: 1280, height: 800 }], ['mobile-390x844', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport });
    const p = await ctx.newPage();
    await p.setContent(html);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await p.screenshot({ path: `${outDir}/current-season-copy__${name}.png`, fullPage: true });
    console.log(`${name}: horizontal overflow=${overflow}`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log('subtitle:', subtitle);
