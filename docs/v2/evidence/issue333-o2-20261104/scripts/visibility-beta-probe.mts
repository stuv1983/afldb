// ISSUE-333 public-visibility probe (read-only GETs) with ONE owner-authorised temporary beta-admission cookie (kind='beta' only).
// Runs inside a process on the production host. The signing secret and the minted token live in this process's memory only: they are never
// printed, never in argv, never written to a file, and are sent only as a Cookie header to PUBLIC_HOST over TLS (no redirect is followed).
// Usage (from the ops checkout, via tsx):  node --import tsx visibility-beta-probe.mts <mainpid> <mode: inspect|observe> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';
import { signClaim, BETA_COOKIE } from '@/lib/auth/tokens';

const PUBLIC_HOST = 'beta.afldb.com';
const SUBJECT = 'issue333-readonly-probe-20261104';
const TTL_SECONDS = 55 * 60; // <= 60 minutes
const [mainPid, mode, outPath] = process.argv.slice(2, 5);
if (!mainPid || !/^\d+$/.test(mainPid) || !['inspect', 'observe'].includes(mode) || !outPath) throw new Error('usage: <mainpid> <inspect|observe> <out.json>');

// Only the two required keys are read from the serving process's own environment (not dumped).
function envKey(pid: string, key: string): string | undefined {
  const raw = readFileSync(`/proc/${pid}/environ`);
  for (const entry of raw.toString('utf8').split('\0')) if (entry.startsWith(`${key}=`)) return entry.slice(key.length + 1);
  return undefined;
}
const secret = envKey(mainPid, 'AFLDB_SESSION_SECRET');
if (!secret) throw new Error('serving process has no AFLDB_SESSION_SECRET');
const epochRaw = envKey(mainPid, 'AFLDB_BETA_EPOCH');
const epoch = epochRaw === undefined || epochRaw === '' ? 1 : Number(epochRaw);
if (!Number.isInteger(epoch)) throw new Error('AFLDB_BETA_EPOCH is not an integer');

const createdAt = new Date();
const exp = Math.floor(createdAt.getTime() / 1000) + TTL_SECONDS;
const token = await signClaim({ v: 1, kind: 'beta', sub: SUBJECT, exp, epoch }, secret);
const expiresAt = new Date(exp * 1000);
const cookie = `${BETA_COOKIE}=${token}`;

