// AFLDB-ISSUE-371 reproduction driver. Runs on the DEV host against the harness's own private server only.
// Env: I371_BASE, I371_OUT, I371_LABEL, I371_ISR, I371_EMAIL, I371_PASSWORD, I371_TOTP (never printed).
// Output lines: STEP / SAMPLE / ISR / NAV / CHECK / RESULT (JSON after the tag), plus screenshots in I371_OUT.
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const BASE = process.env.I371_BASE;
const OUT = process.env.I371_OUT;
const ISR = process.env.I371_ISR;
const LABEL = process.env.I371_LABEL;
const SEASON = 2026;
const PATH = `/brownlow/${SEASON}`;
const UA = 'curl/8.5.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(`${tag} ${JSON.stringify(obj)}`);
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

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
    winner: /Won by|Shared by/.test(body), polled: polled && Number(polled),
    ineligibleLabels: (body.match(/Recorded ineligible/g) ?? []).length,
  };
}

const goodTitle = (t) => typeof t === 'string' && t.startsWith(`${SEASON} Brownlow Medal`);

async function sample(tag, n, path = PATH) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const r = await get(path);
    const p = parseHtml(r.body);
    const row = { tag, i, at: at(), path, status: r.status, worker: r.headers['x-afldb-worker'], cache: r.headers['x-nextjs-cache'] ?? null,
      title: p.title, titleCount: p.titles.length, titleInHead: p.titles[0]?.inHead ?? null, robots: p.robots, desc: p.desc,
      h1: p.h1, winner: p.winner, polled: p.polled, ineligibleLabels: p.ineligibleLabels };
    log('SAMPLE', row); rows.push(row);
  }
  return rows;
}

function isrSnapshot(tag) {
  const dir = join(ISR, 'brownlow');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.startsWith(`${SEASON}.`) || f === String(SEASON)); } catch { /* none */ }
  const entries = files.map((f) => { const s = statSync(join(dir, f)); return { f, bytes: s.size, mtime: s.mtime.toISOString() }; });
  let meta = null; let htmlTitle = null;
  try {
    const m = JSON.parse(readFileSync(join(dir, `${SEASON}.meta`), 'utf8'));
    meta = { status: m.status ?? null, tags: m.headers?.['x-next-cache-tags'] ?? null };
  } catch { /* none */ }
  try { htmlTitle = parseHtml(readFileSync(join(dir, `${SEASON}.html`), 'utf8')).title; } catch { /* none */ }
  log('ISR', { tag, at: at(), entries, meta, htmlTitle });
}

function summarise(tag, rows) {
  const by = (pred) => rows.filter(pred).length;
  const res = { tag, n: rows.length,
    status200: by((r) => r.status === 200), status404: by((r) => r.status === 404),
    bodyCorrect: by((r) => r.status === 200 && r.h1 === `${SEASON} Brownlow Medal` && r.polled > 0),
    titleCorrect: by((r) => goodTitle(r.title)), titleNotFound: by((r) => r.title === 'Page not found | AFLDB'),
    divergent: by((r) => r.status === 200 && r.polled > 0 && !goodTitle(r.title)),
    workers: [...new Set(rows.map((r) => r.worker))].sort() };
  log('RESULT', res);
  return res;
}

async function readPage(page) {
  return page.evaluate(() => ({
    title: document.title,
    desc: document.querySelector('meta[name="description"]')?.getAttribute('content')?.slice(0, 90) ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    h1: document.querySelector('h1')?.textContent ?? null,
    polled: Number(/(\d+) players polled votes/.exec(document.body.innerText)?.[1] ?? 0),
  }));
}

async function bannerShot(page, file) {
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('data-i371-banner', '');
    d.textContent = `captured document.title: "${document.title}"`;
    Object.assign(d.style, { position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '99999', background: '#111',
      color: '#ff0', font: '14px monospace', padding: '6px 10px' });
    document.body.appendChild(d);
  });
  await page.screenshot({ path: join(OUT, file) });
}

