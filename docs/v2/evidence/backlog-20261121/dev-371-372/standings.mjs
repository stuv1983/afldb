// AFLDB ISSUE-371 DEV standings check (backlog run 2026-11-22). Read-only GETs of /brownlow/2026 on every DEV worker.
// Same admission and worker identity as probe.mjs: in-memory beta claim from the DEV .env (never printed or written),
// x-afldb-worker / x-afldb-pid on every response, a new connection per request.
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const PROJECT = '/home/arm/projects/afldb';
const OUT = process.argv[2];
const PER = Number(process.argv[3] ?? 2);
const env = (n) => { const l = readFileSync(`${PROJECT}/.env`, 'utf8').split(/\r?\n/).find((x) => x.startsWith(`${n}=`)); return l ? l.slice(n.length + 1).replace(/^"|"$/g, '') : null; };
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const claim = Buffer.from(JSON.stringify({ v: 1, kind: 'beta', sub: 'issue371-dev-standings', exp: Math.floor(Date.now() / 1000) + 900, epoch: Number(env('AFLDB_BETA_EPOCH') ?? 1) }));
const COOKIE = `afldb_beta=${b64(claim)}.${b64(createHmac('sha256', env('AFLDB_SESSION_SECRET')).update(claim).digest())}`;
const WORKERS = Number(env('AFLDB_WORKERS') ?? 4);
const get = (p) => new Promise((res, rej) => {
  const r = http.get(`http://127.0.0.1:3100${p}`, { agent: false, headers: { 'user-agent': 'afldb-issue371-dev-standings', cookie: COOKIE } }, (s) => {
    const c = []; s.on('data', (d) => c.push(d)); s.on('end', () => res({ status: s.statusCode, h: s.headers, body: Buffer.concat(c).toString('utf8') }));
  }); r.on('error', rej);
});
const text = (s) => s.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
const seen = new Map(); const rows = []; let n = 0;
while ([...Array(WORKERS).keys()].some((i) => (seen.get(String(i + 1)) ?? 0) < PER) && n < PER * WORKERS * 6) {
  n += 1;
  const r = await get('/brownlow/2026');
  const w = r.h['x-afldb-worker'] ?? '?'; seen.set(w, (seen.get(w) ?? 0) + 1);
  const b = r.body; const headEnd = b.indexOf('</head>'); const headHtml = b.slice(0, headEnd);
  const tbody = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(b)?.[1] ?? '';
  const top5 = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(0, 5).map((m) => text(m[1]));
  rows.push({ at: new Date().toISOString(), worker: w, pid: r.h['x-afldb-pid'], cache: r.h['x-nextjs-cache'] ?? null, status: r.status,
    title: /<title>([^<]*)<\/title>/.exec(headHtml)?.[1] ?? null,
    robots: /<meta name="robots" content="([^"]*)"/.exec(headHtml)?.[1] ?? null,
    canonical: /<link rel="canonical" href="([^"]*)"/.exec(headHtml)?.[1] ?? null,
    ogTitle: /<meta property="og:title" content="([^"]*)"/.exec(headHtml)?.[1] ?? null,
    wonBy: /Won by[\s\S]{0,400}?(?=<\/p>|<\/div>)/.exec(b) ? text(/Won by[\s\S]{0,400}?(?=<\/p>|<\/div>)/.exec(b)[0]) : null,
    ineligibleMarkers: (b.match(/>Recorded ineligible</g) ?? []).length,
    polled: /(\d+) players polled votes/.exec(text(b))?.[1] ?? null,
    top5 });
}
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
for (const r of rows) console.log(JSON.stringify({ worker: r.worker, pid: r.pid, cache: r.cache, status: r.status, title: r.title, robots: r.robots, canonical: r.canonical, ogTitle: r.ogTitle, wonBy: r.wonBy, ineligibleMarkers: r.ineligibleMarkers, polled: r.polled }));
console.log('TOP5 (first sample per worker):');
for (const w of [...new Set(rows.map((r) => r.worker))].sort()) console.log(`worker ${w}: ${JSON.stringify(rows.find((r) => r.worker === w).top5)}`);
