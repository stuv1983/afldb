// Release 17822b29, block B: signed-in browser observations (Visual Evidence Mandate). WORKSTATION, the owner present.
// Read-only GETs through the public edge. Headed Chromium opens /beta; the OWNER signs in there (beta sign-in); the runner polls
// until /brownlow/2026 answers 200 without a redirect, copies that session into fresh desktop (1280x800) and mobile (390x844)
// contexts, and checks, per viewport:
//   /brownlow/2026  HTTP 200, not bounced to /beta (pathname test: ERRATA of the 13 Nov runner), document title exact, robots meta
//                   "noindex, nofollow", "Won by Nick Daicos with 47 votes", 14 visible "Recorded ineligible" badges, no horizontal
//                   overflow, no rendered error text
//   /seasons/2026   HTTP 200, not bounced, title exact, robots meta, no overflow, no rendered error text
//   /brownlow/2099  HTTP 404 with the title "Page not found | AFLDB" (genuine not-found control)
//   each UNACCEPTED year from P1 (argument): HTTP 404 with the not-found title (ISSUE-367 live control; omitted when "none")
// plus no page errors and no console errors per viewport; then an anonymous context proves the beta gate still redirects
// /brownlow/2026 and /seasons/2026 (307 to /beta?from=...). Screenshots and result.json go to OUT; the session is discarded.
// Run (workstation, a Node 22 on PATH or by full path; Playwright from the primary checkout's install):
//   node r1-browser.cjs <UNACCEPTED_YEARS|none>
// Output: VERDICT PASS n/n | VERDICT FAIL; tool failure prints STOP and exits 2 => record VISUAL: UNVERIFIED (never a silent pass).
// Rehearsal seam (refused unless R1_BROWSER_BASE is http://127.0.0.1:<port>): R1_BROWSER_BASE, R1_BROWSER_COOKIE (pre-minted
// cookie instead of the owner's sign-in), R1_HEADLESS=1, R1_PLAYWRIGHT (module path), R1_BROWSER_OUT.
'use strict';
const fs = require('fs'), path = require('path');
const BASE = process.env.R1_BROWSER_BASE || 'https://beta.afldb.com';
const LOCAL = /^http:\/\/127\.0\.0\.1:\d+$/.test(BASE);
if (BASE !== 'https://beta.afldb.com' && !LOCAL) { console.error('STOP bad R1_BROWSER_BASE'); process.exit(2); }
if (!LOCAL && (process.env.R1_BROWSER_COOKIE || process.env.R1_HEADLESS)) { console.error('STOP rehearsal seams are refused against production'); process.exit(2); }
const unaccArg = process.argv[2];
if (!/^(none|\d{4}(,\d{4})*)$/.test(unaccArg || '')) { console.error('STOP usage: node r1-browser.cjs <UNACCEPTED_YEARS|none>'); process.exit(2); }
const UNACC = unaccArg === 'none' ? [] : unaccArg.split(',');
const { chromium } = require(process.env.R1_PLAYWRIGHT || 'D:/dev/afldb/node_modules/@playwright/test');
const OUT = process.env.R1_BROWSER_OUT || 'D:/dev/afldb/.local-r1-browser-20261124';
fs.mkdirSync(OUT, { recursive: true });
const T_BROWNLOW = '2026 Brownlow Medal — Winner, Votes & Leaderboard | AFLDB';
const T_SEASON = '2026 AFL Season — Ladder, Results & Finals | AFLDB';
const T_404 = 'Page not found | AFLDB';
const checks = []; let browser;
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + detail); };
const bounced = (page) => new URL(page.url()).pathname === '/beta';
(async () => {
  browser = await chromium.launch({ headless: !!process.env.R1_HEADLESS });
  let state;
  if (LOCAL && process.env.R1_BROWSER_COOKIE) {
    const [name, ...rest] = process.env.R1_BROWSER_COOKIE.split('=');
    state = { cookies: [{ name, value: rest.join('='), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] };
    console.log('AUTHENTICATED (rehearsal cookie)');
  } else {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const signin = await ctx.newPage(); await signin.goto(BASE + '/beta');
    console.log('READY: owner, sign in through /beta in this window. Waiting up to 15 minutes.');
    let ok = false; const until = Date.now() + 15 * 60 * 1000;
    while (Date.now() < until) {
      const r = await ctx.request.get(BASE + '/brownlow/2026', { maxRedirects: 0 });
      if (r.status() === 200) { ok = true; break; }
      await new Promise((res) => setTimeout(res, 3000));
    }
    if (!ok) throw Error('sign-in timed out; session discarded');
    console.log('AUTHENTICATED');
    state = await ctx.storageState(); await ctx.close();
  }
  for (const vp of [{ tag: 'desktop', width: 1280, height: 800 }, { tag: 'mobile', width: 390, height: 844, isMobile: true }]) {
    const c = await browser.newContext({ storageState: state, viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile });
    const page = await c.newPage(); const errors = [], consoleErrors = [];
    // While an EXPECTED 404 page is open, Chromium's own "Failed to load resource ... 404" line for that document is not an error.
    let expect404 = false;
    page.on('pageerror', (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (expect404 && /Failed to load resource: the server responded with a status of 404/.test(m.text())) return;
      consoleErrors.push(`${new URL(page.url()).pathname}: ${m.text()}`);
    });
    const look = async (p, title, status, shot) => {
      expect404 = status === 404;
      const resp = await page.goto(BASE + p, { waitUntil: 'load' });
      const decline = page.getByRole('button', { name: 'Decline', exact: true }); if (await decline.count()) await decline.click();
      check(`${vp.tag} ${p} HTTP ${status}, not bounced`, resp.status() === status && !bounced(page), `${resp.status()} ${new URL(page.url()).pathname}`);
      const t = await page.title(); check(`${vp.tag} ${p} title`, t === title, t);
      await page.screenshot({ path: path.join(OUT, `${vp.tag}-${shot}.png`), fullPage: false });
      return resp;
    };
    const pageChecks = async (p) => {
      const robots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null);
      check(`${vp.tag} ${p} robots meta`, robots === 'noindex, nofollow', String(robots));
      const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
      check(`${vp.tag} ${p} no rendered error`, !/Application error|Internal Server Error|Something went wrong/.test(text));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${vp.tag} ${p} no horizontal overflow`, overflow <= 1, String(overflow));
      return text;
    };
    await look('/brownlow/2026', T_BROWNLOW, 200, 'brownlow-2026');
    const bt = await pageChecks('/brownlow/2026');
    check(`${vp.tag} /brownlow/2026 winner sentence`, bt.includes('Won by Nick Daicos with 47 votes'));
    const badges = await page.locator('.badge.badge-warn', { hasText: 'Recorded ineligible' }).count();
    check(`${vp.tag} /brownlow/2026 14 ineligible badges`, badges === 14, String(badges));
    await page.screenshot({ path: path.join(OUT, `${vp.tag}-brownlow-2026-full.png`), fullPage: true });
    await look('/seasons/2026', T_SEASON, 200, 'seasons-2026');
    await pageChecks('/seasons/2026');
    await look('/brownlow/2099', T_404, 404, 'brownlow-2099');
    for (const y of UNACC) await look(`/brownlow/${y}`, T_404, 404, `brownlow-${y}`);
    check(`${vp.tag} no page errors`, errors.length === 0, JSON.stringify(errors));
    check(`${vp.tag} no console errors`, consoleErrors.length === 0, JSON.stringify(consoleErrors));
    await c.close();
  }
  const anon = await browser.newContext();
  for (const p of ['/brownlow/2026', '/seasons/2026']) {
    const r = await anon.request.get(BASE + p, { maxRedirects: 0 });
    const loc = r.headers().location || '';
    check('anonymous beta gate preserved ' + p, r.status() === 307 && new URL(loc, BASE).pathname === '/beta' && new URL(loc, BASE).searchParams.get('from') === p, `${r.status()} ${loc}`);
  }
  await anon.close();
  const result = { at: new Date().toISOString(), base: BASE, viewports: ['1280x800', '390x844'], unaccepted: UNACC, checks, verdict: checks.every((x) => x.ok) ? 'PASS' : 'FAIL' };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log('VERDICT ' + result.verdict + ' ' + checks.filter((x) => x.ok).length + '/' + checks.length + ' (screenshots in ' + OUT + ')');
  await browser.close(); console.log('Browser closed; session discarded.');
  process.exitCode = result.verdict === 'PASS' ? 0 : 1;
})().catch(async (e) => { console.error('STOP ' + String(e) + ' => record VISUAL: UNVERIFIED'); if (browser) await browser.close(); process.exitCode = 2; });
