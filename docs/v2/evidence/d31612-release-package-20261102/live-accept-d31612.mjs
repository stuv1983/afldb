// D-316-12 admin wording: authenticated, READ-ONLY live acceptance of /admin/current-season on https://beta.afldb.com.
// Headed Chromium from the repository's Playwright; same shape as docs/v2/evidence/gap006-release-package-20261101/live-accept-gap006.mjs.
// The owner signs in (credentials and MFA typed by the owner only). The script only NAVIGATES: it never fills, clicks,
// submits or posts anything, never reads or stores cookies, storage, tokens or form input, and discards the context at
// the end. The only page it opens after sign-in is /admin/current-season, so production data cannot change.
//
//   node docs/v2/evidence/d31612-release-package-20261102/live-accept-d31612.mjs <new-empty-evidence-dir>
//
// What it proves (rendering only), at 1280x800 and again at 390x844, each as captured screenshots plus results.json:
//   G1 the subtitle reads the new wording (AFL Tables retired, match ingestion from its timer while the switch is
//      Enabled, Brownlow governed separately, no Start control);
//   G2 neither "still runs on the host" nor "neither starts nor stops it" (nor the retired polkit wording) appears;
//   G3 "AFL API Current-Season Ingestion" shows Enabled (the stored setting, unchanged);
//   G4 "Brownlow Live Ingestion" shows Admin control Disabled and Deployment gate Disabled (unchanged);
//   G5 both settle rows show a service state, never "Unit status is not read on this host" (this proves the restart
//      kept AFLDB_SETTLE_TRIGGER=systemd in the effective environment);
//   G6 no control whose label is "Start";
//   G7 HTTP 200, no horizontal overflow, no bad /_next/static asset, no console error.
// A gate that cannot be evaluated is a FAIL, never a pass. The verdict is PASS only when every check passed.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const BASE = 'https://beta.afldb.com';
const PATH = '/admin/current-season';
if (!OUT) { console.log('usage: node live-accept-d31612.mjs <new-empty-evidence-dir>'); process.exit(2); }
if (existsSync(OUT)) { console.log(`STOP: ${OUT} exists`); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const results = { started: new Date().toISOString(), base: BASE, path: PATH, checks: [], screenshots: [] };
const check = (id, ok, detail) => { results.checks.push({ id, ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail)}`); };

// Wording mirrored from src/app/admin/current-season/page.tsx and AflApiSettleUnitsPanel.tsx at a0b1080f5b98.
const MUST_HAVE = [
  'AFL Tables network acquisition is retired',
  'its nightly timer is disabled',
  'Match and player ingestion runs from the AFL API match timer while its switch below is Enabled',
  'Brownlow ingestion is governed separately',
  'stays off until the owner opens a count window',
  'there is no Start control, because runs follow the host timers',
  'there is no Start control (AFLDB-ISSUE-316, D-316-12)',
];
const MUST_NOT_HAVE = [
  'still runs on the host',
  'neither starts nor stops it',
  'On-demand refresh is not enabled on this host',
  'polkit',
  'Unit status is not read on this host',
  'Service state is not available on this host',
];

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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

async function inspect(vp) {
  reset();
  const response = await page.goto(`${BASE}${PATH}`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const status = response?.status() ?? 0;
  const facts = await page.evaluate(() => {
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main') ?? document.body;
    const text = norm(main.textContent);
    const rowText = (label) => {
      const th = [...main.querySelectorAll('th[scope="row"]')].find((t) => norm(t.textContent).startsWith(label));
      return th ? norm(th.closest('tr')?.textContent) : null;
    };
    const controls = [...main.querySelectorAll('button, a, [role="button"], input[type="submit"]')].map((e) => norm(e.textContent || e.getAttribute('value')));
    return {
      text,
      current: rowText('AFL API Current-Season Ingestion'),
      brownlow: rowText('Brownlow Live Ingestion'),
      matchUnit: rowText('Match and player statistics'),
      brownlowUnit: rowText('Brownlow votes'),
      controls,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  check(`${vp} http-200-on-path`, status === 200 && new URL(page.url()).pathname === PATH, { status, url: page.url() });
  for (const p of MUST_HAVE) check(`${vp} G1 has "${p.slice(0, 48)}…"`, facts.text.includes(p), { found: facts.text.includes(p) });
  for (const p of MUST_NOT_HAVE) check(`${vp} G2/G5 lacks "${p}"`, !facts.text.includes(p), { found: facts.text.includes(p) });
  check(`${vp} G3 current-season ingestion Enabled`, facts.current !== null && /Enabled/.test(facts.current) && !/Disabled/.test(facts.current), { row: facts.current });
  check(`${vp} G4 Brownlow admin control Disabled`, facts.brownlow !== null && /Admin control:\s*Disabled/.test(facts.brownlow), { row: facts.brownlow });
  check(`${vp} G4 Brownlow deployment gate Disabled`, facts.brownlow !== null && /Deployment gate:\s*Disabled/.test(facts.brownlow), { row: facts.brownlow });
  const state = /(Running|Idle|Last run failed|Unknown|Not installed on this host)/;
  check(`${vp} G5 match settle row shows a service state`, facts.matchUnit !== null && state.test(facts.matchUnit), { row: facts.matchUnit });
  check(`${vp} G5 Brownlow settle row shows a service state`, facts.brownlowUnit !== null && state.test(facts.brownlowUnit), { row: facts.brownlowUnit });
  check(`${vp} G6 no control labelled Start`, !facts.controls.some((c) => /\bstart\b/i.test(c)), { controls: facts.controls });
  check(`${vp} G7 no-overflow`, facts.scrollWidth <= facts.innerWidth, { scrollWidth: facts.scrollWidth, innerWidth: facts.innerWidth });
  check(`${vp} G7 static-and-console`, badStatic.length === 0 && staticSeen.length > 0 && consoleErrors.length === 0, { staticSeen: staticSeen.length, badStatic, consoleErrors });
  await shot(`current-season-${vp}`, vp);
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
  await page.setViewportSize({ width: 1280, height: 800 });
  await inspect('1280x800');
  await page.setViewportSize({ width: 390, height: 844 });
  await inspect('390x844');
} catch (e) {
  check('run', false, { error: String(e).slice(0, 500) });
} finally {
  results.finished = new Date().toISOString();
  results.verdict = results.checks.length > 0 && results.checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  log(`VERDICT ${results.verdict} (${results.checks.filter((c) => c.ok).length}/${results.checks.length})`);
  await context.close(); await browser.close();
}
