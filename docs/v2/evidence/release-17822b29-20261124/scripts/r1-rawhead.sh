#!/usr/bin/env bash
# Release 17822b29, raw-head checks, READ-ONLY loopback GETs. PRODUCTION, as arm.
#   baseline  (after P1, before any change; old build 7d92042f): writes /home/arm/r1-rawhead-baseline.json (refuses to overwrite).
#   check     (after the restart and the season refresh; and after a rollback): compares with that baseline.
# Pages /brownlow/2026 and /seasons/2026, 8 samples each, EVERY request on a NEW connection (agent:false; the cluster primary
# distributes connections round-robin across AFLDB_WORKERS=2): 200; exactly one document <title> (outside <script> and <svg>)
# equal to the expected text below; robots meta exactly
# "noindex, nofollow" (the beta host's site-wide setting); in check mode both equal to the baseline; /brownlow/2026 shows
# "Won by Nick Daicos with 47 votes" and exactly 14 rendered "Recorded ineligible" badge spans (published revision 3, unchanged).
# Controls: /brownlow/2099 is a GENUINE 404 (4 samples: 404, title "Page not found | AFLDB", no "Won by" text); /brownlow/02026 404.
# ISSUE-367 live controls: each UNACCEPTED_YEARS season from P1 (votes stored, not accepted) is recorded in baseline (the old build
# answers 200 for it) and in check must answer 404 with the not-found title and no "Won by" text. "none" = no live example.
# Sitemap: /sitemap.xml and /sitemap/1.xml are withheld under the beta gate (indexingEnabled() is false while AFLDB_BETA_GATE=on):
# both must answer 404 in baseline and check; /robots.txt must answer 200 with a body equal to the baseline. The accepted-only
# sitemap CONTENT is proven by tests (brownlow-pending-projection 17/17, Astra's matched 17/17), not live.
# Check mode also compares titles/robots with Sunday's /home/arm/a1-rawhead-baseline.json when present (R6's post-reboot raw-head
# check reuses that file): a difference prints R6-NOTE, which is not a release failure but must be resolved before Wednesday.
# Admission: production runs the beta gate, so the probe mints a 15-minute beta claim from .env IN MEMORY (as signClaim does);
# the claim, cookie and secret are never printed or written. x-afldb-worker is recorded when present (tracing is off on production,
# so per-response worker identity is normally absent; the per-worker guarantee is P5 check 4 plus every sample passing).
# Run: tr -d '\r' < r1-rawhead.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- baseline|check <UNACCEPTED_YEARS>
# Test seam: R1_LIB_ONLY=1 when sourced; rawhead_run <env-file> <port> <mode> <baseline-file> <unaccepted> <sunday-file>.
rawhead_run() {
local envf=$1 port=$2 mode=$3 bl=$4 unacc=$5 sunday=$6 js rc=0
js=$(mktemp --suffix=.mjs); chmod 600 "$js"
cat > "$js" <<'NODE'
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import http from 'node:http';
const [port, mode, blFile, unaccArg, sundayFile] = process.argv.slice(2);
const env = process.env;
const b64 = (b) => Buffer.from(b).toString('base64url');
const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'beta', sub: 'r1-rawhead', exp: Math.floor(Date.now() / 1000) + 900, epoch: Number(env.AFLDB_BETA_EPOCH ?? 1) }));
const cookie = `afldb_beta=${b64(payload)}.${b64(createHmac('sha256', env.AFLDB_SESSION_SECRET).update(payload).digest())}`;
const get = (path) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: Number(port), path, method: 'GET', agent: false, headers: { cookie } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ code: res.statusCode, cache: res.headers['x-nextjs-cache'] ?? null, worker: res.headers['x-afldb-worker'] ?? null, body }));
  });
  req.setTimeout(60000, () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end();
});
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;|&#160;/g, ' ');
// The document <title>: anywhere in the HTML (Next may stream metadata into <body>), but never inside <script> (the RSC payload)
// or <svg> (icon titles). Exactly one is required.
const doc = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
const titles = (h) => [...doc(h).matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map((m) => dec(m[1]));
const robots = (h) => (doc(h).match(/<meta name="robots" content="([^"]*)"/) || [, null])[1];
const text = (h) => dec(h.replace(/<!-- -->/g, '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const sha = async (s) => (await import('node:crypto')).createHash('sha256').update(s).digest('hex');
const EXPECT = {
  '/brownlow/2026': '2026 Brownlow Medal — Winner, Votes & Leaderboard | AFLDB',
  '/seasons/2026': '2026 AFL Season — Ladder, Results & Finals | AFLDB',
};
const NOT_FOUND = 'Page not found | AFLDB', ROBOTS = 'noindex, nofollow';
const unaccepted = unaccArg === 'none' ? [] : unaccArg.split(',');
const out = { mode, at: new Date().toISOString(), pages: {}, controls: {}, unaccepted: {}, sitemap: {}, r6note: [] }; let bad = 0;
const bl = mode === 'check' ? JSON.parse(readFileSync(blFile, 'utf8')) : null;
const fail = (where, why) => { bad += 1; (out.fails ??= []).push(`${where}: ${why}`); };
for (const p of Object.keys(EXPECT)) {
  const samples = [];
  for (let i = 0; i < 8; i += 1) {
    const r = await get(p); const t = titles(r.body), rb = robots(r.body);
    const s = { code: r.code, cache: r.cache, worker: r.worker, title: t.join(' || '), robots: rb };
    if (r.code !== 200) fail(p, `sample ${i} code ${r.code}`);
    if (t.length !== 1 || t[0] !== EXPECT[p]) fail(p, `sample ${i} title '${s.title}'`);
    if (rb !== ROBOTS) fail(p, `sample ${i} robots ${rb}`);
    if (bl && (s.title !== bl.pages[p].title || rb !== bl.pages[p].robots)) fail(p, `sample ${i} differs from the baseline`);
    if (p === '/brownlow/2026') {
      s.badges = (r.body.match(/badge badge-warn">Recorded ineligible</g) || []).length;
      s.winner = /Won by Nick Daicos with 47 votes/.test(text(r.body));
      if (!s.winner) fail(p, `sample ${i} winner sentence missing`);
      if (s.badges !== 14) fail(p, `sample ${i} ineligible badges ${s.badges}`);
    }
    samples.push(s);
  }
  out.pages[p] = { title: samples[0].title, robots: samples[0].robots, samples };
}
const notFoundCheck = async (p, n, record) => {
  const seen = [];
  for (let i = 0; i < n; i += 1) {
    const r = await get(p); const t = titles(r.body).join(' || ');
    seen.push({ code: r.code, title: t, won: /Won by /.test(text(r.body)) });
  }
  record[p] = seen; return seen;
};
for (const s of await notFoundCheck('/brownlow/2099', 4, out.controls)) {
  if (s.code !== 404 || s.title !== NOT_FOUND || s.won) fail('/brownlow/2099', `genuine 404 control ${JSON.stringify(s)}`);
}
for (const s of await notFoundCheck('/brownlow/02026', 2, out.controls)) if (s.code !== 404) fail('/brownlow/02026', `code ${s.code}`);
for (const y of unaccepted) {
  const seen = await notFoundCheck(`/brownlow/${y}`, 2, out.unaccepted);
  if (bl) for (const s of seen) if (s.code !== 404 || s.title !== NOT_FOUND || s.won) fail(`/brownlow/${y}`, `ISSUE-367 live control ${JSON.stringify(s)}`);
}
for (const p of ['/sitemap.xml', '/sitemap/1.xml', '/robots.txt']) {
  const r = await get(p); out.sitemap[p] = { code: r.code, sha256: await sha(r.body) };
  if (p === '/robots.txt') { if (r.code !== 200 || (bl && out.sitemap[p].sha256 !== bl.sitemap[p].sha256)) fail(p, `code ${r.code} or body differs from the baseline`); }
  else if (r.code !== 404) fail(p, `code ${r.code} (withheld under the beta gate: expect 404)`);
}
if (bl && sundayFile && existsSync(sundayFile)) {
  const sun = JSON.parse(readFileSync(sundayFile, 'utf8'));
  for (const p of Object.keys(EXPECT)) {
    if (sun.pages?.[p]?.title !== out.pages[p].title || sun.pages?.[p]?.robots !== out.pages[p].robots) out.r6note.push(`${p} title/robots differ from Sunday's a1 baseline`);
  }
}
out.bad = bad; out.pass = bad === 0;
if (!bl) { if (existsSync(blFile)) { console.log(`STOP baseline file ${blFile} already exists`); process.exit(1); } writeFileSync(blFile, JSON.stringify(out, null, 1)); }
console.log(JSON.stringify({ mode, pages: Object.fromEntries(Object.entries(out.pages).map(([k, v]) => [k, { title: v.title, robots: v.robots, codes: v.samples.map((s) => s.code), cache: v.samples.map((s) => s.cache), workers: v.samples.map((s) => s.worker), badges: v.samples.map((s) => s.badges ?? null) }])), controls: out.controls, unaccepted: out.unaccepted, sitemap: out.sitemap, fails: out.fails ?? [], bad }, null, 1));
for (const n of out.r6note) console.log(`R6-NOTE ${n}`);
if (bl && sundayFile && existsSync(sundayFile) && out.r6note.length === 0) console.log("R6-NOTE none: titles and robots equal Sunday's a1-rawhead baseline (Wednesday's raw-head check stays valid)");
console.log(out.pass ? `RAWHEAD RESULT ${mode} PASS` : `RAWHEAD RESULT ${mode} FAIL (${bad})`);
process.exit(out.pass ? 0 : 1);
NODE
( set -a; . "$envf"; set +a; node "$js" "$port" "$mode" "$bl" "$unacc" "$sunday" ) || rc=$?
rm -f "$js"; return $rc
}
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
C=/home/arm/projects/afldb
MODE=${1:?mode}; [[ $MODE =~ ^(baseline|check)$ ]]
UNACC=${2:?UNACCEPTED_YEARS from P1 (none or a comma list)}; [[ $UNACC =~ ^(none|[0-9]{4}(,[0-9]{4})*)$ ]]
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
echo "== R1 rawhead $MODE $(date -u +%FT%TZ) unaccepted=$UNACC"
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3100}; [[ $P =~ ^[0-9]+$ ]]
rawhead_run "$C/.env" "$P" "$MODE" /home/arm/r1-rawhead-baseline.json "$UNACC" /home/arm/a1-rawhead-baseline.json
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
