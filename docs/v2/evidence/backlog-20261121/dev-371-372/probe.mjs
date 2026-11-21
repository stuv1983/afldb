// AFLDB ISSUE-371/372 DEV per-worker probe (backlog run 2026-11-22). Read-only HTTP GETs against the DEV app on loopback.
//
// Usage (on streamanator, from any directory):
//   node probe.mjs <mode> <label> [perWorker]
//     mode  prime  -> every target reached on every worker; records the PRE-publication state each worker now holds
//           check  -> the same probes, perWorker samples per worker per target, with post-publication verdicts
//
// Admission: DEV runs AFLDB_BETA_GATE=on, so an anonymous GET is a 307 to /beta and renders nothing. The probe mints a
// short-lived (15 min) beta claim IN MEMORY from the DEV .env (AFLDB_SESSION_SECRET, AFLDB_BETA_EPOCH) exactly as
// src/lib/auth/tokens.ts signClaim does. The secret and the cookie are never printed, logged or written anywhere.
// Worker identity: DEV sets AFLDB_TRACE_REQUESTS=on, so every response carries x-afldb-worker (ordinal 1..N) and
// x-afldb-pid. Each request uses a NEW connection (agent:false), so the cluster primary rotates it across workers.
import { createHmac } from 'node:crypto';
import { readFileSync, statSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const PROJECT = '/home/arm/projects/afldb';
const BASE = 'http://127.0.0.1:3100';
const OUTDIR = process.env.DEV372_OUT ?? '/mnt/ssd/afldb-backlog-20261122-dev/dev371372/out';
const SEASON = 2026;
const AWARD_SLUG = 'bf-western-bulldogs';
const AWARD_NAME = 'Charles Sutton Medal';
const TARGETS = [
  { key: 'seasons', path: `/seasons/${SEASON}`, isr: `seasons/${SEASON}.html`, kind: 'isr-page' },
  { key: 'brownlow', path: `/brownlow/${SEASON}`, isr: `brownlow/${SEASON}.html`, kind: 'isr-404-or-page' },
  { key: 'award', path: `/awards/${AWARD_SLUG}/${SEASON}`, isr: `awards/${AWARD_SLUG}/${SEASON}.html`, kind: 'dynamic-control' },
];

const [mode, label, perArg] = process.argv.slice(2);
if (!['prime', 'check'].includes(mode) || !label || !/^[A-Za-z0-9_-]+$/.test(label)) {
  console.error('usage: node probe.mjs prime|check <label> [perWorker]'); process.exit(2);
}
const PER = Number(perArg ?? (mode === 'prime' ? 2 : 4));
const WORKERS = Number(envValue('AFLDB_WORKERS') ?? 4);

function envValue(name) {
  const line = readFileSync(`${PROJECT}/.env`, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line === undefined ? null : line.slice(name.length + 1).replace(/^"|"$/g, '');
}
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function betaCookie() {
  const secret = envValue('AFLDB_SESSION_SECRET');
  if (!secret) { console.error('AFLDB_SESSION_SECRET not set in DEV .env'); process.exit(2); }
  const claim = { v: 1, kind: 'beta', sub: 'issue372-dev-probe', exp: Math.floor(Date.now() / 1000) + 900, epoch: Number(envValue('AFLDB_BETA_EPOCH') ?? 1) };
  const payload = Buffer.from(JSON.stringify(claim), 'utf8');
  return `afldb_beta=${b64url(payload)}.${b64url(createHmac('sha256', secret).update(payload).digest())}`;
}
const COOKIE = betaCookie();

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${path}`, { agent: false, headers: { 'user-agent': 'afldb-issue372-dev-probe', cookie: COOKIE } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}
function head(body) {
  const headEnd = body.indexOf('</head>');
  const t = /<title>([^<]*)<\/title>/.exec(body);
  return {
    title: t ? t[1] : null, titleInHead: t ? t.index < headEnd : null,
    robots: /<meta name="robots" content="([^"]*)"/.exec(body)?.[1] ?? null,
    h1: /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body)?.[1]?.replace(/<[^>]+>|<!-- -->/g, '').trim() ?? null,
  };
}
function isrMtime(rel) {
  try { return statSync(`${PROJECT}/.next/standalone/.next/server/app/${rel}`).mtime.toISOString(); } catch { return null; }
}

mkdirSync(OUTDIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const file = `${OUTDIR}/${stamp}-${mode}-${label}.jsonl`;
const write = (obj) => appendFileSync(file, `${JSON.stringify(obj)}\n`);
write({ type: 'run', mode, label, at: new Date().toISOString(), perWorker: PER, workers: WORKERS, base: BASE,
  build: readFileSync(`${PROJECT}/.next/standalone/.next/BUILD_ID`, 'utf8').trim(), awardName: AWARD_NAME });

const rows = [];
for (const t of TARGETS) {
  write({ type: 'isr', target: t.key, phase: 'before', at: new Date().toISOString(), file: t.isr, mtime: isrMtime(t.isr) });
  const seen = new Map();
  let n = 0;
  while ([...Array(WORKERS).keys()].some((i) => (seen.get(String(i + 1)) ?? 0) < PER) && n < PER * WORKERS * 6) {
    n += 1;
    const r = await get(t.path);
    const h = head(r.body);
    const worker = r.headers['x-afldb-worker'] ?? '?';
    seen.set(worker, (seen.get(worker) ?? 0) + 1);
    const row = { type: 'sample', target: t.key, path: t.path, i: n, at: new Date().toISOString(), status: r.status, worker,
      pid: r.headers['x-afldb-pid'] ?? null, build: r.headers['x-afldb-build'] ?? null, cache: r.headers['x-nextjs-cache'] ?? null,
      cacheControl: r.headers['cache-control'] ?? null, location: r.headers.location ?? null, ...h,
      notFoundHead: typeof h.title === 'string' && /not found/i.test(h.title),
      awardOnPage: t.key === 'seasons' ? r.body.includes(AWARD_NAME) : null,
      brownlowPolled: t.key === 'brownlow' ? Number(/(\d+) players polled votes/.exec(r.body)?.[1] ?? 0) : null };
    write(row); rows.push(row);
  }
  write({ type: 'isr', target: t.key, phase: 'after', at: new Date().toISOString(), file: t.isr, mtime: isrMtime(t.isr) });
}

// Per-worker summary and verdicts.
const lines = [`${mode} ${label}  build=${rows[0]?.build}  file=${file}`];
let allPass = true;
for (const t of TARGETS) {
  for (const w of [...Array(WORKERS).keys()].map((i) => String(i + 1))) {
    const rs = rows.filter((r) => r.target === t.key && r.worker === w);
    const titles = [...new Set(rs.map((r) => r.title))];
    const robots = [...new Set(rs.map((r) => r.robots))];
    const caches = rs.map((r) => r.cache ?? '-').join(',');
    let state;
    if (t.key === 'seasons') state = `award=${rs.filter((r) => r.awardOnPage).length}/${rs.length}`;
    else if (t.key === 'brownlow') state = `200=${rs.filter((r) => r.status === 200).length}/${rs.length} notFoundHead=${rs.filter((r) => r.notFoundHead).length}`;
    else state = `200=${rs.filter((r) => r.status === 200).length}/${rs.length} notFoundHead=${rs.filter((r) => r.notFoundHead).length}`;
    let verdict = '';
    if (mode === 'check') {
      const ok = t.key === 'seasons' ? rs.length > 0 && rs.every((r) => r.status === 200 && r.awardOnPage)
        : t.key === 'award' ? rs.length > 0 && rs.every((r) => r.status === 200 && !r.notFoundHead)
        : rs.length > 0 && rs.every((r) => r.status === 200 && !r.notFoundHead && r.brownlowPolled > 0);
      verdict = ok ? ' PASS' : (t.key === 'brownlow' ? ' NOT-PUBLISHED-OR-STALE' : ' FAIL');
      if (!ok && t.key !== 'brownlow') allPass = false;
    }
    lines.push(`${t.key.padEnd(8)} worker ${w} pid=${rs[0]?.pid ?? '-'} n=${rs.length} status=${[...new Set(rs.map((r) => r.status))].join('/')} ${state} cache=${caches} title=${JSON.stringify(titles)} robots=${JSON.stringify(robots)}${verdict}`);
  }
}
if (mode === 'check') lines.push(`VERDICT (seasons + award control): ${allPass ? 'PASS' : 'FAIL'}; brownlow line shows PASS only once 2026 is published`);
writeFileSync(file.replace(/\.jsonl$/, '.summary.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
