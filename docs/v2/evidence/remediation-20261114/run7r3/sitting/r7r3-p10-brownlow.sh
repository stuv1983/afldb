#!/usr/bin/env bash
# Release 7 revision 3 (R7R3), block P10 = phase-specific rendered Brownlow checks. PRODUCTION, as arm, READ-ONLY: loopback GETs with
# a 15-minute beta claim minted from .env (cookie file 600, removed at the end; never sent over the public route). Replaces the
# successor block p10-pages.sh, whose `after` mode expects D-365-W "Results not loaded", the no-votes text and /brownlow/2026 404.
#
#   pending    (after P9/S9, while 2026 is unpublished; also valid after the attachment, before publication)
#     Pendlebury and Daicos 2026 BV cells read "Awaiting verification" with the D-370-W tooltip; no page carries "Not yet awarded",
#     "Results not loaded", "No medal" or an award claim; their 2026 game logs show no vote; matches 17247 (R8) and 17151 (R21) have
#     no BV column; /seasons/2026 has no round-vote block and the no-votes text; /brownlow has no 2026 entry; /brownlow/2026 is 404.
#   published <ineligible slug-id list, comma separated, or none>   (after the owner's publication, binding only >= 65 min later)
#     Pendlebury 2026 = 5 (R8 = 3 on match 17247, R21 = 2 on match 17151; game-log sum 5); Daicos 2026 = 47 (game-log sum 47);
#     /seasons/2026 has 25 round-vote blocks, Pendlebury's round votes [3, 2], no no-votes text; /brownlow lists 2026 (Nick Daicos,
#     Collingwood, 47) with a link; /brownlow/2026 is 200, "Won by Nick Daicos with 47 votes", Bailey Smith 36, Marcus Bontempelli 34,
#     Scott Pendlebury 5, and the rows marked "Recorded ineligible" are exactly the given list.
#   Both phases, the 2025 control (accepted, must not change): Pendlebury 2025 = 2, Daicos 2025 = 32, /brownlow/2025 200 won by
#     Matt Rowell (39), match 16677 has 3 polled players; and anonymous /players/<A> is 307 to /beta?from=%2Fplayers%2F<A>.
# Every page is warmed (8 requests) and then sampled 8 times; every sample must pass (the page cache is per cluster worker).
# Any failed or missing check: P10 RESULT ... FAIL and exit 1. The owner's browser check (A3) is a separate result.
# Run: tr -d '\r' < r7r3-p10-brownlow.sh | ssh afldb bash -s -- pending
#      tr -d '\r' < r7r3-p10-brownlow.sh | ssh afldb bash -s -- published <list|none>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
C=${R7R3_CHECKOUT:-/home/arm/projects/afldb}; ENVF=${R7R3_ENV_FILE:-$C/.env}
NODE=${R7R3_NODE_BIN:-/home/arm/.nvm/versions/node/v22.23.2/bin}/node
MODE=${1:?mode}; [[ $MODE =~ ^(pending|published)$ ]]
INELIG=${2:-}; if [ "$MODE" = published ]; then [[ $INELIG =~ ^(none|[a-z0-9-]+-[0-9]+(,[a-z0-9-]+-[0-9]+)*)$ ]]; fi
echo "== R7R3 P10 $MODE $(date -u +%FT%TZ)"
P=$(sed -n 's/^PORT=//p' "$ENVF" | tail -1 | tr -d '"'); P=${P:-3100}; [[ $P =~ ^[0-9]+$ ]]
CK=$(mktemp); chmod 600 "$CK"; JS=$(mktemp --suffix=.mjs); chmod 600 "$JS"
( set -a; . "$ENVF"; set +a; "$NODE" -e 'const{createHmac}=require("crypto");const e=process.env;
const p=Buffer.from(JSON.stringify({v:1,kind:"beta",sub:"r7r3-p10",exp:Math.floor(Date.now()/1000)+900,epoch:Number(e.AFLDB_BETA_EPOCH??1)}));
process.stdout.write("afldb_beta="+p.toString("base64url")+"."+createHmac("sha256",e.AFLDB_SESSION_SECRET).update(p).digest().toString("base64url"))' ) > "$CK"
cat > "$JS" <<'NODE'
import { readFileSync } from 'node:fs';
const [base, cookieFile, mode, ineligArg] = process.argv.slice(2);
const cookie = readFileSync(cookieFile, 'utf8').trim();
const TOOLTIP = 'AFLDB has not yet verified and published the Brownlow results for this season.';
const FORBIDDEN = [/Not yet awarded/, /Results not loaded/, /No medal/, /has been awarded/, /still in progress; the Brownlow/, /have not been loaded yet/];
const PL = 'scott-pendlebury-11724', DA = 'nick-daicos-9910', M8 = 17247, M21 = 17151, M25 = 16677;
const strip = (s) => s.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'")
  .replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
const tables = (h) => [...h.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);
const rowsOf = (t) => {
  const body = (t.match(/<tbody\b[\s\S]*?<\/tbody>/) || [''])[0];
  return [...body.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((r) => ({
    html: r[0],
    cells: [...r[0].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({ text: strip(m[3]), title: (m[2].match(/title="([^"]*)"/) || [])[1] ?? null })),
  }));
};
/** Rows of tables that have a BV column (last header row), with that column's text and title. */
const bv = (h, re) => {
  const out = [];
  for (const t of tables(h)) {
    const head = (t.match(/<thead\b[\s\S]*?<\/thead>/) || [''])[0];
    const trs = [...head.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    const heads = [...(trs.at(-1) ?? '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1]).replace(/[^A-Za-z]/g, ''));
    const i = heads.indexOf('BV'); if (i < 0) continue;
    for (const r of rowsOf(t)) { const text = r.cells.map((c) => c.text).join(' | '); if (re.test(text)) out.push({ text, bv: r.cells[i]?.text ?? null, title: r.cells[i]?.title ?? null }); }
  }
  return out;
};
const allRows = (h) => tables(h).flatMap(rowsOf);
const seasonBlocks = (h) => [...h.matchAll(/<details\b[\s\S]*?<\/details>/g)].map((m) => m[0]).filter((d) => /Brownlow votes/.test(d)).map(strip);
const get = async (path, withCookie = true) => {
  const r = await fetch(base + path, { redirect: 'manual', headers: withCookie ? { cookie } : {} });
  return { code: r.status, location: r.headers.get('location'), html: await r.text() };
};
const yearCell = (h, y) => bv(h, new RegExp(`^${y}\\b`))[0] ?? { bv: null, title: null };
const polled = (rows) => rows.filter((r) => /^[123]$/.test(r.bv ?? ''));
const sum = (rows) => rows.reduce((s, r) => s + (/^\d+$/.test(r.bv ?? '') ? Number(r.bv) : 0), 0);
const forbidden = (h) => FORBIDDEN.filter((re) => re.test(strip(h))).map(String);

// check: [label, path, (page) => null | 'reason']
const P = mode === 'pending';
const ineligible = new Set(!ineligArg || ineligArg === 'none' ? [] : ineligArg.split(','));
const checks = [
  ['player-pendlebury', `/players/${PL}`, ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const c26 = yearCell(html, 2026), c25 = yearCell(html, 2025), f = forbidden(html);
    if (f.length) return `forbidden ${f}`;
    if (c25.bv !== '2') return `2025 cell ${c25.bv}`;
    return P ? (c26.bv === 'Awaiting verification' && c26.title === TOOLTIP ? null : `2026 cell ${c26.bv} / ${c26.title}`)
      : (c26.bv === '5' ? null : `2026 cell ${c26.bv}`);
  }],
  ['player-daicos', `/players/${DA}`, ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const c26 = yearCell(html, 2026), c25 = yearCell(html, 2025), f = forbidden(html);
    if (f.length) return `forbidden ${f}`;
    if (c25.bv !== '32') return `2025 cell ${c25.bv}`;
    return P ? (c26.bv === 'Awaiting verification' && c26.title === TOOLTIP ? null : `2026 cell ${c26.bv} / ${c26.title}`)
      : (c26.bv === '47' ? null : `2026 cell ${c26.bv}`);
  }],
  ['gamelog-pendlebury-2026', `/players/${PL}/matches?season=2026`, ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const rows = bv(html, /^/), p = polled(rows);
    if (rows.length === 0) return 'no BV column';
    if (P) return p.length === 0 && sum(rows) === 0 ? null : `polled ${p.length} sum ${sum(rows)}`;
    const r8 = p.find((r) => /\bR8\b/.test(r.text)), r21 = p.find((r) => /\bR21\b/.test(r.text));
    return p.length === 2 && r8?.bv === '3' && r21?.bv === '2' && sum(rows) === 5 ? null : `polled ${p.map((r) => r.bv)} R8 ${r8?.bv} R21 ${r21?.bv} sum ${sum(rows)}`;
  }],
  ['gamelog-daicos-2026', `/players/${DA}/matches?season=2026`, ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const rows = bv(html, /^/);
    if (rows.length === 0) return 'no BV column';
    return sum(rows) === (P ? 0 : 47) ? null : `sum ${sum(rows)}`;
  }],
  ['match-17247-r8', `/matches/${M8}`, ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const r = bv(html, /Scott Pendlebury/);
    return P ? (r.length === 0 ? null : `BV shown ${r.map((x) => x.bv)}`) : (r.length === 1 && r[0].bv === '3' ? null : `Pendlebury BV ${r.map((x) => x.bv)}`);
  }],
  ['match-17151-r21', `/matches/${M21}`, ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const r = bv(html, /Scott Pendlebury/);
    return P ? (r.length === 0 ? null : `BV shown ${r.map((x) => x.bv)}`) : (r.length === 1 && r[0].bv === '2' ? null : `Pendlebury BV ${r.map((x) => x.bv)}`);
  }],
  ['season-2026', '/seasons/2026', ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const blocks = seasonBlocks(html), nv = (html.match(/No votes recorded for(?: |<!-- -->)*2026/g) || []).length;
    if (P) return blocks.length === 0 && nv >= 1 ? null : `blocks ${blocks.length} novotes ${nv}`;
    const pend = blocks.map((t) => (t.match(/Scott Pendlebury Collingwood (\d)/) || [])[1]).filter(Boolean);
    return blocks.length === 25 && nv === 0 && pend.join(',') === '3,2' ? null : `blocks ${blocks.length} novotes ${nv} pendlebury [${pend}]`;
  }],
  ['brownlow-index', '/brownlow', ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const links = (html.match(/href="\/brownlow\/2026"/g) || []).length;
    const row26 = allRows(html).map((r) => r.cells.map((c) => c.text).join(' | ')).find((t) => /^2026 \|/.test(t));
    if (P) return links === 0 && !row26 ? null : `links ${links} row ${row26}`;
    return links >= 1 && /^2026 \| Nick Daicos \| Collingwood \| 47$/.test(row26 ?? '') ? null : `links ${links} row ${row26}`;
  }],
  ['brownlow-2026', '/brownlow/2026', ({ code, html }) => {
    if (P) return code === 404 ? null : `code ${code} (expected 404)`;
    if (code !== 200) return `code ${code}`;
    const rows = allRows(html).map((r) => ({ text: r.cells.map((c) => c.text).join(' | '), href: (r.html.match(/href="\/players\/([a-z0-9-]+-\d+)"/) || [])[1] }));
    const find = (name) => rows.find((r) => r.text.includes(` | ${name} | `));
    const vote = (name) => find(name)?.text.split(' | ')[2];
    const marked = new Set(rows.filter((r) => /Recorded ineligible/i.test(r.text)).map((r) => r.href));
    const same = marked.size === ineligible.size && [...marked].every((h) => ineligible.has(h));
    const won = /Won by(?: |<!-- -->)*Nick Daicos(?: |<!-- -->)*with(?: |<!-- -->)*47(?: |<!-- -->)*votes/.test(html);
    const ok = won && /Winner/.test(find('Nick Daicos')?.text ?? '') && vote('Nick Daicos') === '47' && vote('Bailey Smith') === '36'
      && vote('Marcus Bontempelli') === '34' && vote('Scott Pendlebury') === '5' && same;
    return ok ? null : `won ${won} daicos ${vote('Nick Daicos')} smith ${vote('Bailey Smith')} bont ${vote('Marcus Bontempelli')} pend ${vote('Scott Pendlebury')} ineligible marked [${[...marked]}]`;
  }],
  ['brownlow-2025', '/brownlow/2025', ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const rows = allRows(html).map((r) => r.cells.map((c) => c.text).join(' | '));
    const vote = (name) => rows.find((t) => t.includes(` | ${name} | `))?.split(' | ')[2];
    const rowell = rows.find((t) => t.includes(' | Matt Rowell | '));
    return /Winner/.test(rowell ?? '') && vote('Matt Rowell') === '39' && vote('Nick Daicos') === '32' && vote('Scott Pendlebury') === '2'
      ? null : `rowell ${rowell} daicos ${vote('Nick Daicos')} pend ${vote('Scott Pendlebury')}`;
  }],
  ['match-16677-2025', `/matches/${M25}`, ({ code, html }) => {
    if (code !== 200) return `code ${code}`;
    const n = polled(bv(html, /^/)).length;
    return n === 3 ? null : `polled ${n}`;
  }],
];

