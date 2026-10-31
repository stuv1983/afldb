// D-V2-PROD-EXEC-1 Stage 13 live smoke acceptance (bounded). Headed Chromium from the repository's Playwright.
// The owner signs in (credentials and MFA typed by the owner only). Records screenshots, URLs, viewports, the
// visible role, timestamps and results. Never reads or stores cookies, storage, tokens or form input; the
// context is discarded at the end. Read-only: it clicks only navigation links.
import { chromium } from 'file:///D:/dev/afldbV2/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const BASE = 'https://beta.afldb.com';
const ADMIN = ['/admin', '/admin/operations', '/admin/brownlow', '/admin/coaches', '/admin/draft', '/admin/season-lists',
  '/admin/fixtures', '/admin/awards', '/admin/records', '/admin/access', '/admin/admins', '/admin/audit', '/admin/password'];
const SUPER_ONLY = ['/admin/data-editor', '/admin/player-links', '/admin/current-season', '/admin/content', '/admin/settings',
  '/admin/query-builder', '/admin/db-health', '/admin/app-health', '/admin/nl-search', '/admin/nl-search/feedback'];
if (existsSync(OUT)) { console.log(`STOP: ${OUT} exists`); process.exit(2); }
mkdirSync(OUT);
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const results = { started: new Date().toISOString(), base: BASE, checks: [], screenshots: [] };
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
// After load: let late assets arrive, then record anything still pending (e.g. a streaming or polling request).
async function settle() {
  await page.waitForTimeout(4000);
  const pending = [...inflight.entries()].filter(([, t]) => Date.now() - t > 3000).map(([q]) => q.method() + ' ' + q.url().slice(0, 160));
  if (pending.length) { (results.pendingAfterLoad ??= []).push({ url: page.url(), pending }); log('pending after load: ' + JSON.stringify(pending)); }
}
async function shot(name, vp) {
  const f = `${String(results.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, f), fullPage: true });
  results.screenshots.push({ file: f, url: page.url(), viewport: vp, at: new Date().toISOString() });
}
const overflow = () => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

try {
  await page.goto(`${BASE}/admin/operations`);
  log('READY: the browser shows the sign-in page. Sign in with an Admin account (not Super Admin). Waiting up to 20 minutes.');
  const deadline = Date.now() + 20 * 60 * 1000; let role = '';
  for (;;) {
    if (Date.now() > deadline) throw new Error('timed out waiting for an Admin session on /admin/operations');
    await page.waitForTimeout(3000);
    const u = new URL(page.url());
    if (u.pathname !== '/admin/operations') continue;
    const t = await page.locator('p.muted', { hasText: 'Signed in as' }).first().textContent({ timeout: 2000 }).catch(() => '');
    const m = /\((Admin|Super Admin|[^)]+)\)\.?\s*$/.exec((t ?? '').trim());
    if (!m) continue;
    if (m[1] !== role) { role = m[1]; log(`visible role: ${role}`); }
    if (role === 'Admin') break;
    if (role === 'Super Admin') log('Super Admin session seen: it does not count. Sign out and sign in with an Admin account.');
  }
  results.role = role;
  reset();
  await page.reload({ waitUntil: 'load' }); await settle();
  const h1 = (await page.locator('h1').first().textContent())?.trim();
  const h2 = (await page.locator('main h2').allTextContents()).map((s) => s.trim());
  check('ops-authenticated-content', h1 === 'Operations centre' && h2.length >= 3, { url: page.url(), h1, sections: h2 });
  const hrefs = [...new Set((await page.locator('a[href^="/admin"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).map((h) => h.split('?')[0]))];
  const missing = ADMIN.filter((h) => !hrefs.includes(h)); const superSeen = SUPER_ONLY.filter((h) => hrefs.includes(h));
  check('ops-admin-navigation', missing.length === 0 && superSeen.length === 0, { missingAdminLinks: missing, superAdminOnlyLinksVisible: superSeen });
  const forms = await page.locator('main form').count(); const buttons = (await page.locator('main button').allTextContents()).map((s) => s.trim()).filter(Boolean);
  check('ops-no-mutation-controls', forms === 0, { formsOnPage: forms, buttons });
  let o = await overflow(); check('ops-desktop-no-overflow', o.scrollWidth <= o.innerWidth, { viewport: '1440x900', ...o });
  check('ops-static-and-console', badStatic.length === 0 && staticSeen.length > 0 && consoleErrors.length === 0, { staticSeen: staticSeen.length, badStatic, consoleErrors });
  await shot('operations-admin-desktop', '1440x900');
  await page.setViewportSize({ width: 390, height: 844 }); reset();
  await page.reload({ waitUntil: 'load' }); await settle();
  o = await overflow(); check('ops-mobile-no-overflow', o.scrollWidth <= o.innerWidth, { viewport: '390x844', ...o });
  check('ops-mobile-content', (await page.locator('h1').first().textContent())?.trim() === 'Operations centre', { consoleErrors, badStatic });
  await shot('operations-admin-mobile', '390x844');
  await page.setViewportSize({ width: 1440, height: 900 });

  // Two public pages through existing internal links: the site home via a link on the admin page, then
  // two different internal links from the public page.
  reset();
  const homeLink = page.locator('a[href="/"]').first();
  if (await homeLink.count()) { await homeLink.click(); } else { await page.goto(`${BASE}/`); results.homeVia = 'direct (no link to / on the admin page)'; }
  await page.waitForLoadState('load'); await settle();
  const homeUrl = page.url();
  check('public-home-past-beta-gate', !/\/beta(\?|$)|\/admin\/login/.test(homeUrl), { url: homeUrl, title: await page.title() });
  const candidates = await page.locator('header a[href^="/"], nav a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const picks = [...new Set(candidates.filter((h) => h && h !== '/' && !h.startsWith('/admin') && !h.startsWith('/beta') && !h.startsWith('/api')))].slice(0, 2);
  results.publicLinks = picks;
  for (const href of picks) {
    await page.goto(homeUrl); await page.waitForLoadState('load'); await settle(); reset();
    await page.locator(`header a[href="${href}"], nav a[href="${href}"]`).first().click();
    await page.waitForLoadState('load'); await settle();
    const u = page.url(); const ph1 = (await page.locator('h1').first().textContent().catch(() => ''))?.trim();
    const text = (await page.locator('main').first().innerText().catch(() => '')).length;
    const okUrl = !/\/beta(\?|$)|\/admin\/login/.test(u);
    check(`public-page ${href}`, okUrl && !!ph1 && text > 300 && badStatic.length === 0 && staticSeen.length > 0 && consoleErrors.length === 0,
      { url: u, h1: ph1, mainTextChars: text, staticSeen: staticSeen.length, badStatic, consoleErrors });
    o = await overflow(); check(`public-page ${href} no-overflow`, o.scrollWidth <= o.innerWidth, { viewport: '1440x900', ...o });
    await shot(`public${href.replace(/[^a-z0-9]+/gi, '-')}`, '1440x900');
  }
} catch (e) {
  check('run', false, { error: String(e).slice(0, 500) });
} finally {
  results.finished = new Date().toISOString();
  results.verdict = results.checks.length > 0 && results.checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  log(`VERDICT ${results.verdict} (${results.checks.filter((c) => c.ok).length}/${results.checks.length})`);
  await context.close(); await browser.close();
}
