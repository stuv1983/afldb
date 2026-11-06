// AFLDB-ISSUE-336/337 DEV acceptance through ONE owner-authenticated, headed browser (repository Playwright).
//
//   node dev-accept-headed.cjs <new-empty-out-dir> <control-dir>
//
// * Opens DEV's normal sign-in page (BASE/beta) in a headed Chromium and waits (up to 30 min) for the OWNER to authenticate there
//   (beta magic link pasted into this window, or the admin sign-in at /admin/login). The script never types, fills or submits
//   anything during sign-in, never mints a token, never touches the beta gate.
// * The authenticated state lives only in this process's memory. Cookie VALUES are never printed, logged or written; only cookie
//   NAMES are recorded. Extra viewports are new contexts built from the in-memory storageState object. Nothing is saved to disk.
// * After sign-in it runs `validate` once, then waits for command files in <control-dir>:
//     validate  - gate on for an anonymous context (3xx to /beta), authenticated GETs render (200 on their own path), /api/health.
//     accept    - the 76 ISSUE-336/337 browser checks (same as dev-preview2-20261106/scripts/shots-acceptance.cjs) at 1280x900 and
//                 390x844, plus the HTTP smoke (same routes and output as dev-preview2-20261106/scripts/smoke.sh), read-only GETs.
//     quit      - close the browser (discarding the session).
//   Each command writes <out>/<command>-<n>.json and logs a VERDICT line. Pages visited are public reading pages only; nothing is
//   clicked except the cookie-consent "Decline" button and one player link (as in the original checks).
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://10.0.40.100:8090';
const EXPECT_ALL_2021 = Number(process.env.EXPECT_ALL_2021 || 140);
const [OUT, CTRL] = process.argv.slice(2);
if (!OUT || !CTRL) { console.log('usage: node dev-accept-headed.cjs <new-out-dir> <control-dir>'); process.exit(2); }
if (fs.existsSync(OUT)) { console.log(`STOP: ${OUT} exists`); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CTRL, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser, ctx, signInPage;

async function authed() {
  const r = await ctx.request.get(`${BASE}/draft`, { maxRedirects: 0, failOnStatusCode: false, timeout: 15000 }).catch(() => null);
  return r && r.status() === 200;
}
async function cookieNames() { return (await ctx.cookies(BASE)).map((c) => c.name).sort(); }

async function validate(n) {
  const res = { command: 'validate', n, at: new Date().toISOString(), base: BASE, checks: [] };
  const check = (name, ok, detail = '') => { res.checks.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };
  const anon = await browser.newContext();
  const a = await anon.request.get(`${BASE}/draft`, { maxRedirects: 0, failOnStatusCode: false });
  check('anonymous /draft is redirected to /beta (gate on)', a.status() >= 300 && a.status() < 400 && /\/beta/.test(a.headers().location || ''), `${a.status()} ${a.headers().location || ''}`);
  await anon.close();
  for (const p of ['/draft', '/draft/2021', '/players', '/seasons/2026']) {
    const r = await ctx.request.get(BASE + p, { maxRedirects: 0, failOnStatusCode: false });
    check(`authenticated ${p} renders 200`, r.status() === 200, `${r.status()}`);
  }
  const h = await ctx.request.get(`${BASE}/api/health`, { failOnStatusCode: false });
  const hb = await h.text();
  check('/api/health 200 database ok', h.status() === 200 && /"database":"ok"/.test(hb), `${h.status()} ${hb.slice(0, 80)}`);
  res.cookieNames = await cookieNames();
  res.x_afldb_build = h.headers()['x-afldb-build'] || null;
  log(`session cookie names (values never read out): ${res.cookieNames.join(', ')}; x-afldb-build ${res.x_afldb_build}`);
  return res;
}

async function shots(n) {
  const OUTS = path.join(OUT, `screens-${n}`); fs.mkdirSync(OUTS, { recursive: true });
  const state = await ctx.storageState(); // in memory only
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };
  for (const vp of [{ tag: 'desktop', width: 1280, height: 900 }, { tag: 'mobile', width: 390, height: 844, isMobile: true }]) {
    const c = await browser.newContext({ storageState: state, viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, deviceScaleFactor: 1 });
    const page = await c.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const go = async (p, shot) => {
      const res = await page.goto(BASE + p, { waitUntil: 'load' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const onPath = !/^\/beta(\/|$)/.test(new URL(page.url()).pathname); // a lost session would land on the gate
      check(`${vp.tag} ${p} status 200, no horizontal page overflow`, res.status() === 200 && overflow <= 1 && onPath, `status ${res.status()} overflow ${overflow}px url ${new URL(page.url()).pathname}`);
      await page.waitForTimeout(400);
      const decline = await page.$('button:has-text("Decline")');
      if (decline) { await decline.click(); await page.waitForTimeout(200); }
      if (shot) await page.screenshot({ path: `${OUTS}/${vp.tag}-${shot}.png`, fullPage: false });
      return res;
    };
    const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i > 3 || !/context was destroyed/.test(String(e))) throw e; await page.waitForLoadState('load'); } } };
    const rowsOf = async () => retry(() => page.$$eval('table.draft-table tbody tr:not(.draft-group)', (trs) => trs.map((tr) => [...tr.cells].map((cell) => cell.innerText.replace(/\s+/g, ' ').trim()))));
    const firstRow = async () => (await rowsOf())[0];

    await go('/draft', 'index');
    check(`${vp.tag} index card states categories`, /National \d+ · Rookie \d+/.test(await page.innerText('main')));
    await go('/draft/2025', 'year-all');
    const groups = await page.$$eval('tr.draft-group th', (ths) => ths.map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
    check(`${vp.tag} 2025 All groups by category`, groups[0]?.toLowerCase().startsWith('national draft') && groups.length >= 1, groups.slice(0, 4).join(' | '));
    const allSel = await page.$$eval('td.draft-selection', (tds) => tds.map((t) => t.innerText.trim()));
    check(`${vp.tag} 2025 All labels each row with its category`, allSel.length > 0 && allSel.every((s) => /^(National|Rookie|Pre-Season|Mid-Season|Trade|Pre-Draft|Post-Draft|Free Agency|Mini-Draft|Training Squad)/.test(s)), allSel.slice(0, 2).join(' | '));
    await go('/draft/2025?view=rookie', 'rookie');
    let row = await firstRow();
    check(`${vp.tag} Fred Rodriguez 2025 Rookie Pick 1 West Coast`, row && row[0] === 'Pick 1' && /Fred Rodriguez/.test(row[1]) && /West Coast/.test(row[2]), JSON.stringify(row?.slice(0, 3)));
    check(`${vp.tag} rookie tab is current`, (await page.getAttribute('.draft-tab[aria-current="page"]', 'href'))?.includes('view=rookie'));
    await go('/draft/2025?view=national', 'national');
    row = await firstRow();
    check(`${vp.tag} Willem Duursma 2025 National Pick 1 West Coast`, row && row[0] === 'Pick 1' && /Willem Duursma/.test(row[1]) && /West Coast/.test(row[2]), JSON.stringify(row?.slice(0, 3)));
    await go('/draft/2021?view=father-son', 'father-son-2021');
    const fsRows = await rowsOf();
    const daicos = fsRows.find((r) => /Nick Daicos/.test(r[1]));
    check(`${vp.tag} Nick Daicos under Father–Son as National — Pick 4 — Father–Son`, daicos && daicos[0] === 'National — Pick 4 — Father–Son', JSON.stringify(daicos?.slice(0, 3)));
    const fsTab = await page.innerText('.draft-tab[aria-current="page"]');
    const allTab = await page.innerText('.draft-tab[href="/draft/2021"]');
    check(`${vp.tag} Father–Son count is a subset, All not inflated`, Number(fsTab.match(/\d+/)[0]) === fsRows.length && Number(allTab.match(/\d+/)[0]) === EXPECT_ALL_2021, `(database 2021 rows ${EXPECT_ALL_2021}) ${fsTab} / ${allTab}`);
    await go('/draft/1995?view=father-son', 'father-son-1995');
    const fs95 = await page.$$eval('td.draft-selection', (tds) => tds.map((t) => t.innerText.trim()));
    check(`${vp.tag} 1995 Father–Son Pre-Draft keeps its category`, fs95.includes('Pre-Draft — Father–Son'), fs95.join(' | '));
    await go('/draft/2014?view=rookie&q=Jake+Long', null);
    const jl = await firstRow();
    check(`${vp.tag} 2014 Father–Son Rookie keeps its category`, jl && jl[0] === 'Pick 47 — Father–Son', JSON.stringify(jl?.slice(0, 2)));
    for (const q of ['Jake%C2%A0Long', 'jake+long']) {
      await go(`/draft/2014?view=rookie&q=${q}`, q === 'jake+long' ? 'issue337-jake-long' : null);
      const r = await firstRow();
      check(`${vp.tag} ISSUE-337 q=${q} finds Rookie Pick 47 — Father–Son`, r && r[0] === 'Pick 47 — Father–Son' && /Jake.Long/.test(r[1]), JSON.stringify(r?.slice(0, 2)));
    }
    await go('/draft/2021?view=trade', 'trade-2021');
    const tr = await page.$$eval('td.draft-selection', (tds) => tds.map((t) => t.innerText.trim()));
    check(`${vp.tag} trades stay unnumbered`, tr.length > 0 && tr.every((s) => s === 'Unnumbered'), `${tr.length} rows`);
    await go('/draft/2025?view=national&sort=pick&dir=desc', 'national-pick-desc');
    const desc = await page.$$eval('td.draft-selection', (tds) => tds.map((t) => Number((t.innerText.match(/Pick (\d+)/) || [])[1])));
    check(`${vp.tag} category-specific pick sort descending`, desc.length > 1 && desc.every((v, i) => i === 0 || v <= desc[i - 1]), desc.slice(0, 3).join(','));
    await go('/draft/2025?club=west-coast&view=rookie', null);
    const wc = (await rowsOf()).map((r) => r[2]);
    check(`${vp.tag} club filter within category`, wc.length > 0 && wc.every((x) => x === 'West Coast'), `${wc.length} rows`);
    await go('/draft/2025?page=2', null);
    const p2 = await page.$$eval('td.draft-selection', (tds) => tds.length);
    const rookieHref = await page.getAttribute('.draft-tab[href*="view=rookie"]', 'href');
    check(`${vp.tag} pagination page 2 renders and the category link resets page`, p2 > 0 && !/page=/.test(rookieHref), `${p2} rows; ${rookieHref}`);
    await go('/draft/2025?view=mini-draft', 'empty-mini');
    check(`${vp.tag} empty category state`, /No Mini-Draft selections recorded for 2025/.test(await page.innerText('main')));
    await go('/draft/2025?view=rookie&q=zzzzqq', null);
    check(`${vp.tag} empty filtered state`, /No Rookie Draft selections match those filters/.test(await page.innerText('main')));
    await go('/draft/2021?type=Rookie', null);
    check(`${vp.tag} legacy ?type=Rookie opens the Rookie category`, (await page.getAttribute('.draft-tab[aria-current="page"]', 'href'))?.includes('view=rookie'));
    await go('/draft/2025?view=rookie', null);
    await Promise.all([
      page.waitForURL(/\/players\//, { waitUntil: 'load' }),
      page.click('table.draft-table tbody tr:not(.draft-group) td.wide a'),
    ]);
    const hist = await page.$$eval('#draft td.nowrap, section td.nowrap a', (els) => els.map((e) => e.innerText.trim()));
    check(`${vp.tag} player page labels Fred Rodriguez as 2025 Rookie Draft — Pick 1`, hist.includes('2025 Rookie Draft — Pick 1'), hist.slice(0, 3).join(' | '));
    await page.screenshot({ path: `${OUTS}/${vp.tag}-player-fred.png`, fullPage: true });
    check(`${vp.tag} no page errors`, errors.length === 0, errors.slice(0, 2).join(' / '));
    await c.close();
  }
  return results;
}

