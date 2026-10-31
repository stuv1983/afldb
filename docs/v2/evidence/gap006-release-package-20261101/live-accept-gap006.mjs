// V2-GAP-006 editor protections: authenticated, READ-ONLY live acceptance on https://beta.afldb.com.
// Headed Chromium from the repository's Playwright, modelled on issues/closed/AFLDB-ISSUE-330-evidence/live-accept-330.mjs.
// The owner signs in (credentials and MFA typed by the owner only). The script only NAVIGATES: it never fills, clicks,
// submits or posts anything, never reads or stores cookies, storage, tokens or form input, and discards the context at
// the end. Every page it opens must therefore leave production data unchanged.
//
//   node docs/v2/evidence/gap006-release-package-20261101/live-accept-gap006.mjs <new-empty-evidence-dir> [--match-id <id>]
//
// What it proves (rendering only; the refusal behaviour itself is proved on real PostgreSQL in the integration suites and
// the visual journeys, and is deliberately NOT exercised live because that needs a write against production data):
//   - the signed-in visible role is Super Admin;
//   - each audited editor page renders the shared private correction-note control with its rule text and 2000-character cap;
//   - 200, no horizontal overflow at 1440x900 and 390x844, no bad static assets, no console errors.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const OUT = args[0];
const mi = args.indexOf('--match-id');
const MATCH_ID = mi >= 0 ? args[mi + 1] : null;
const BASE = 'https://beta.afldb.com';
// Mirrors CORRECTION_NOTE_HINT in src/components/admin/CorrectionNoteField.tsx.
const HINT = 'Required when this changes a sealed (completed) season: 20-2000 characters saying what is being corrected and the evidence. Optional for the current season.';
const PAGES = [
  ['award-winner-new', '/admin/awards/winners/new'],
  ['draft-new-pick', '/admin/draft/new'],
  ['first-kick-goal-new', '/admin/records/first-kick-goal/new'],
  ...(MATCH_ID ? [['data-editor-match', `/admin/data-editor?entity=matches&id=${encodeURIComponent(MATCH_ID)}`]] : []),
];
const INFO_PAGES = [['season-lists', '/admin/season-lists'], ['player-links', '/admin/player-links']]; // screenshot only

if (!OUT) { console.log('usage: node live-accept-gap006.mjs <new-empty-evidence-dir> [--match-id <id>]'); process.exit(2); }
if (existsSync(OUT)) { console.log(`STOP: ${OUT} exists`); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const results = { started: new Date().toISOString(), base: BASE, pages: PAGES.map(([n, p]) => `${n} ${p}`), checks: [], screenshots: [] };
const check = (id, ok, detail) => { results.checks.push({ id, ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail)}`); };

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let consoleErrors = []; let badStatic = []; let staticSeen = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('response', (r) => {
  const u = r.url();
  if (u.startsWith(`${BASE}/_next/static/`) && /\.(js|css)(\?|$)/.test(u)) {
    staticSeen.push(u);
    const ct = r.headers()['content-type'] ?? '';
    const want = /\.css(\?|$)/.test(u) ? 'text/css' : 'javascript';
    if (r.status() !== 200 || !ct.includes(want)) badStatic.push(`${r.status()} ${ct} ${u}`);
  }
});
const reset = () => { consoleErrors = []; badStatic = []; staticSeen = []; };
async function shot(name, vp) {
  const f = `${String(results.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, f), fullPage: true });
  results.screenshots.push({ file: f, url: page.url(), viewport: vp, at: new Date().toISOString() });
}
const overflow = () => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

async function noteControl() {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.correction-note')];
    return boxes.map((b) => {
      const ta = b.querySelector('textarea');
      const hint = b.querySelector('span.muted');
      const label = b.querySelector('label');
      return {
        label: label?.textContent.trim() ?? '',
        name: ta?.getAttribute('name') ?? '',
        maxLength: ta?.getAttribute('maxlength') ?? '',
        hint: hint?.textContent.trim() ?? '',
        associated: !!ta && !!label && label.getAttribute('for') === ta.id,
      };
    });
  });
}

async function visit(name, path, vp) {
  reset();
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const status = response?.status() ?? 0;
  const controls = await noteControl();
  check(`${vp} ${name} status-200`, status === 200 && new URL(page.url()).pathname === path.split('?')[0], { status, url: page.url() });
  check(`${vp} ${name} correction-note-control`,
    controls.length >= 1 && controls.every((c) => c.hint === HINT && c.maxLength === '2000' && c.associated),
    { count: controls.length, first: controls[0] ?? null });
  const o = await overflow();
  check(`${vp} ${name} no-overflow`, o.scrollWidth <= o.innerWidth, o);
  check(`${vp} ${name} static-and-console`, badStatic.length === 0 && staticSeen.length > 0 && consoleErrors.length === 0,
    { staticSeen: staticSeen.length, badStatic, consoleErrors });
  await shot(`${name}-${vp}`, vp);
}

try {
  await page.goto(`${BASE}/admin/operations`);
  log('READY: the browser shows the sign-in page. Sign in as the super admin. Waiting up to 15 minutes.');
  const deadline = Date.now() + 15 * 60 * 1000; let role = '';
  for (;;) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a signed-in session on /admin/operations');
    await page.waitForTimeout(3000);
    if (new URL(page.url()).pathname !== '/admin/operations') continue;
    const t = await page.locator('p.muted', { hasText: 'Signed in as' }).first().textContent({ timeout: 2000 }).catch(() => '');
    const m = /\(([^)]+)\)\.?\s*$/.exec((t ?? '').trim());
    if (m) { role = m[1]; break; }
  }
  results.role = role; log(`visible role: ${role}`);
  check('role-super-admin', /super\s*admin/i.test(role), { role });

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [name, path] of PAGES) await visit(name, path, '1440x900');
  for (const [name, path] of INFO_PAGES) {
    reset(); const r = await page.goto(`${BASE}${path}`, { waitUntil: 'load' }); await page.waitForTimeout(3000);
    const controls = await noteControl();
    log(`INFO ${name}: status ${r?.status()} correction-note controls ${controls.length} (screenshot only; not a pass/fail gate)`);
    results.info = [...(results.info ?? []), { name, status: r?.status() ?? 0, controls: controls.length }];
    await shot(`${name}-info-1440x900`, '1440x900');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of PAGES) await visit(name, path, '390x844');
} catch (e) {
  check('run', false, { error: String(e).slice(0, 500) });
} finally {
  results.finished = new Date().toISOString();
  results.verdict = results.checks.length > 0 && results.checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  log(`VERDICT ${results.verdict} (${results.checks.filter((c) => c.ok).length}/${results.checks.length})`);
  await context.close(); await browser.close();
}
