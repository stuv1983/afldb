#!/usr/bin/env bash
# Release 17822b29, block P6: the full observation, about 31 minutes, READ-ONLY, in ONE connection: four ticks 10 minutes apart
# (t+0, +10, +20, +30) then release.mjs status (plain form, no events.log write). Each tick requires: ActiveState active, NRestarts 0,
# InvocationID = the owner's restart, the primary still running in releases/<NEW_ID>, loopback /api/health "status":"ok",
# /seasons/2026 and /brownlow/2026 200 with exactly one document <title> equal to the expected text (outside <script> and <svg>;
# Sunday defect D4: the RSC payload carries "Page not found" on every page), and journal_err_lines = 0 or "unreadable".
# journal_err_lines (p6_journal_errs) is the number of afldb journal ENTRIES at priority err or worse since the service's
# ActiveEnterTimestamp, as arm sees them: a number only when the control query (newest afldb entry, any priority) returns exactly
# one JSON object, which proves arm can read this unit's journal, AND the err query exits 0 with nothing but JSON objects (one
# line per entry, -o json). 0 = both succeeded and no entry; N > 0 = tick not OK; any failed, empty-control or non-JSON answer
# (no permission, bad --since, journalctl missing) = "unreadable", which is allowed for arm: the owner's sudo journal check
# printed at the end (p6_owner_block; the same two lines as RUNBOOK section 4.2) decides. That check passes only when sudo and
# journalctl exit 0 AND return no entry, and prints JOURNAL PASS or JOURNAL FAIL with the exit code and the entry count.
# A tick not OK = rollback trigger, decided with the owner. The owner's browser check (r1-browser.cjs) and S9 run during this
# block; they do not touch the service.
# Run: tr -d '\r' < r1-p6-observe.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <NEW_ID> <InvocationID>
# Test seam: R1_LIB_ONLY=1 when sourced; p6_tick <env-file> <port> prints "codes|titles" for the three GETs;
# p6_journal_errs <since> prints 0, N or unreadable; p6_owner_block <since> prints the owner's two lines.
p6_journal_errs() { # since
  local c o
  c=$(journalctl -u afldb -n 1 -o json --no-pager 2>&1) || { echo unreadable; return 0; }
  [ "$(grep -c '^{' <<< "$c")" = 1 ] && [ "$(grep -c '' <<< "$c")" = 1 ] || { echo unreadable; return 0; }
  o=$(journalctl -u afldb -p err --since "$1" -o json --no-pager 2>&1) || { echo unreadable; return 0; }
  [ -n "$o" ] || { echo 0; return 0; }
  if grep -qv '^{' <<< "$o"; then echo unreadable; else grep -c '^{' <<< "$o"; fi
}
p6_owner_block() { # since
  local re='^[A-Za-z0-9:+-]+( [A-Za-z0-9:+-]+)*$'
  [[ $1 =~ $re ]] || { echo "NO JOURNAL COMMAND: afldb ActiveEnterTimestamp is not a timestamp ('$1'); the journal check is NOT passed"; return 0; }
  echo 'J=$(sudo journalctl -u afldb -p err --since "'"$1"'" -q -o json --no-pager); R=$?'
  echo '[ "$R" = 0 ] && [ -z "$J" ] && echo "JOURNAL PASS rc=0 entries=0" || echo "JOURNAL FAIL rc=$R entries=$(grep -c "^{" <<< "$J")"'
}
p6_tick() { # env-file port
  ( set -a; . "$1"; set +a; node -e '
const { createHmac } = require("node:crypto"); const http = require("node:http");
const e = process.env, port = Number(process.argv[1]);
const p = Buffer.from(JSON.stringify({ v: 1, kind: "beta", sub: "r1-observe", exp: Math.floor(Date.now() / 1000) + 900, epoch: Number(e.AFLDB_BETA_EPOCH ?? 1) }));
const cookie = "afldb_beta=" + p.toString("base64url") + "." + createHmac("sha256", e.AFLDB_SESSION_SECRET).update(p).digest().toString("base64url");
const get = (path) => new Promise((ok) => { const r = http.request({ host: "127.0.0.1", port, path, agent: false, headers: { cookie } }, (res) => {
  let b = ""; res.setEncoding("utf8"); res.on("data", (c) => { b += c; }); res.on("end", () => ok({ code: res.statusCode, b })); });
  r.setTimeout(60000, () => r.destroy()); r.on("error", () => ok({ code: 0, b: "" })); r.end(); });
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "\x27").replace(/&quot;/g, "\"");
const title = (h) => [...h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map((m) => dec(m[1]));
(async () => {
  const h = await get("/api/health"), s = await get("/seasons/2026"), b = await get("/brownlow/2026");
  const st = title(s.b), bt = title(b.b);
  const okS = st.length === 1 && st[0] === "2026 AFL Season — Ladder, Results & Finals | AFLDB";
  const okB = bt.length === 1 && bt[0] === "2026 Brownlow Medal — Winner, Votes & Leaderboard | AFLDB";
  console.log(`health=${h.code}:${/"status":"ok"/.test(h.b) ? "ok" : "bad"} seasons=${s.code}:${okS ? "title-ok" : "title-BAD"} brownlow=${b.code}:${okB ? "title-ok" : "title-BAD"}`);
})();' "$2" )
}
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
C=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$C"
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^(17822b29e6de-[A-Za-z0-9_-]{1,64}|7d92042fd110-XWruOm_9nLCSMY8nGPqYU)$ ]]   # the second form after a rollback
INV0=${2:?InvocationID}; [[ $INV0 =~ ^[0-9a-f]{32}$ ]]
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3100}
REL=$(realpath "$ROOT/releases/$NEW_ID"); SINCE=$(systemctl show afldb -p ActiveEnterTimestamp --value)
echo "== R1 P6 $(date -u +%FT%TZ) release $NEW_ID invocation $INV0 since $SINCE"
bad=0
for t in 0 1 2 3; do
  [ $t = 0 ] || sleep 600
  S=$(systemctl show afldb -p ActiveState -p NRestarts -p InvocationID -p MemoryCurrent | tr '\n' ' ')
  M=$(systemctl show afldb -p MainPID --value); CW=$(readlink "/proc/$M/cwd" 2>/dev/null || echo '?')
  G=$(p6_tick "$C/.env" "$P" || echo "probe-error")
  J=$(p6_journal_errs "$SINCE")
  echo "tick $t $(date -u +%FT%TZ) $S cwd=$CW $G journal_err_lines=$J"
  { [[ $S == *ActiveState=active* ]] && [[ $S == *NRestarts=0* ]] && [[ $S == *"InvocationID=$INV0"* ]] && [ "$CW" = "$REL" ] \
    && [[ $G == "health=200:ok seasons=200:title-ok brownlow=200:title-ok" ]] && { [ "$J" = 0 ] || [ "$J" = unreadable ]; }; } || { echo "  TICK $t NOT OK"; bad=$((bad+1)); }
done
echo "== final status $(date -u +%FT%TZ)"
"$N" deploy/release.mjs status
echo "OWNER NOW (two lines, sudo; expect JOURNAL PASS rc=0 entries=0; anything else, or no verdict line, is not a pass):"
p6_owner_block "$SINCE"
if [ $bad = 0 ]; then echo "P6 RESULT OBSERVATION PASS (4 ticks)"; else echo "P6 RESULT $bad tick(s) not OK"; exit 1; fi
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
