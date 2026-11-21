// AFLDB-ISSUE-372 qualification driver (adapted from i371-driver.mjs). Runs on the DEV host against the harness's own
// private server only. Env: I372_BASE, I372_OUT, I372_LABEL, I372_SCEN (awards|brownlow), I372_ISR, I372_EMAIL,
// I372_PASSWORD, I372_TOTP (never printed). Output lines: STEP / SAMPLE / ISR / NAV / CHECK / RESULT (JSON after the tag).
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const BASE = process.env.I372_BASE;
const OUT = process.env.I372_OUT;
const ISR = process.env.I372_ISR;
const LABEL = process.env.I372_LABEL;
const SCEN = process.env.I372_SCEN;
const SEASON = 2026;
// A club best-and-fairest award, because /seasons/2026 (a REAL ISR page) lists those, so the same publication also changes it.
const AWARD_SLUG = 'bf-western-bulldogs';
const AWARD_NAME = 'Charles Sutton Medal';
const CLUB_NAME = 'Western Bulldogs';
const PLAYER_QUERY = 'Bontempelli';
const SIDE_PATH = `/seasons/2026`;
const AWARDS = SCEN === 'awards';
const PATH = AWARDS ? `/awards/${AWARD_SLUG}/${SEASON}` : `/brownlow/${SEASON}`;
const ISR_DIR = AWARDS ? join(ISR, 'awards', AWARD_SLUG) : join(ISR, 'brownlow');
const UA = 'curl/8.5.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(`${tag} ${JSON.stringify(obj)}`);
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
let winnerToken = null; // the recipient's surname, once chosen through the picker (awards scenario)

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; const bytes = [];
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const d = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = d[d.length - 1] & 0x0f;
  return String((d.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** One request on a NEW connection (agent:false), so the cluster can hand it to either worker. */
function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${path}`, { agent: false, headers: { 'user-agent': UA, ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

function parseHtml(body) {
  const headEnd = body.indexOf('</head>');
  const titles = [...body.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => ({ text: m[1], inHead: m.index < headEnd }));
  const desc = /<meta name="description" content="([^"]*)"/.exec(body)?.[1] ?? null;
  const robots = /<meta name="robots" content="([^"]*)"/.exec(body)?.[1] ?? null;
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body)?.[1]?.replace(/<[^>]+>|<!-- -->/g, '') ?? null;
  const polled = /(\d+) players polled votes/.exec(body)?.[1] ?? null;
  return {
    title: titles[0]?.text ?? null, titles, desc: desc && desc.slice(0, 90), robots, h1,
    winner: AWARDS ? (winnerToken !== null && body.includes(winnerToken)) : /Won by|Shared by/.test(body),
    polled: polled && Number(polled),
    ineligibleLabels: (body.match(/Recorded ineligible/g) ?? []).length,
  };
}

const goodTitle = (t) => typeof t === 'string' && t.startsWith(AWARDS ? `${SEASON} ${AWARD_NAME}` : `${SEASON} Brownlow Medal`);
const goodH1 = (h) => (AWARDS ? h === `${SEASON} ${AWARD_NAME}` : h === `${SEASON} Brownlow Medal`);
const bodyOk = (r) => r.status === 200 && goodH1(r.h1) && (AWARDS ? r.winner : r.polled > 0);

async function sample(tag, n, path = PATH) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const r = await get(path);
    const p = parseHtml(r.body);
    const row = { tag, i, at: at(), path, status: r.status, worker: r.headers['x-afldb-worker'], cache: r.headers['x-nextjs-cache'] ?? null,
      cacheControl: r.headers['cache-control'] ?? null,
      title: p.title, titleCount: p.titles.length, titleInHead: p.titles[0]?.inHead ?? null, robots: p.robots, desc: p.desc,
      h1: p.h1, winner: p.winner, polled: p.polled, ineligibleLabels: p.ineligibleLabels };
    log('SAMPLE', row); rows.push(row);
  }
  return rows;
}

/** Side samples of a REAL ISR page the same publication changes (/seasons/2026): does the new award show up on both workers? */
async function sideSample(tag, n) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const r = await get(SIDE_PATH);
    const row = { tag, i, at: at(), path: SIDE_PATH, status: r.status, worker: r.headers['x-afldb-worker'], cache: r.headers['x-nextjs-cache'] ?? null,
      cacheControl: r.headers['cache-control'] ?? null, showsNewAward: r.body.includes(AWARD_NAME), title: parseHtml(r.body).title };
    log('SIDE', row); rows.push(row);
  }
  const by = (pred) => rows.filter(pred).length;
  log('RESULT', { tag, n, status200: by((r) => r.status === 200), showsNewAward: by((r) => r.showsNewAward),
    perWorker: Object.fromEntries([...new Set(rows.map((r) => r.worker))].sort().map((w) => [w,
      { n: rows.filter((r) => r.worker === w).length, showsNewAward: rows.filter((r) => r.worker === w && r.showsNewAward).length,
        firstCache: rows.find((r) => r.worker === w)?.cache ?? null, caches: [...new Set(rows.filter((r) => r.worker === w).map((r) => r.cache))] }])) });
  return rows;
}

function isrSnapshot(tag, ISR_DIR_ = ISR_DIR, label = 'main') {
  const leaf = String(SEASON);
  let files = [];
  try { files = readdirSync(ISR_DIR_).filter((f) => f.startsWith(`${leaf}.`) || f === leaf); } catch { /* none */ }
  const entries = files.map((f) => { const s = statSync(join(ISR_DIR_, f)); return { f, bytes: s.size, mtime: s.mtime.toISOString() }; });
  let meta = null; let htmlTitle = null; let htmlRobots = null;
  try {
    const m = JSON.parse(readFileSync(join(ISR_DIR_, `${leaf}.meta`), 'utf8'));
    meta = { status: m.status ?? null, tags: m.headers?.['x-next-cache-tags'] ?? null };
  } catch { /* none */ }
  try { const h = parseHtml(readFileSync(join(ISR_DIR_, `${leaf}.html`), 'utf8')); htmlTitle = h.title; htmlRobots = h.robots; } catch { /* none */ }
  log('ISR', { tag, dir: label, at: at(), entries, meta, htmlTitle, htmlRobots });
}

function summarise(tag, rows) {
  const by = (pred) => rows.filter(pred).length;
  const res = { tag, n: rows.length,
    status200: by((r) => r.status === 200), status404: by((r) => r.status === 404),
    bodyCorrect: by(bodyOk),
    titleCorrect: by((r) => goodTitle(r.title)), titleNotFound: by((r) => r.title === 'Page not found | AFLDB'),
    noindex: by((r) => typeof r.robots === 'string' && r.robots.includes('noindex')),
    divergent: by((r) => r.status === 200 && (AWARDS ? r.winner : r.polled > 0) && !goodTitle(r.title)),
    cacheFirst3ByWorker: Object.fromEntries([...new Set(rows.map((r) => r.worker))].sort().map((w) => [w, rows.filter((r) => r.worker === w).slice(0, 3).map((r) => r.cache)])),
    workers: [...new Set(rows.map((r) => r.worker))].sort() };
  log('RESULT', res);
  return res;
}

async function readPage(page) {
  return page.evaluate((winner) => ({
    title: document.title,
    desc: document.querySelector('meta[name="description"]')?.getAttribute('content')?.slice(0, 90) ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    h1: document.querySelector('h1')?.textContent ?? null,
    polled: Number(/(\d+) players polled votes/.exec(document.body.innerText)?.[1] ?? 0),
    winner: winner ? document.body.innerText.includes(winner) : null,
  }), winnerToken);
}

async function bannerShot(page, file) {
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('data-i372-banner', '');
    d.textContent = `captured document.title: "${document.title}"`;
    Object.assign(d.style, { position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '99999', background: '#111',
      color: '#ff0', font: '14px monospace', padding: '6px 10px' });
    document.body.appendChild(d);
  });
  await page.screenshot({ path: join(OUT, file) });
}

async function login(ap) {
  await ap.goto(`${BASE}/admin/login`);
  await ap.fill('input[name="email"]', process.env.I372_EMAIL);
  await ap.fill('input[name="password"]', process.env.I372_PASSWORD);
  await ap.fill('input[name="totp"]', totp(process.env.I372_TOTP));
  await Promise.all([ap.waitForURL(/\/admin(\/?$|\?)/, { timeout: 30000 }), ap.click('button[type="submit"]')]);
  log('STEP', { at: at(), step: 'logged in', url: new URL(ap.url()).pathname });
}

/** Publish the season through the REAL admin form for the scenario; resolves once the admin UI has finished its follow-up. */
async function publish(ap, posts) {
  if (!AWARDS) {
    await ap.goto(`${BASE}/admin/brownlow/${SEASON}`);
    await ap.getByRole('heading', { name: 'Publish the season total' }).waitFor();
    await ap.locator('summary', { hasText: 'Ineligible players' }).click();
    const boxes = ap.locator('details input[type="checkbox"]');
    const boxCount = await boxes.count();
    for (let i = 0; i < Math.min(2, boxCount); i += 1) await boxes.nth(i).check();
    log('STEP', { at: at(), step: 'ineligible marked', checkboxes: boxCount });
    await ap.fill('form textarea[name="note"]', 'ISSUE-372 qualification: publish the synthetic 2026 count (ISSUE-371 flow re-run).');
    await ap.getByRole('button', { name: 'Publish season…' }).click();
    await ap.getByRole('button', { name: 'Confirm publish' }).click();
    const notice = ap.locator('section', { has: ap.getByRole('heading', { name: 'Publish the season total' }) }).locator('p.notice');
    await notice.waitFor({ timeout: 60000 });
    const message = (await notice.textContent()) ?? '';
    log('STEP', { at: at(), step: 'publish answered', message: message.slice(0, 200), actionPosts: posts });
    if (!new RegExp(`Season ${SEASON} published`).test(message)) throw new Error(`publication refused: ${message}`);
    return;
  }
  // Awards: record ONE winner for (Norm Smith Medal, 2026) through /admin/awards/winners/new. The form posts the Server Action,
  // then (only after it commits) the client posts the allowlisted paths to /admin/awards/revalidate.
  await ap.goto(`${BASE}/admin/awards/winners/new`);
  await ap.getByRole('heading', { name: 'Record an award winner' }).waitFor();
  const optionValue = await ap.locator('select[name="awardId"] option', { hasText: AWARD_NAME }).first().getAttribute('value');
  await ap.selectOption('select[name="awardId"]', optionValue);
  await ap.fill('input[name="season"]', String(SEASON));
  const clubValue = await ap.locator('select[name="clubId"] option', { hasText: CLUB_NAME }).first().getAttribute('value');
  await ap.selectOption('select[name="clubId"]', clubValue);
  await ap.getByPlaceholder('Select player profile').fill(PLAYER_QUERY);
  const option = ap.locator('[role="listbox"] [role="option"]').first();
  await option.waitFor({ timeout: 15000 });
  await option.click();
  const selectedText = (await ap.locator('text=/^Selected:/').first().textContent()) ?? '';
  const label = /Selected:\s*(.*?)\s*\(player #(\d+)\)/.exec(selectedText);
  winnerToken = label ? label[1].trim().split(/\s+/).pop() : PLAYER_QUERY;
  log('STEP', { at: at(), step: 'recipient chosen through the picker', label: label?.[1] ?? selectedText.slice(0, 80), playerId: label?.[2] ?? null, bodyToken: winnerToken });
  await ap.fill('[name="adminNote"]', 'ISSUE-372 qualification: synthetic Norm Smith 2026 winner on a disposable database.');
  const revalidated = ap.waitForResponse((r) => new URL(r.url()).pathname === '/admin/awards/revalidate' && r.request().method() === 'POST', { timeout: 60000 });
  await ap.getByRole('button', { name: 'Record award winner' }).click();
  const rr = await revalidated;
  const rbody = await rr.json().catch(() => null);
  log('STEP', { at: at(), step: 'award winner recorded; revalidate follow-up answered', revalidateStatus: rr.status(), revalidateWorker: rr.headers()['x-afldb-worker'],
    revalidated: rbody?.revalidated ?? null, actionPosts: posts });
  if (rr.status() !== 200) throw new Error(`revalidate follow-up answered ${rr.status()}`);
  await ap.waitForURL(/\/admin\/awards\/winners\/\d+/, { timeout: 30000 }).catch(() => {});
}

const browser = await chromium.launch();
try {
  log('STEP', { at: at(), step: 'pre-publication samples (expect 404, cached on both workers)', path: PATH });
  summarise('pre', await sample('pre', 8));
  isrSnapshot('pre');
  if (AWARDS) { await sideSample('seasons-pre', 12); isrSnapshot('pre', join(ISR, 'seasons'), 'seasons'); } // warms the REAL ISR page on both workers; expect no new award yet
  // Let the 404 entry age past the 1 s default a worker applies to an entry it did not write itself.
  await sleep(5000);

  log('STEP', { at: at(), step: 'admin login + publish through the real form', scenario: SCEN });
  const admin = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ap = await admin.newPage();
  const posts = [];
  ap.on('response', (r) => { if (r.request().method() === 'POST') posts.push({ url: new URL(r.url()).pathname, status: r.status(), worker: r.headers()['x-afldb-worker'] }); });
  await login(ap);
  await publish(ap, posts);
  await ap.screenshot({ path: join(OUT, `${LABEL}-admin-published.png`) });
  log('STEP', { at: at(), step: 'admin POSTs seen by the browser', posts });
  await admin.close();

  isrSnapshot('post-publish-immediate');
  if (AWARDS) isrSnapshot('post-publish-immediate', join(ISR, 'seasons'), 'seasons');
  if (AWARDS) {
    log('STEP', { at: at(), step: 'post-publication side samples of the real ISR page, first request per worker', path: SIDE_PATH });
    await sideSample('seasons-post-1', 8);
  }
  log('STEP', { at: at(), step: 'post-publication raw samples' });
  const post = [];
  post.push(...await sample('post-1', 8));
  await sleep(3000);
  post.push(...await sample('post-2', 8));
  await sleep(3000);
  post.push(...await sample('post-3', 8));
  summarise('post', post);
  isrSnapshot('post');
  if (AWARDS) { await sideSample('seasons-post-2', 8); isrSnapshot('post', join(ISR, 'seasons'), 'seasons'); }

  const navFrom = AWARDS ? `/awards/${AWARD_SLUG}` : '/brownlow';
  log('STEP', { at: at(), step: `client-side navigation ${navFrom} -> ${PATH}` });
  const navs = [];
  for (let i = 0; i < 2; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const rsc = [];
    pg.on('response', (r) => { const u = new URL(r.url()); if (u.pathname === PATH) rsc.push({ rsc: u.searchParams.has('_rsc'), status: r.status(), worker: r.headers()['x-afldb-worker'] }); });
    const first = await pg.goto(`${BASE}${navFrom}`);
    const link = pg.locator(`a[href="${PATH}"]`).first();
    let how = 'link';
    if (await link.count() === 0) {
      how = 'router.push (no link on the cached index page)';
      await pg.evaluate((p) => window.next?.router?.push(p), PATH);
    } else {
      await link.click();
    }
    try { await pg.waitForURL(`**${PATH}`, { timeout: 15000 }); await pg.locator('h1', { hasText: String(SEASON) }).waitFor({ timeout: 15000 }); } catch { /* recorded below */ }
    await sleep(500);
    const st = await readPage(pg);
    const row = { i, at: at(), how, fromWorker: first?.headers()['x-afldb-worker'], url: new URL(pg.url()).pathname, ...st, requests: rsc };
    log('NAV', row); navs.push(row);
    await ctx.close();
  }
  log('RESULT', { tag: 'nav', n: navs.length, titleCorrect: navs.filter((n) => goodTitle(n.title)).length,
    bodyCorrect: navs.filter((n) => goodH1(n.h1) && (AWARDS ? n.winner : n.polled > 0)).length });

  log('STEP', { at: at(), step: 'full-load screenshot (1280x800)' });
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const r = await pg.goto(`${BASE}${PATH}`);
    const st = await readPage(pg);
    log('NAV', { i: 'shot', at: at(), how: 'full-load', status: r?.status(), worker: r?.headers()['x-afldb-worker'], ...st });
    await bannerShot(pg, `${LABEL}-full-load.png`);
    await ctx.close();
  }

  log('STEP', { at: at(), step: '404 and strict-parsing checks' });
  const missing = AWARDS
    ? [`/awards/${AWARD_SLUG}/1950`, `/awards/${AWARD_SLUG}/2027`, `/awards/${AWARD_SLUG}/02026`, `/awards/${AWARD_SLUG}/2026.0`, `/awards/${AWARD_SLUG}/+2026`,
       `/awards/${AWARD_SLUG}/2026abc`, `/awards/${AWARD_SLUG}/%202026`, '/awards/no-such-award/2026']
    : ['/brownlow/1897', '/brownlow/1923', '/brownlow/02026', '/brownlow/2026.0', '/brownlow/+2026', '/brownlow/2026abc', '/brownlow/%202026'];
  for (const p of missing) {
    const r = await get(p); const h = parseHtml(r.body);
    log('CHECK', { path: p, status: r.status, worker: r.headers['x-afldb-worker'], cache: r.headers['x-nextjs-cache'] ?? null, title: h.title, robots: h.robots });
  }
  // A second pass, so a cached 404 entry is exercised as well as a fresh render.
  for (const p of missing.slice(0, 3)) {
    await sleep(1500);
    const r = await get(p); const h = parseHtml(r.body);
    log('CHECK', { path: p, pass: 2, status: r.status, worker: r.headers['x-afldb-worker'], cache: r.headers['x-nextjs-cache'] ?? null, title: h.title, robots: h.robots });
  }
} finally {
  await browser.close();
}
