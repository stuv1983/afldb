// AFLDB-ISSUE-336 D-336-2 after-state visual check (SIMULATION data): R's production build served from a _test copy of the post-apply
// simulated database. Headless Chromium, dedicated context per viewport, no stored state. Usage: node vis336.cjs <baseURL> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const [base, out] = process.argv.slice(2);
const pages = [
  ['2008-pre-draft', '/draft/2008?view=pre-draft', ['Intl Schol']],
  ['2009-pre-draft', '/draft/2009?view=pre-draft', ['Intl Schol']],
  ['2025-pre-draft', '/draft/2025?view=pre-draft', []],
  ['2025-all', '/draft/2025', ['Willem Duursma']],
  ['2025-rookie', '/draft/2025?view=rookie', ['Fred Rodriguez']],
];
const viewports = [['desktop', 1280, 800], ['mobile', 390, 844]];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const [vp, w, h] of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    for (const [name, path, mustSee] of pages) {
      const page = await ctx.newPage(); const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      page.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
      const resp = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90000 });
      const body = await page.locator('body').innerText();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const names = ['Solomoni Loki', 'Amua Pirika'].filter((s) => body.includes(s));
      const intl = (body.match(/Intl Schol/g) || []).length;
      const missing = mustSee.filter((s) => !body.includes(s));
      await page.screenshot({ path: `${out}/${name}-${vp}.png`, fullPage: true });
      const r = { vp, name, path, status: resp && resp.status(), overflowPx: overflow, intlScholMentions: intl, sampleNamesSeen: names, missing, consoleErrors: errors };
      r.pass = r.status === 200 && overflow <= 0 && missing.length === 0 && errors.length === 0;
      results.push(r); console.log(JSON.stringify(r));
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
  console.log(`VISUAL ${results.filter((r) => r.pass).length}/${results.length} PASS`);
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