let bad = 0, samples = 0;
const results = {};
for (const [label, path, test] of checks) {
  for (let i = 0; i < 8; i += 1) await get(path);                          // warm-up
  const reasons = new Set();
  for (let i = 0; i < 8; i += 1) { samples += 1; const why = test(await get(path)); if (why) { bad += 1; reasons.add(why); } }
  results[label] = reasons.size ? [...reasons].slice(0, 3) : 'PASS';
  console.log(`P10 CHECK ${label.padEnd(24)} ${reasons.size ? 'FAIL ' + [...reasons].slice(0, 3).join(' || ') : 'PASS'} (${path})`);
}
const anon = await get(`/players/${PL}`, false);
const want = `/beta?from=%2Fplayers%2F${PL}`;
const aPath = (anon.location ?? '').replace(/^https?:\/\/[^/]+/, '');
const anonOk = anon.code === 307 && aPath === want;
console.log(`P10 CHECK anon                     ${anonOk ? 'PASS' : 'FAIL'} code=${anon.code} location=${anon.location} (expected 307 to <origin>${want})`);
const pass = bad === 0 && anonOk && samples === checks.length * 8;
console.log(`P10 VERDICT ${JSON.stringify({ mode, samples, bad, anon: anonOk, ineligible: [...ineligible], results, pass })}`);
console.log(pass ? `P10 RESULT ${mode} PASS (${checks.length} pages x 8 samples, anon control)` : `P10 RESULT ${mode} FAIL (${bad} bad samples, anon ${anonOk})`);
process.exitCode = pass ? 0 : 1;
NODE
rc=0; "$NODE" "$JS" "http://127.0.0.1:$P" "$CK" "$MODE" "${INELIG:-none}" || rc=$?
rm -f "$CK" "$JS"
echo "P10 CHECK manual-browser NOT-RECORDED (the owner's browser check A3 is a separate result)"
exit $rc
}
main "$@" < /dev/null
