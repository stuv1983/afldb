#!/usr/bin/env bash
# ISSUE-336/337/340/345 release qualification at R' on streamanator (pattern: issue334-335 qual-host-r2.sh).
# Everything lives under $W on /mnt/ssd. No sudo. Touches no DEV service and no existing directory; only READS the
# approved, restore-verified production snapshot (ISSUE-333 O2 capture, ledger 118). Own loopback cluster on $PORT,
# databases afldb_v2_*_test only. The cluster is STOPPED at the end (data directory retained; deletion not authorised).
# Usage: W=/mnt/ssd/afldb-i336rel-qual-<ts> R=<40-hex> OUT=<40-hex> CAND_SHA=<sha256> bash qual336-host.sh [phase ...]
set -u -o pipefail
: "${W:?}" "${R:?}" "${OUT:?}" "${CAND_SHA:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
DUMP_BYTES=30141895
LOCK_SHA=984b44221f8f7256
PORT=55498
EV="$W/evidence"; mkdir -p "$EV"
SUM="$EV/SUMMARY.txt"
CAND="$W/cand"
TMPL=afldb_v2_i336reltmpl_test
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
phase() {
  local name="$1"; shift
  say "PHASE $name: start"
  "$@" > "$EV/$name.log" 2>&1; local rc=$?
  if [ $rc -eq 0 ]; then say "PHASE $name: PASS"; echo "PASS $name" >> "$SUM"; else say "PHASE $name: FAIL rc=$rc"; echo "FAIL $name rc=$rc" >> "$SUM"; fi
  return $rc
}
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
VT() { node node_modules/vitest/vitest.mjs run "$@"; }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -v -i 'postgres://'; }
listener_is_ours() {
  local pmpid; pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
  ss -ltnp 2>/dev/null | grep ":$PORT " > "$EV/listener.txt"
  cat "$EV/listener.txt"; echo "postmaster pid $pmpid"
  [ "$(grep -c "127.0.0.1:$PORT " "$EV/listener.txt")" = 1 ] || { echo "not exactly one listener on 127.0.0.1:$PORT"; return 1; }
  [ "$(grep -c "pid=$pmpid," "$EV/listener.txt")" = 1 ] || { echo "listener is not our postmaster"; return 1; }
  [ "$(grep -c . "$EV/listener.txt")" = 1 ] || { echo "more than one listener row"; return 1; }
}

