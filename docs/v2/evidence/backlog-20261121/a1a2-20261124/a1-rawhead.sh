#!/usr/bin/env bash
# Sitting A1, raw-head checks (ISSUE-371/372), READ-ONLY loopback GETs. PRODUCTION, as arm.
#   baseline  (at P1, before any change): 8 fresh-connection samples each of /brownlow/2026 and /seasons/2026; every sample must
#             be 200 without the not-found title; records title and robots per path to /home/arm/a1-rawhead-baseline.json.
#   check     (acceptance, after the restart and the season refresh): the same 8+8 samples; every sample 200, title and robots
#             EQUAL to the baseline, no "Page not found" title; /brownlow/2026 body shows "Won by Nick Daicos with 47 votes" and
#             exactly 14 "Recorded ineligible" markers; controls /brownlow/2099 and /brownlow/02026 answer 404 on every sample.
# Admission: production runs the beta gate, so the probe mints a 15-minute beta claim from .env IN MEMORY (as signClaim does);
# the claim, cookie and secret are never printed or written. Every request opens a NEW connection (agent:false); the cluster
# primary distributes connections round-robin (Node cluster default on Linux) across AFLDB_WORKERS=2, so 8 samples reach both
# workers. Production does not set AFLDB_TRACE_REQUESTS, so per-response worker identity is NOT visible; the per-worker
# guarantee is the revalidate CLI's "2/2 worker(s) reached" plus every sample passing. x-afldb-worker is recorded if present.
# Run: tr -d '\r' < a1-rawhead.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- baseline|check
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
C=/home/arm/projects/afldb; NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node; BL=/home/arm/a1-rawhead-baseline.json
MODE=${1:?mode}; [[ $MODE =~ ^(baseline|check)$ ]]
echo "== A1 rawhead $MODE $(date -u +%FT%TZ)"
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3100}; [[ $P =~ ^[0-9]+$ ]]
JS=$(mktemp --suffix=.mjs); chmod 600 "$JS"
cat > "$JS" <<'NODE'
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import http from 'node:http';
const [port, mode, blFile] = process.argv.slice(2);
const env = process.env;   // .env sourced by the calling subshell (set -a), as the 7R3 P10 block does
const b64 = (b) => Buffer.from(b).toString('base64url');
const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'beta', sub: 'a1-rawhead', exp: Math.floor(Date.now() / 1000) + 900, epoch: Number(env.AFLDB_BETA_EPOCH ?? 1) }));
const cookie = `afldb_beta=${b64(payload)}.${b64(createHmac('sha256', env.AFLDB_SESSION_SECRET).update(payload).digest())}`;
const get = (path) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: Number(port), path, method: 'GET', agent: false, headers: { cookie } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ code: res.statusCode, cache: res.headers['x-nextjs-cache'] ?? null, worker: res.headers['x-afldb-worker'] ?? null, body }));
  });
  req.setTimeout(60000, () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end();
});
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;|&#160;/g, ' ');
const title = (h) => dec((h.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [, null])[1] ?? '');
const robots = (h) => (h.match(/<meta name="robots" content="([^"]*)"/) || [, null])[1];
const text = (h) => dec(h.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const PAGES = ['/brownlow/2026', '/seasons/2026'], CONTROLS = ['/brownlow/2099', '/brownlow/02026'];
const out = { mode, at: new Date().toISOString(), pages: {}, controls: {} }; let bad = 0;
const bl = mode === 'check' ? JSON.parse(readFileSync(blFile, 'utf8')) : null;
for (const p of PAGES) {
  const samples = [];
  for (let i = 0; i < 8; i += 1) {
    const r = await get(p); const t = title(r.body), rb = robots(r.body);
    const s = { code: r.code, cache: r.cache, worker: r.worker, title: t, robots: rb };
    const why = [];
    if (r.code !== 200) why.push(`code ${r.code}`);
    if (/Page not found/.test(t)) why.push('not-found title');
    if (bl) {
      if (t !== bl.pages[p].title) why.push(`title differs from baseline`);
      if (rb !== bl.pages[p].robots) why.push(`robots ${rb} != baseline ${bl.pages[p].robots}`);
      if (p === '/brownlow/2026') {
        const x = text(r.body);
        if (!/Won by Nick Daicos with 47 votes/.test(x)) why.push('winner sentence missing');
        const n = (r.body.match(/badge badge-warn">Recorded ineligible</g) || []).length; s.ineligibleBadgeSpans = n; s.textOccurrences = (x.match(/Recorded ineligible/g) || []).length;
        if (n !== 14) why.push(`ineligible markers ${n}`);
      }
    }
    if (why.length) { bad += 1; s.fail = why; }
    samples.push(s);
  }
  const titles = [...new Set(samples.map((s) => s.title))], robs = [...new Set(samples.map((s) => s.robots))];
  if (!bl && (titles.length !== 1 || robs.length !== 1)) { bad += 1; out.baselineUnstable = true; }
  out.pages[p] = { title: titles[0], robots: robs[0], titles, robots_seen: robs, samples };
}
for (const p of CONTROLS) {
  const codes = []; for (let i = 0; i < 4; i += 1) codes.push((await get(p)).code);
  out.controls[p] = codes; if (bl && codes.some((c) => c !== 404)) bad += 1;   // baseline: recorded only
}
out.bad = bad; out.pass = bad === 0;
if (!bl) { if (existsSync(blFile)) { console.log(`STOP baseline file ${blFile} already exists`); process.exit(1); } writeFileSync(blFile, JSON.stringify(out, null, 1)); }
console.log(JSON.stringify({ mode, pages: Object.fromEntries(Object.entries(out.pages).map(([k, v]) => [k, { title: v.title, robots: v.robots, codes: v.samples.map((s) => s.code), cache: v.samples.map((s) => s.cache), workers: v.samples.map((s) => s.worker), fails: v.samples.filter((s) => s.fail).map((s) => s.fail) }])), controls: out.controls, bad }, null, 1));
console.log(out.pass ? `RAWHEAD RESULT ${mode} PASS` : `RAWHEAD RESULT ${mode} FAIL (${bad})`);
process.exit(out.pass ? 0 : 1);
NODE
rc=0; ( set -a; . "$C/.env"; set +a; "$NODE" "$JS" "$P" "$MODE" "$BL" ) || rc=$?
rm -f "$JS"; exit $rc
}
main "$@" < /dev/null
