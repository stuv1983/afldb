// ISSUE-333 second, narrowly bounded public-visibility probe (-r2). Read-only public GETs with ONE temporary beta-admission cookie (kind='beta' only).
// Runs inside one process on the production host. The signing secret and the token live in this process's memory only: never printed, never in
// argv, never written to a file, sent only as a Cookie header to PUBLIC_HOST over TLS; no redirect is followed; no cookie jar.
// Usage (ops checkout, via tsx):  node --import tsx --conditions=react-server visibility-beta-probe-r2.mts <mainpid> <out.json>
//
// Hard limits (owner instruction):
//   - /clubs/port-adelaide only; at most MAX_REQUESTS (10) GETs; request starts at least MIN_GAP_MS (5 s) apart; per-request timeout;
//   - stop immediately when the expected coaching row is observed; stop after DEADLINE_MS (2 min) regardless;
//   - no loopback request, no dependence on any x-afldb-* header, no renewal, no forced revalidation.
// The selector and the limits are validated BEFORE any token is created.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { signClaim, BETA_COOKIE } from '@/lib/auth/tokens';
import { EXPECTED_CARR, selectCoachRow, selfTest, type Selection } from './coach-row-selector.mts';

const PUBLIC_HOST = 'beta.afldb.com';
const PATH = '/clubs/port-adelaide';
const SUBJECT = 'issue333-readonly-probe-20261104-r2';
const TTL_SECONDS = 6 * 60; // <= 10 minutes
const MAX_REQUESTS = 10;
const MIN_GAP_MS = 5_000;
const GAP_MS = 5_500; // scheduled gap, strictly above the minimum
const REQUEST_TIMEOUT_MS = 15_000;
const DEADLINE_MS = 120_000;
const KEEP_HEADERS = ['date', 'cache-control', 'x-nextjs-cache', 'x-nextjs-prerender', 'age', 'cf-cache-status', 'last-modified', 'etag', 'content-type', 'content-length', 'vary', 'location'];

const [mainPid, outPath] = process.argv.slice(2, 4);
if (!mainPid || !/^\d+$/.test(mainPid) || !outPath) throw new Error('usage: <mainpid> <out.json>');
if (!(TTL_SECONDS <= 600 && MAX_REQUESTS <= 10 && GAP_MS >= MIN_GAP_MS && DEADLINE_MS <= 120_000 && REQUEST_TIMEOUT_MS < DEADLINE_MS)) throw new Error('request limits are outside the authorised bounds');
selfTest(); // selector ready; nothing secret exists yet
console.log(`pre-flight ok: selector self-test passed; limits max ${MAX_REQUESTS} GETs, gap ${GAP_MS} ms, timeout ${REQUEST_TIMEOUT_MS} ms, deadline ${DEADLINE_MS} ms, ttl ${TTL_SECONDS}s`);

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

// Token creation: only now, after the selector and the limits have been validated.
const createdAt = new Date();
const exp = Math.floor(createdAt.getTime() / 1000) + TTL_SECONDS;
const token = await signClaim({ v: 1, kind: 'beta', sub: SUBJECT, exp, epoch }, secret);
const expiresAt = new Date(exp * 1000);
const cookie = `${BETA_COOKIE}=${token}`;
console.log(`probe subject ${SUBJECT}; created ${createdAt.toISOString()}; expires ${expiresAt.toISOString()}; epoch ${epoch}`);

type Got = { status: number; headers: Record<string, string>; bodyBytes: number; bodySha256: string; selection: Selection | null };
function get(timeoutMs: number): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: PUBLIC_HOST, servername: PUBLIC_HOST, port: 443, path: PATH, method: 'GET', signal: AbortSignal.timeout(timeoutMs), headers: { Cookie: cookie, 'User-Agent': 'afldb-issue333-readonly-probe-r2', Accept: 'text/html', Connection: 'close' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const h: Record<string, string> = {};
          for (const k of KEEP_HEADERS) { const v = res.headers[k]; if (v !== undefined) h[k] = Array.isArray(v) ? v.join(',') : String(v); }
          const body = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          resolve({ status, headers: h, bodyBytes: body.length, bodySha256: createHash('sha256').update(body).digest('hex'), selection: status === 200 ? selectCoachRow(body.toString('utf8'), EXPECTED_CARR) : null });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const log: Record<string, unknown>[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const t0 = Date.now();
let stopReason = 'max-requests';
let observed: Record<string, unknown> | null = null;
let lastStart = 0;
for (let n = 1; n <= MAX_REQUESTS; n += 1) {
  if (n > 1) {
    const wait = Math.max(0, lastStart + GAP_MS - Date.now());
    if (Date.now() + wait - t0 >= DEADLINE_MS - REQUEST_TIMEOUT_MS / 3) { stopReason = 'deadline'; break; }
    await sleep(wait);
  }
  const remaining = DEADLINE_MS - (Date.now() - t0);
  if (remaining <= 1_000) { stopReason = 'deadline'; break; }
  lastStart = Date.now();
  const startedAt = new Date(lastStart).toISOString();
  try {
    const r = await get(Math.min(REQUEST_TIMEOUT_MS, remaining));
    const rec = { n, startedAt, receivedAt: new Date().toISOString(), status: r.status, serverDate: r.headers['date'] ?? null, headers: r.headers, bodyBytes: r.bodyBytes, bodySha256: r.bodySha256, selection: r.selection };
    log.push(rec);
    console.log(JSON.stringify({ n, startedAt, status: r.status, xNextjsCache: r.headers['x-nextjs-cache'] ?? null, bodyBytes: r.bodyBytes, selection: r.selection?.status === 'row' ? { matches: r.selection.matches, byHeader: r.selection.byHeader } : r.selection }));
    if (r.status >= 300 && r.status < 400) { stopReason = `gate-redirect-${r.status}`; break; }
    if (r.status === 200 && r.selection?.status === 'row' && r.selection.matches) { stopReason = 'expected-row-observed'; observed = rec; break; }
    if (r.selection?.status === 'refused' && ['ambiguous-table', 'ambiguous-row', 'bad-shape'].includes(r.selection.reason)) { stopReason = `refused-${r.selection.reason}`; break; }
  } catch (e) {
    log.push({ n, startedAt, receivedAt: new Date().toISOString(), error: String((e as Error).message ?? e) });
    console.log(JSON.stringify({ n, startedAt, error: String((e as Error).message ?? e) }));
  }
}
const finishedAt = new Date();
const summary = { stopReason, requests: log.length, observed: observed !== null, elapsedMs: finishedAt.getTime() - t0, finishedAt: finishedAt.toISOString() };
console.log(JSON.stringify({ summary }));
writeFileSync(outPath, JSON.stringify({ subject: SUBJECT, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), kind: 'beta', epoch, host: PUBLIC_HOST, path: PATH, expected: EXPECTED_CARR, limits: { MAX_REQUESTS, MIN_GAP_MS, GAP_MS, REQUEST_TIMEOUT_MS, DEADLINE_MS, TTL_SECONDS }, summary, log }, null, 1) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`wrote ${outPath}`);
