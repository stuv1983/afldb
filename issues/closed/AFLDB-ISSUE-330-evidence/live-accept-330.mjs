// AFLDB-ISSUE-330 D4 live acceptance of /players?sort=games. Headed Chromium from the repository's Playwright,
// modelled on the Stage 13 runner (docs/v2/evidence/production-execution-20261030/.../live-accept.mjs).
// The owner signs in (credentials and MFA typed by the owner only). Never reads or stores cookies, storage,
// tokens or form input; the context is discarded at the end. Read-only: it only navigates.
//
//   node issues/open/AFLDB-ISSUE-330-evidence/live-accept-330.mjs <new-empty-evidence-dir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const BASE = 'https://beta.afldb.com';
const TARGET = '/players?sort=games';
const LEADER = { name: 'Scott Pendlebury', games: 442 };      // issues.md: "Scott Pendlebury now leads on 442"
const CAREERLESS = ['Riley Onley', 'Fred Rodriguez'];          // D-V2-PROD-EXEC-1 Stage 13 observation 2
if (!OUT) { console.log('usage: node live-accept-330.mjs <new-empty-evidence-dir>'); process.exit(2); }
if (existsSync(OUT)) { console.log(`STOP: ${OUT} exists`); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const results = { started: new Date().toISOString(), base: BASE, target: TARGET, checks: [], screenshots: [] };
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
const inflight = new Map();
page.on('request', (q) => inflight.set(q, Date.now()));
page.on('requestfinished', (q) => inflight.delete(q)); page.on('requestfailed', (q) => inflight.delete(q));
// Pending requests after load are recorded as information only (the prefetch observation is not a defect).
async function settle() {
  await page.waitForTimeout(4000);
  const pending = [...inflight.entries()].filter(([, t]) => Date.now() - t > 3000).map(([q]) => q.method() + ' ' + q.url().slice(0, 160));
  if (pending.length) (results.pendingAfterLoad ??= []).push({ url: page.url(), pending });
}
async function shot(name, vp) {
  const f = `${String(results.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, f), fullPage: true });
  results.screenshots.push({ file: f, url: page.url(), viewport: vp, at: new Date().toISOString() });
}
const overflow = () => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

// The rendered table: header texts and each row's name and games, from textContent (not innerText, which
// returns CSS-uppercased text).
async function table() {
  return page.evaluate(() => {
    const t = document.querySelector('main table');
    if (!t) return null;
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const gi = heads.findIndex((h) => /^games/i.test(h));
    const rows = [...t.querySelectorAll('tbody tr')].map((tr) => {
      const td = [...tr.querySelectorAll('td')];
      return { name: td[0]?.textContent.trim() ?? '', games: Number((td[gi]?.textContent ?? '').replace(/[^0-9]/g, '')) };
    });
    return { heads, gamesColumn: gi, rows };
  });
}

function sortChecks(prefix, tb) {
  const rows = tb?.rows ?? [];
  const first = rows[0] ?? {};
  const games = rows.map((r) => r.games);
  const descending = games.every((g, i) => i === 0 || games[i - 1] >= g);
  const zero = rows.filter((r) => r.games === 0).map((r) => r.name);
  const careerless = rows.filter((r) => CAREERLESS.some((n) => r.name.includes(n))).map((r) => r.name);
  check(`${prefix} first-row-leader`, rows.length > 0 && first.name.includes(LEADER.name) && first.games === LEADER.games,
    { first, expected: LEADER, rowCount: rows.length, gamesColumn: tb?.gamesColumn });
  check(`${prefix} page-1-descending`, rows.length > 1 && descending, { first5: rows.slice(0, 5), last: rows.at(-1) });
  check(`${prefix} no-careerless-players`, careerless.length === 0, { found: careerless });
  check(`${prefix} no-zero-game-rows`, zero.length === 0, { zeroRows: zero });
}

try {
  await page.goto(`${BASE}/admin/operations`);
  log('READY: the browser shows the sign-in page. Sign in (any role). Waiting up to 15 minutes.');
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

  reset();
  await page.goto(`${BASE}${TARGET}`, { waitUntil: 'load' }); await settle();
  const u = new URL(page.url());
  const h1 = (await page.locator('h1').first().textContent().catch(() => ''))?.trim();
  check('desktop players-page-authenticated', u.pathname === '/players' && h1 === 'Players', { url: page.url(), h1 });
  sortChecks('desktop', await table());
  let o = await overflow(); check('desktop no-overflow', o.scrollWidth <= o.innerWidth, { viewport: '1440x900', ...o });
  check('desktop static-and-console', badStatic.length === 0 && staticSeen.length > 0 && consoleErrors.length === 0,
    { staticSeen: staticSeen.length, badStatic, consoleErrors });
  await shot('players-sort-games-desktop', '1440x900');

  await page.setViewportSize({ width: 390, height: 844 }); reset();
  await page.reload({ waitUntil: 'load' }); await settle();
  sortChecks('mobile', await table());
  o = await overflow(); check('mobile no-overflow', o.scrollWidth <= o.innerWidth, { viewport: '390x844', ...o });
  check('mobile static-and-console', badStatic.length === 0 && staticSeen.length > 0 && consoleErrors.length === 0,
    { staticSeen: staticSeen.length, badStatic, consoleErrors });
  await shot('players-sort-games-mobile', '390x844');
} catch (e) {
  check('run', false, { error: String(e).slice(0, 500) });
} finally {
  results.finished = new Date().toISOString();
  results.verdict = results.checks.length > 0 && results.checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  log(`VERDICT ${results.verdict} (${results.checks.filter((c) => c.ok).length}/${results.checks.length})`);
  await context.close(); await browser.close();
}
