// AFLDB-ISSUE-336/337 browser checks (BASE, tunnelled; EXPECT_ALL_2021 from the target database). Same 68 checks as the first
// preview's shots-preview.cjs, plus ISSUE-337 (the 2014 search typed with an ordinary space, a U+00A0 and lower case). Usable for
// DEV acceptance: DEV keeps its beta gate on, so BETA_COOKIE (the value of an `afldb_beta` cookie the owner already holds) is
// added to each browser context when set; it is never printed or written.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:33362';
const BETA_COOKIE = process.env.BETA_COOKIE || '';
const EXPECT_ALL_2021 = Number(process.env.EXPECT_ALL_2021);
if (!Number.isInteger(EXPECT_ALL_2021)) throw new Error('EXPECT_ALL_2021 required');
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ tag: 'desktop', width: 1280, height: 900 }, { tag: 'mobile', width: 390, height: 844, isMobile: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, deviceScaleFactor: 1 });
    if (BETA_COOKIE) await ctx.addCookies([{ name: 'afldb_beta', value: BETA_COOKIE, url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const go = async (path, shot) => {
      const res = await page.goto(BASE + path, { waitUntil: 'load' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${vp.tag} ${path} status 200, no horizontal page overflow`, res.status() === 200 && overflow <= 1, `status ${res.status()} overflow ${overflow}px`);
      await page.waitForTimeout(400);
      const decline = await page.$('button:has-text("Decline")');
      if (decline) { await decline.click(); await page.waitForTimeout(200); }
      if (shot) await page.screenshot({ path: `${OUT}/${vp.tag}-${shot}.png`, fullPage: false });
      return res;
    };
    const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i > 3 || !/context was destroyed/.test(String(e))) throw e; await page.waitForLoadState('load'); } } };
    const norm = (x) => x.replace(/\s+/g, ' ').trim();
    const rowsOf = async () => retry(() => page.$$eval('table.draft-table tbody tr:not(.draft-group)', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText.replace(/\s+/g, ' ').trim()))));
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
    // AFLDB-ISSUE-337: the same pick whichever space the reader types, and in lower case.
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
    check(`${vp.tag} club filter within category`, wc.length > 0 && wc.every((c) => c === 'West Coast'), `${wc.length} rows`);

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
    // Wait for the navigation itself: `waitForLoadState` alone can resolve on the draft page before the click navigates.
    await Promise.all([
      page.waitForURL(/\/players\//, { waitUntil: 'load' }),
      page.click('table.draft-table tbody tr:not(.draft-group) td.wide a'),
    ]);
    const hist = await page.$$eval('#draft td.nowrap, section td.nowrap a', (els) => els.map((e) => e.innerText.trim()));
    check(`${vp.tag} player page labels Fred Rodriguez as 2025 Rookie Draft — Pick 1`, hist.includes('2025 Rookie Draft — Pick 1'), hist.slice(0, 3).join(' | '));
    await page.screenshot({ path: `${OUT}/${vp.tag}-player-fred.png`, fullPage: true });

        check(`${vp.tag} no page errors`, errors.length === 0, errors.slice(0, 2).join(' / '));
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`TOTAL ${results.length} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