const browser = await chromium.launch();
try {
  log('STEP', { at: at(), step: 'pre-publication samples (expect 404)' });
  summarise('pre', await sample('pre', 8));
  isrSnapshot('pre');
  // Let the 404 entry age past the 1 s default a worker applies to an entry it did not write itself.
  await sleep(5000);

  log('STEP', { at: at(), step: 'admin login + publish through the real form' });
  const admin = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ap = await admin.newPage();
  const posts = [];
  ap.on('response', (r) => { if (r.request().method() === 'POST') posts.push({ url: new URL(r.url()).pathname, status: r.status(), worker: r.headers()['x-afldb-worker'] }); });
  await ap.goto(`${BASE}/admin/login`);
  await ap.fill('input[name="email"]', process.env.I371_EMAIL);
  await ap.fill('input[name="password"]', process.env.I371_PASSWORD);
  await ap.fill('input[name="totp"]', totp(process.env.I371_TOTP));
  await Promise.all([ap.waitForURL(/\/admin(\/?$|\?)/, { timeout: 30000 }), ap.click('button[type="submit"]')]);
  log('STEP', { at: at(), step: 'logged in', url: new URL(ap.url()).pathname });
  await ap.goto(`${BASE}/admin/brownlow/${SEASON}`);
  await ap.getByRole('heading', { name: 'Publish the season total' }).waitFor();
  await ap.locator('summary', { hasText: 'Ineligible players' }).click();
  const boxes = ap.locator('details input[type="checkbox"]');
  const boxCount = await boxes.count();
  for (let i = 0; i < Math.min(2, boxCount); i += 1) await boxes.nth(i).check();
  const hidden = await ap.locator('form input[type="hidden"][name="ineligible"]').count();
  log('STEP', { at: at(), step: 'ineligible marked', checkboxes: boxCount, hiddenIneligibleInputs: hidden });
  // 2026 is sealed historical data: publication requires a 20-2000 character correction note.
  await ap.fill('form textarea[name="note"]', 'ISSUE-371 DEV reproduction: publish the synthetic 2026 count.');
  await ap.getByRole('button', { name: 'Publish season…' }).click();
  await ap.getByRole('button', { name: 'Confirm publish' }).click();
  const notice = ap.locator('section', { has: ap.getByRole('heading', { name: 'Publish the season total' }) }).locator('p.notice');
  await notice.waitFor({ timeout: 60000 });
  const message = (await notice.textContent()) ?? '';
  log('STEP', { at: at(), step: 'publish answered', message: message.slice(0, 200), actionPosts: posts });
  await ap.screenshot({ path: join(OUT, `${LABEL}-admin-published.png`) });
  if (!new RegExp(`Season ${SEASON} published`).test(message)) throw new Error(`publication refused: ${message}`);
  await admin.close();

  isrSnapshot('post-publish-immediate');
  log('STEP', { at: at(), step: 'post-publication raw samples' });
  const post = [];
  post.push(...await sample('post-1', 8));
  await sleep(3000);
  post.push(...await sample('post-2', 8));
  await sleep(3000);
  post.push(...await sample('post-3', 8));
  summarise('post', post);
  isrSnapshot('post');

  log('STEP', { at: at(), step: 'client-side navigation /brownlow -> /brownlow/2026' });
  const navs = [];
  for (let i = 0; i < 4; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const rsc = [];
    pg.on('response', (r) => { const u = new URL(r.url()); if (u.pathname === PATH) rsc.push({ rsc: u.searchParams.has('_rsc'), status: r.status(), worker: r.headers()['x-afldb-worker'] }); });
    const first = await pg.goto(`${BASE}/brownlow`);
    const link = pg.locator(`a[href="${PATH}"]`).first();
    let how = 'link';
    if (await link.count() === 0) {
      how = 'router.push';
      await pg.evaluate((p) => window.next?.router?.push(p), PATH);
    } else {
      await link.click();
    }
    try { await pg.waitForURL(`**${PATH}`, { timeout: 15000 }); await pg.locator('h1', { hasText: `${SEASON} Brownlow Medal` }).waitFor({ timeout: 15000 }); } catch { /* recorded below */ }
    await sleep(500);
    const st = await readPage(pg);
    const row = { i, at: at(), how, fromWorker: first?.headers()['x-afldb-worker'], url: new URL(pg.url()).pathname, ...st, requests: rsc };
    log('NAV', row); navs.push(row);
    if (i === 0) await bannerShot(pg, `${LABEL}-client-nav.png`);
    await ctx.close();
  }
  log('RESULT', { tag: 'nav', n: navs.length, titleCorrect: navs.filter((n) => goodTitle(n.title)).length,
    bodyCorrect: navs.filter((n) => n.h1 === `${SEASON} Brownlow Medal` && n.polled > 0).length });

  log('STEP', { at: at(), step: 'full-load screenshots' });
  for (let i = 0; i < 2; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const r = await pg.goto(`${BASE}${PATH}`);
    const st = await readPage(pg);
    log('NAV', { i, at: at(), how: 'full-load', status: r?.status(), worker: r?.headers()['x-afldb-worker'], ...st });
    await bannerShot(pg, `${LABEL}-full-load-${i}.png`);
    await ctx.close();
  }

  log('STEP', { at: at(), step: '404 and strict-parsing checks' });
  for (const p of ['/brownlow/1897', '/brownlow/1923', '/brownlow/02026', '/brownlow/2026.0', '/brownlow/+2026', '/brownlow/2026abc', '/brownlow/%202026']) {
    const r = await get(p); const h = parseHtml(r.body);
    log('CHECK', { path: p, status: r.status, worker: r.headers['x-afldb-worker'], title: h.title, robots: h.robots });
  }
  // A second pass, so a cached 404 entry is exercised as well as a fresh render.
  for (const p of ['/brownlow/1897', '/brownlow/02026']) {
    await sleep(1500);
    const r = await get(p); const h = parseHtml(r.body);
    log('CHECK', { path: p, pass: 2, status: r.status, worker: r.headers['x-afldb-worker'], title: h.title, robots: h.robots });
  }
} finally {
  await browser.close();
}
