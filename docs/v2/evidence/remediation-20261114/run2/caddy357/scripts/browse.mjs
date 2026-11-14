// caddy357: real Chromium through Caddy (55653) to the real app (55663), with the CANDIDATE Caddyfile's CSP/HSTS in force.
// For each page: load, wait for the network to settle, hover internal links (router prefetch), click one (client navigation),
// type in the search box (client fetch). Records every response; any response whose body is Caddy's "Not Found" is a deny
// that a real visitor hit (must be none), plus console errors/CSP violations, failed requests, hydration evidence.
// usage: node browse.mjs <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outdir = process.argv[2];
mkdirSync(outdir, { recursive: true });
const BASE = 'http://beta.afldb.com:55653';
const pages = ['/', '/players/scott-pendlebury-11724', '/players/scott-pendlebury-11724/matches', '/matches/16592', '/seasons/2024', '/seasons', '/brownlow/2024',
  '/clubs/carlton', '/venues/adelaide-oval', '/honour-teams/afl-vfl-team-of-the-century', '/awards', '/awards/all-australian', '/awards/all-australian/2024', '/records',
  '/records/most-games', '/players', '/clubs', '/clubs/compare', '/players/compare', '/coaches', '/aflw', '/aflw/players/Aasta_O%2527Connor', '/search?q=most+goals', '/grid-solver', '/about'];
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP beta.afldb.com 127.0.0.1'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const log = []; const denied = []; const consoleIssues = []; const failed = []; const statuses = {};
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleIssues.push(`${page.url()} [${m.type()}] ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e) => consoleIssues.push(`${page.url()} [pageerror] ${String(e).slice(0, 200)}`));
page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
page.on('response', async (r) => {
  const u = new URL(r.url()); const k = String(r.status());
  statuses[k] = (statuses[k] ?? 0) + 1;
  if (r.status() === 404 || r.status() === 400) {
    let body = ''; try { body = (await r.text()).slice(0, 40); } catch { /* ignore */ }
    if (body.startsWith('Not Found')) denied.push(`${r.status()} ${u.pathname}${u.search}`);
  }
  log.push(`${r.status()} ${r.request().method()} ${u.pathname}${u.search}`);
});
const rows = [];
for (const p of pages) {
  const start = log.length;
  let status = 0; let title = ''; let h1 = ''; let hsts = ''; let csp = ''; let scripts = 0;
  try {
    const resp = await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 60000 });
    status = resp?.status() ?? 0; hsts = resp?.headers()['strict-transport-security'] ?? ''; csp = (resp?.headers()['content-security-policy'] ?? '').slice(0, 40);
    title = await page.title(); h1 = (await page.locator('h1').first().textContent({ timeout: 3000 }).catch(() => '')) ?? '';
    scripts = await page.locator('script[src]').count();
    // hover up to 12 internal links (router prefetch), then click one that is a canonical entity link
    const links = await page.locator('a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')).filter((h) => h && !h.startsWith('/admin')).slice(0, 12));
    for (const h of links) await page.locator(`a[href="${h}"]`).first().hover({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800);
    const target = links.find((h) => /^\/(players|clubs|seasons|matches|venues)\//.test(h));
    if (target) { await page.locator(`a[href="${target}"]`).first().click({ timeout: 4000 }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); }
    const q = page.locator('input[name="q"]').first();
    if (await q.count()) { await q.fill('pendle').catch(() => {}); await page.waitForTimeout(900); }
  } catch (e) { rows.push(`${p}\tERROR ${String(e).slice(0, 100)}`); continue; }
  rows.push(`${p}\tstatus=${status}\ttitle=${JSON.stringify(title.slice(0, 50))}\th1=${JSON.stringify(h1.trim().slice(0, 40))}\tscripts=${scripts}\thsts=${hsts ? 'yes' : 'no'}\tcsp=${csp ? 'yes' : 'no'}\trequests=${log.length - start}`);
}
await page.screenshot({ path: `${outdir}/last.png` });
await browser.close();
const summary = [`pages=${pages.length} responses=${log.length} statuses=${JSON.stringify(statuses)}`, `CADDY-DENIED responses seen by the browser: ${denied.length}`, ...denied.slice(0, 20),
  `console errors/warnings: ${consoleIssues.length}`, ...consoleIssues.slice(0, 20), `failed requests: ${failed.length}`, ...failed.slice(0, 20)];
writeFileSync(`${outdir}/pages.tsv`, `${rows.join('\n')}\n`);
writeFileSync(`${outdir}/requests.txt`, `${log.join('\n')}\n`);
writeFileSync(`${outdir}/summary.txt`, `${summary.join('\n')}\n`);
console.log(rows.join('\n')); console.log(summary.join('\n'));