async function smoke() {
  const get = (p) => ctx.request.get(BASE + p, { maxRedirects: 0, failOnStatusCode: false, timeout: 60000 });
  const first = async (p, prefix) => {
    const body = await (await get(p)).text();
    const m = body.match(new RegExp(`href="(${prefix}[^"#?]+)"`)); // prefix is a regex fragment, as in smoke.sh's grep -E
    return m ? m[1] : '';
  };
  const P = await first('/draft/2025?view=rookie', '/players/'); const C = await first('/clubs', '/clubs/[a-z]');
  const M = await first('/seasons/2026', '/matches/'); const V = await first('/venues', '/venues/[a-z]');
  const R = await first('/records', '/records/[a-z]'); const CO = await first('/coaches', '/coaches/[a-z]');
  const lines = [];
  for (const p of ['/api/health', '/', '/players', P, '/clubs', C, '/clubs/compare', '/seasons', '/seasons/2026', '/seasons/2027', M, '/venues', V,
    '/records', R, '/records/father-son', '/coaches', CO, '/brownlow', '/awards', '/hall-of-fame', '/honour-teams', '/grid-solver',
    '/search?q=ablett', '/advanced-search', '/match-search', '/aflw', '/about', '/privacy', '/draft', '/draft/2014?q=Jake+Long',
    '/draft/2014?view=rookie&q=Jake+Long', '/draft/2014?view=rookie&q=Jake%C2%A0Long', '/sitemap.xml', '/robots.txt', '/admin']) {
    if (!p) { lines.push('SKIP (no link discovered)'); continue; }
    const r = await get(p); const body = await r.body(); const text = body.toString('utf8');
    const err = (text.match(/Application error|Internal Server Error|NEXT_HTTP_ERROR_FALLBACK;500/g) || []).length;
    let jake = '';
    if (/Jake/.test(p)) jake = ` jake_rows=${(text.match(/Pick 47/g) || []).length} empty_state=${(text.match(/no (selections|picks|rows|results)/gi) || []).length}`;
    lines.push(`${r.status()} bytes=${body.length} error_markers=${err}${jake} ${p}`);
  }
  return lines;
}