type Resp = { status: number; headers: Record<string, string>; body: string };
function get(path: string, via: 'public' | 'loopback'): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const opts = via === 'public'
      ? { host: PUBLIC_HOST, servername: PUBLIC_HOST, port: 443, path, method: 'GET', headers: { Cookie: cookie, 'User-Agent': 'afldb-issue333-readonly-probe', Accept: 'text/html', Connection: 'close' } }
      : { host: '127.0.0.1', port: 3100, path, method: 'GET', headers: { Cookie: cookie, Host: PUBLIC_HOST, 'x-forwarded-proto': 'https', 'User-Agent': 'afldb-issue333-readonly-probe-loopback', Accept: 'text/html', Connection: 'close' } };
    const req = (via === 'public' ? request : httpRequest)(opts as never, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const h: Record<string, string> = {};
        for (const k of ['date', 'cache-control', 'x-nextjs-cache', 'age', 'cf-cache-status', 'x-afldb-worker', 'x-afldb-pid', 'x-afldb-build', 'x-afldb-request-id', 'location', 'content-length', 'x-nextjs-prerender']) {
          const v = res.headers[k]; if (v !== undefined) h[k] = Array.isArray(v) ? v.join(',') : String(v);
        }
        resolve({ status: res.statusCode ?? 0, headers: h, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
const rowsWith = (html: string, name: string): string[][] =>
  [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((r) => r.includes(name))
    .map((r) => [...r.matchAll(/<t[dh][\s\S]*?<\/t[dh]>/g)].map((c) => text(c[0])));

type Check = { name: string; ok: boolean; seen: unknown };
const PAGES: { path: string; checks: (html: string) => Check[] }[] = [
  { path: '/coaches', checks: (h) => {
    const carr = rowsWith(h, 'Josh Carr')[0] ?? []; const fraser = rowsWith(h, 'Josh Fraser')[0] ?? [];
    return [{ name: 'Carr row shows 23 games', ok: carr.includes('23'), seen: carr }, { name: 'Fraser row shows 16 games', ok: fraser.includes('16'), seen: fraser }];
  } },
  { path: '/coaches/josh-carr-243', checks: (h) => {
    const t = text(h); const row = rowsWith(h, 'Port Adelaide')[0] ?? [];
    return [{ name: 'career shows Port Adelaide row with 23 games, 7 wins, 16 losses', ok: ['23', '7', '16'].every((x) => row.includes(x)), seen: row }, { name: 'page names 23 games', ok: /\b23\b/.test(t), seen: null }];
  } },
  { path: '/coaches/josh-fraser-293', checks: (h) => {
    const row = rowsWith(h, 'Carlton')[0] ?? [];
    return [{ name: 'career shows Carlton row with 16 games, 12 wins, 1 draw, 3 losses', ok: ['16', '12', '1', '3'].every((x) => row.includes(x)), seen: row }];
  } },
  { path: '/clubs/port-adelaide', checks: (h) => {
    const row = rowsWith(h, 'Josh Carr')[0] ?? [];
    return [{ name: 'club coach table has Josh Carr: 23 games, 7 W, 0 D, 16 L', ok: ['23', '7', '0', '16'].every((x) => row.includes(x)), seen: row }];
  } },
  { path: '/clubs/carlton', checks: (h) => {
    const row = rowsWith(h, 'Josh Fraser')[0] ?? [];
    return [{ name: 'club coach table has Josh Fraser: 16 games, 12 W, 1 D, 3 L', ok: ['16', '12', '1', '3'].every((x) => row.includes(x)), seen: row }];
  } },
];

const log: unknown[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString();
async function once(path: string, via: 'public' | 'loopback', checks?: (h: string) => Check[]) {
  const t0 = stamp();
  try {
    const r = await get(path, via);
    const c = r.status === 200 && checks ? checks(r.body) : [];
    const rec = { at: t0, via, path, status: r.status, headers: r.headers, bodyBytes: r.body.length, checks: c.map((x) => ({ name: x.name, ok: x.ok, seen: x.seen })), allOk: c.length > 0 && c.every((x) => x.ok) };
    log.push(rec);
    return { rec, body: r.body };
  } catch (e) {
    const rec = { at: t0, via, path, error: String((e as Error).message ?? e) };
    log.push(rec);
    return { rec, body: '' };
  }
}

console.log(`probe subject ${SUBJECT}; created ${createdAt.toISOString()}; expires ${expiresAt.toISOString()}; epoch ${epoch}; mode ${mode}`);
if (mode === 'inspect') {
  for (const p of PAGES) {
    const { rec, body } = await once(p.path, 'public', p.checks);
    console.log(JSON.stringify(rec));
    if (rec.status === 200) {
      for (const n of ['Carr', 'Fraser']) for (const r of rowsWith(body, `Josh ${n}`).slice(0, 2)) console.log(`  row[${n}]`, JSON.stringify(r));
      const t = text(body); const i = t.indexOf('Carr'); console.log('  text-near-Carr:', i >= 0 ? t.slice(Math.max(0, i - 80), i + 200) : '(none)');
    }
    await sleep(1500);
  }
} else {
  // ONE token, ONE process. Rounds are bounded by the token's own lifetime (stop 5 minutes before expiry).
  const workerPids = (process.argv[5] ?? '').split(',').filter(Boolean);
  if (workerPids.length < 2) throw new Error('pass the two serving worker pids as argv[5]');
  type St = { requests: number; lastOk: Map<string, boolean>; firstOkAt: string | null; firstNonMatchAt: string | null; satisfied: boolean };
  const state = new Map<string, St>(PAGES.map((p) => [p.path, { requests: 0, lastOk: new Map(), firstOkAt: null, firstNonMatchAt: null, satisfied: false }]));
  const sweep = async (p: (typeof PAGES)[number], via: 'public' | 'loopback', st: St) => {
    for (let i = 0; i < 8; i += 1) {
      const burst = await Promise.all([once(p.path, via, p.checks), once(p.path, via, p.checks)]);
      st.requests += 2;
      for (const { rec } of burst) {
        const r = rec as { at: string; headers?: Record<string, string>; allOk?: boolean };
        const pid = r.headers?.['x-afldb-pid'];
        if (!pid) continue;
        st.lastOk.set(pid, !!r.allOk);
        if (r.allOk) st.firstOkAt ??= r.at; else st.firstNonMatchAt ??= r.at;
      }
      if (workerPids.every((w) => st.lastOk.get(w) === true)) { st.satisfied = true; return; }
      await sleep(1500);
    }
  };
  for (let round = 1; ; round += 1) {
    for (const p of PAGES) { const st = state.get(p.path)!; if (!st.satisfied) { log.push({ round, page: p.path, via: 'public', startedAt: stamp() }); await sweep(p, 'public', st); } }
    const pending = PAGES.filter((p) => !state.get(p.path)!.satisfied);
    console.log(`round ${round} done at ${stamp()}; pending public pages: ${pending.map((p) => p.path).join(' ') || 'none'}`);
    if (pending.length === 0 || Date.now() > expiresAt.getTime() - 5 * 60 * 1000) break;
    await sleep(90000);
  }
  // Loopback DIAGNOSTIC (labelled; same host, same application): only for pages whose public observations did not cover every worker.
  for (const p of PAGES) {
    const st = state.get(p.path)!;
    if (st.satisfied) continue;
    const lb: St = { requests: 0, lastOk: new Map(), firstOkAt: null, firstNonMatchAt: null, satisfied: false };
    log.push({ diagnostic: 'loopback', page: p.path, startedAt: stamp() });
    await sweep(p, 'loopback', lb);
    log.push({ diagnostic: 'loopback-summary', page: p.path, requests: lb.requests, perPidLastOk: Object.fromEntries(lb.lastOk) });
  }
  for (const p of PAGES) {
    const st = state.get(p.path)!;
    log.push({ summary: p.path, via: 'public', requests: st.requests, perPidLastOk: Object.fromEntries(st.lastOk), expectedWorkerPids: workerPids, satisfiedOnBothWorkers: st.satisfied, firstExpectedObservedAt: st.firstOkAt, firstNonMatchingObservedAt: st.firstNonMatchAt });
    console.log(JSON.stringify(log[log.length - 1]));
  }
}
writeFileSync(outPath, JSON.stringify({ subject: SUBJECT, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), kind: 'beta', epoch, mode, host: PUBLIC_HOST, log }, null, 1) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`wrote ${outPath}`);
