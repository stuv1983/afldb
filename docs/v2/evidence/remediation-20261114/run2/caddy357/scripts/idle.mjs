// caddy357: is the /search networkidle timeout caused by Caddy? Same page direct to the app and through Caddy.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP beta.afldb.com 127.0.0.1'] });
for (const [label, base] of [['direct', 'http://beta.afldb.com:55663'], ['via-caddy', 'http://beta.afldb.com:55653']]) {
  const page = await browser.newPage();
  const t0 = Date.now(); let reqs = 0; let pending = 0;
  page.on('request', () => { reqs += 1; pending += 1; }); page.on('requestfinished', () => { pending -= 1; }); page.on('requestfailed', () => { pending -= 1; });
  const r = await page.goto(`${base}/search?q=most+goals`, { waitUntil: 'load', timeout: 60000 }).catch((e) => ({ status: () => `ERR ${String(e).slice(0, 60)}` }));
  await page.waitForTimeout(8000);
  console.log(`${label}: load status=${r.status()} after ${Date.now() - t0}ms, requests=${reqs}, still pending after 8s=${pending}, title=${JSON.stringify((await page.title()).slice(0, 40))}`);
  await page.close();
}
await browser.close();