p0_resources() {
  df -h /mnt/ssd /; free -g | sed -n 2p; uptime; nproc
  avail_kb=$(df --output=avail -k /mnt/ssd | tail -1); [ "$avail_kb" -gt $((30*1024*1024)) ] || { echo "less than 30 GB free"; return 1; }
  mem_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo); [ "$mem_kb" -gt $((8*1024*1024)) ] || { echo "less than 8 GB MemAvailable"; return 1; }
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port $PORT in use"; return 1; fi
  echo "--- DEV services BEFORE (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  echo "--- snapshot present (read-only)"; ls -l "$DUMP"
}
p1_verify_inputs() {
  [ "$(sha256sum "$W/in/cand336.tar.gz" | cut -d' ' -f1)" = "$CAND_SHA" ] || { echo "cand336.tar.gz sha256 mismatch"; return 1; }
  [ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { echo "snapshot size mismatch"; return 1; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "snapshot sha256 mismatch"; return 1; }
  echo "candidate tar and snapshot hashes verified (snapshot $DUMP_SHA, $DUMP_BYTES bytes)"
  cd "$W/in" && tar xzf cand336.tar.gz || return 1
  cd "$W" && git clone -q "$W/in/cand336.git" cand || return 1
  cd "$CAND"
  [ "$(git rev-parse HEAD)" = "$R" ] || { echo "HEAD is not $R"; return 1; }
  git cat-file -e "$OUT^{commit}" || { echo "serving revision $OUT absent"; return 1; }
  git merge-base --is-ancestor "$OUT" "$R" || { echo "OUT is not an ancestor of R"; return 1; }
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "candidate tree is dirty"; git status --porcelain | head; return 1; }
  echo "HEAD=$(git rev-parse HEAD) out=$OUT tracked=$(git ls-files | wc -l) dirty=0 shallow=$(git rev-parse --is-shallow-repository)"
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] || { echo "package-lock.json differs"; return 1; }
  echo "--- files R changes against the serving revision (stat)"; git diff --stat "$OUT" "$R" | tail -3
  echo "--- migrations at R"; ls src/db/migrations | tail -2; ls src/db/migrations | grep -c '\.sql$'
}
p2_deps() {
  cd "$CAND" && node -v && npm -v && npm ci --no-audit --no-fund 2>&1 | tail -8 || return 1
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] || { echo "npm ci changed package-lock.json"; return 1; }
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "npm ci dirtied tracked files"; git status --porcelain | head; return 1; }
}
p3_typecheck() {
  cd "$CAND" && node node_modules/next/dist/bin/next typegen && node node_modules/typescript/bin/tsc --noEmit -p . || return 1
  echo "tsc exit 0"; [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "typegen dirtied tracked files"; git status --porcelain | head; return 1; }
}
p4_cluster() {
  IR init || return 1
  IR start > "$EV/pg-start.out" 2>&1 < /dev/null
  sleep 3
  IR roles && IR status || return 1
  listener_is_ours
}
p5_template() {
  IR create-db "$TMPL" || return 1
  RUNDB "$TMPL" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || return 1
  RUNDB "$TMPL" node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -6
  cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
  RUNDB "$TMPL" node .probe-dbs.mjs "$TMPL" | tee "$EV/tmpl-probe.txt"
  rm -f "$CAND/.probe-dbs.mjs"
  [ "$(grep -c '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/tmpl-probe.txt")" = 1 ] || { echo "template ledger is not 118"; return 1; }
}
mkdbs() { for d in afldb_v2_i336lc_test afldb_v2_i336draft_test afldb_v2_i336build_test; do IR create-db "$d" --template "$TMPL" || return 1; done; }
# Release-delta unit suites named by the packet (section 4.1).
p6_unit() {
  cd "$CAND" || return 1
  VT tests/catalogue-lookups.test.ts tests/like.test.ts tests/gap029-rookie-selections.test.ts tests/auth.test.ts > "$EV/unit-verbose.log" 2>&1; local rc=$?
  strip < "$EV/unit-verbose.log" | grep -E "^ +(×|✓ tests/)|SKIPPED|skipped|Tests |Test Files" | tail -14
  return $rc
}
# Other unit suites the delta itself changes (not named by the packet; reported separately).
p6b_delta_unit() {
  cd "$CAND" || return 1
  VT tests/gap029-ops.test.ts tests/gap029-assembly.test.ts tests/draftguru-acquisition.test.ts tests/v2-season-seal.test.ts > "$EV/delta-unit-verbose.log" 2>&1; local rc=$?
  strip < "$EV/delta-unit-verbose.log" | grep -E "^ +(×|✓ tests/)|SKIPPED|skipped|Tests |Test Files" | tail -14
  return $rc
}
# Database-backed release suites, each on its own fresh copy of the production-derived template.
p7_integration() {
  cd "$CAND" || return 1
  RUNDB afldb_v2_i336lc_test node node_modules/vitest/vitest.mjs run tests/integration/admin-lifecycle.test.ts > "$EV/admin-lifecycle.log" 2>&1; local a=$?
  echo "=== admin-lifecycle rc=$a"; strip < "$EV/admin-lifecycle.log" | grep -E "^ +×|SKIPPED|Tests |Test Files" | tail -8
  RUNDB afldb_v2_i336draft_test node node_modules/vitest/vitest.mjs run tests/integration/admin-draft.test.ts > "$EV/admin-draft.log" 2>&1; local d=$?
  echo "=== admin-draft rc=$d"; strip < "$EV/admin-draft.log" | grep -E "^ +×|SKIPPED|Tests |Test Files" | tail -8
  [ "$a" -eq 0 ] && [ "$d" -eq 0 ]
}
# Production-mode build of R (the package script: next build --webpack + prepare-standalone), then a loopback boot smoke.
p8_build() {
  cd "$CAND" || return 1
  RUNDB afldb_v2_i336build_test env NODE_ENV=production node node_modules/next/dist/bin/next build --webpack > "$EV/build-next.log" 2>&1; local b=$?
  strip < "$EV/build-next.log" | grep -v -E '^\s*$' | tail -25
  [ "$b" -eq 0 ] || { echo "next build rc=$b"; return 1; }
  RUNDB afldb_v2_i336build_test node tools/build/prepare-standalone.mjs > "$EV/build-standalone.log" 2>&1 || { echo "prepare-standalone failed"; tail -20 "$EV/build-standalone.log"; return 1; }
  echo "BUILD_ID=$(cat .next/BUILD_ID)"; [ -f .next/standalone/server.js ] || { echo "no standalone server"; return 1; }
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "build dirtied tracked files"; git status --porcelain | head; return 1; }
  echo "build exit 0; tree clean"
}
p8b_boot_smoke() {
  cd "$CAND" || return 1
  local sp=$((PORT + 1000))
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$sp$"; then echo "port $sp in use"; return 1; fi
  RUNDB afldb_v2_i336build_test env NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$sp node .next/standalone/server.js > "$EV/boot.log" 2>&1 &
  local pid=$!
  local ok=1; for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$sp/" && { ok=0; break; }; sleep 1; done
  local fails=0
  if [ $ok -eq 0 ]; then
    for p in / /players /clubs /seasons /draft /draft/2025 /draft/2024; do
      code=$(curl -s -o "$EV/smoke-body.html" -w '%{http_code}' --max-time 60 "http://127.0.0.1:$sp$p"); echo "GET $p -> $code"
      [ "$code" = 200 ] || fails=$((fails+1))
    done
    echo "draft/2024 body bytes=$(wc -c < "$EV/smoke-body.html")"
  else echo "server did not answer within 60 s"; fails=99; fi
  # Stop only the process that listens on our smoke port (never a name match: DEV also runs a standalone server.js).
  local spid; spid=$(ss -ltnp 2>/dev/null | grep "127.0.0.1:$sp " | sed -n 's/.*pid=\([0-9]*\),.*/\1/p' | head -1)
  if [ -n "$spid" ] && [ "$(readlink -f /proc/$spid/cwd)" = "$(readlink -f "$CAND/.next/standalone")" -o -n "$(tr '\0' ' ' < /proc/$spid/cmdline | grep -F '.next/standalone/server.js')" ]; then
    echo "stopping smoke server pid $spid (cwd $(readlink -f /proc/$spid/cwd))"; kill "$spid"
  fi
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; sleep 2
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$sp$"; then echo "smoke server still listening on $sp"; return 1; fi
  rm -f "$EV/smoke-body.html"
  strip < "$EV/boot.log" | grep -i -E 'error|ready|serving' | head -10
  [ "$fails" = 0 ]
}
p9_final() {
  echo "--- DEV services AFTER (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  IR stop || true
  sleep 2
  if ss -ltn | awk '{print $4}' | grep -E ":$PORT$"; then echo "port still listening"; return 1; fi
  pgrep -f "$AFLDB_V2_PG_ROOT/data" >/dev/null && { echo "postmaster still running for $AFLDB_V2_PG_ROOT"; return 1; }
  echo "cluster stopped; no listener on $PORT"; (cd "$CAND" && echo "candidate dirty=$(git status --porcelain | wc -l) HEAD=$(git rev-parse HEAD)")
  du -sh "$W" | tail -1
}
ALL="p0_resources p1_verify_inputs p2_deps p3_typecheck p4_cluster p5_template mkdbs p6_unit p6b_delta_unit p7_integration p8_build p8b_boot_smoke p9_final"
PH="${*:-$ALL}"
stop_now=0
for ph in $PH; do
  if [ $stop_now = 1 ] && [ "$ph" != p9_final ]; then continue; fi
  phase "$ph" "$ph" || { case "$ph" in p0_resources|p1_verify_inputs|p2_deps|p4_cluster|p5_template|mkdbs) say "prerequisite $ph failed: skipping to p9_final"; stop_now=1;; esac; }
done
say "DONE"; cat "$SUM"
