// Read-only public inspection of Brownlow pages on beta.afldb.com. The owner types the access code in the headed window.
const { createRequire } = require('module');
const req = createRequire('D:/dev/afldb/package.json');
const { chromium } = req('playwright');
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const log = (m) => { const l = new Date().toISOString() + ' ' + m; console.log(l); fs.appendFileSync(path.join(OUT, 'progress.log'), l + '\n'); };
const PAGES = [
  ['brownlow-index', '/brownlow'],
  ['brownlow-2025', '/brownlow/2025'],
  ['brownlow-2024', '/brownlow/2024'],
  ['brownlow-2012', '/brownlow/2012'],
  ['brownlow-2003', '/brownlow/2003'],
  ['brownlow-1996', '/brownlow/1996'],
  ['awards-index', '/awards'],
  ['player-matt-rowell', '/players/matt-rowell-9235'],
  ['player-nick-daicos', '/players/nick-daicos-9910'],
  ['player-toby-greene', '/players/toby-greene-12446'],
  ['player-shannon-neale', '/players/shannon-neale-11831'],
  ['player-ollie-wines', '/players/ollie-wines-10130'],
];
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), { headless: false, viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://beta.afldb.com/brownlow', { waitUntil: 'domcontentloaded' });
  log('opened; waiting for the owner to pass the access gate (up to 30 minutes)');
  const deadline = Date.now() + 30 * 60 * 1000; let passed = false;
  while (Date.now() < deadline) {
    const u = page.url();
    if (!/\/beta(\?|$|\/)/.test(new URL(u).pathname + new URL(u).search) && new URL(u).hostname === 'beta.afldb.com') { passed = true; break; }
    await page.waitForTimeout(1500);
  }
  if (!passed) { log('GATE NOT PASSED within 30 minutes; closing'); await ctx.close(); process.exit(2); }
  log('gate passed at ' + page.url());
  const results = {};
  for (const [name, p] of PAGES) {
    try {
      const resp = await page.goto('https://beta.afldb.com' + p, { waitUntil: 'networkidle', timeout: 60000 });
      const text = await page.evaluate(() => document.body.innerText);
      const title = await page.title();
      fs.writeFileSync(path.join(OUT, name + '.txt'), text);
      await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
      results[name] = { path: p, status: resp ? resp.status() : null, finalUrl: page.url(), title, chars: text.length };
      log(`${name} ${resp ? resp.status() : '?'} ${text.length} chars`);
    } catch (e) { results[name] = { path: p, error: String(e.message).slice(0, 200) }; log(`${name} ERROR ${e.message}`); }
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  log('DONE');
  await ctx.close();
})().catch((e) => { console.error('failed', e.message); process.exit(1); });