(async () => {
  browser = await chromium.launch({ headless: false });
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  signInPage = await ctx.newPage();
  await signInPage.goto(`${BASE}/beta`, { waitUntil: 'load' });
  log(`READY: the browser shows DEV's sign-in page (${BASE}/beta). Owner: sign in there (beta link pasted into THIS window, or /admin/login). Waiting up to 30 minutes.`);
  const deadline = Date.now() + 30 * 60 * 1000;
  while (!(await authed())) {
    if (Date.now() > deadline) { log('TIMEOUT: no authenticated session; nothing was changed'); fs.writeFileSync(path.join(OUT, 'auth.json'), JSON.stringify({ authenticated: false }) + '\n'); await browser.close(); process.exit(3); }
    await sleep(3000);
  }
  log('AUTHENTICATED');
  fs.writeFileSync(path.join(OUT, 'auth.json'), JSON.stringify({ authenticated: true, at: new Date().toISOString(), cookieNames: await cookieNames() }, null, 1) + '\n');
  const counters = {};
  const run = async (cmd) => {
    const n = (counters[cmd] = (counters[cmd] || 0) + 1);
    let out;
    if (cmd === 'validate') out = await validate(n);
    else if (cmd === 'accept') {
      const pre = await authed();
      const checks = pre ? await shots(n) : [];
      const smokeLines = pre ? await smoke() : [];
      fs.writeFileSync(path.join(OUT, `smoke-${n}.txt`), smokeLines.join('\n') + '\n');
      out = { command: 'accept', n, at: new Date().toISOString(), base: BASE, sessionStillValid: pre, checks, smoke: smokeLines };
    }
    const list = out.checks || [];
    out.verdict = list.length > 0 && list.every((c) => c.ok) && (cmd !== 'accept' || out.sessionStillValid) ? 'PASS' : 'FAIL';
    fs.writeFileSync(path.join(OUT, `${cmd}-${n}.json`), JSON.stringify(out, null, 1) + '\n');
    log(`VERDICT ${cmd}-${n} ${out.verdict} (${list.filter((c) => c.ok).length}/${list.length})`);
  };
  await run('validate');
  const stopAt = Date.now() + 11 * 3600 * 1000;
  for (;;) {
    if (Date.now() > stopAt) break;
    const files = fs.readdirSync(CTRL).filter((f) => ['validate', 'accept', 'quit'].includes(f));
    if (files.length) {
      const f = files[0]; fs.rmSync(path.join(CTRL, f));
      if (f === 'quit') break;
      try { await run(f); } catch (e) { log(`ERROR ${f}: ${String(e).slice(0, 300)}`); }
    }
    await sleep(1000);
  }
  log('closing the browser; the session is discarded');
  await browser.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(2); });
