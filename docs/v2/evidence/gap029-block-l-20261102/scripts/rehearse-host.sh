#!/usr/bin/env bash
# Block L label-runner rehearsal on an authorised isolated Linux target (streamanator, new workspace under /mnt/ssd).
# Phases only what the label-runner correction touches; C4b, Brownlow, fixture-window and build qualification are reused.
# Touches no DEV service and nothing outside $W; reads the verified production dump (ledger 117).
# Usage: W=/mnt/ssd/afldb-v2-gap029l-... R=<40-hex> CAND_SHA=<sha256> bash rehearse-host.sh [phase ...]
set -u -o pipefail
: "${W:?}" "${R:?}" "${CAND_SHA:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
DUMP=/home/arm/afldb-v2-prodexec-20261030T210000Z/archive/afldb_prod-20261031-084435.dump
DUMP_SHA=3f5b5339cee312950c308b494ca98ff29a2f1620d9f60a4d062fbaf37b624730
LOCK_SHA=984b44221f8f7256
PORT=55493
EV="$W/evidence"; mkdir -p "$EV"
SUM="$EV/SUMMARY.txt"
CAND="$W/cand"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
phase() { local name="$1"; shift; say "PHASE $name: start"; "$@" > "$EV/$name.log" 2>&1; local rc=$?
  if [ $rc -eq 0 ]; then say "PHASE $name: PASS"; echo "PASS $name" >> "$SUM"; else say "PHASE $name: FAIL rc=$rc (see $EV/$name.log)"; echo "FAIL $name rc=$rc" >> "$SUM"; fi; return $rc; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }

p0_resources() {
  df -h /mnt/ssd /; free -g | sed -n 2p; uptime; nproc
  [ "$(df --output=avail -k /mnt/ssd | tail -1)" -gt $((30*1024*1024)) ] || { echo "less than 30 GB free"; return 1; }
  [ "$(awk '/MemAvailable/ {print $2}' /proc/meminfo)" -gt $((8*1024*1024)) ] || { echo "less than 8 GB MemAvailable"; return 1; }
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":($PORT)$" && return 1
  echo "--- DEV services BEFORE (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  ls -l "$DUMP"
}
p1_verify_inputs() {
  cd "$W/in" || return 1
  [ "$(sha256sum cand.tar.gz | cut -d' ' -f1)" = "$CAND_SHA" ] || { echo "cand.tar.gz sha256 mismatch"; return 1; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "production dump sha256 mismatch"; return 1; }
  echo "tar and dump hashes verified"
  cd "$W" && rm -rf cand && tar xzf in/cand.tar.gz || return 1
  cd "$CAND"
  [ "$(git rev-parse HEAD)" = "$R" ] || { echo "HEAD is not $R"; return 1; }
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "candidate tree is dirty"; return 1; }
  echo "HEAD=$(git rev-parse HEAD) tracked files=$(git ls-files | wc -l) dirty=0"
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] || { echo "package-lock.json differs"; return 1; }
  echo "package-lock.json prefix $LOCK_SHA verified"
}
p2_deps() {
  cd "$CAND" && node -v && npm -v && npm ci --no-audit --no-fund 2>&1 | tail -8
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] || { echo "npm ci changed package-lock.json"; return 1; }
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "npm ci dirtied tracked files"; return 1; }
}
p3_typecheck() { cd "$CAND" && node node_modules/typescript/bin/tsc --noEmit -p .; }
p4_cluster() {
  IR init && IR start > "$EV/pg-start.out" 2>&1 < /dev/null &
  wait; sleep 3
  IR roles && IR status || return 1
  pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EV/listener.txt"
  grep -q "127.0.0.1:$PORT" "$EV/listener.txt" && grep -q "pid=$pmpid," "$EV/listener.txt" && [ "$(grep -c . "$EV/listener.txt")" = 1 ] || { echo "listener not exclusively our postmaster"; return 1; }
  echo "DEV postgres untouched:"; ss -ltnp 2>/dev/null | grep ":5432 " | head -2
}
p5_template() {
  IR create-db afldb_v2_qtmpl_test || return 1
  RUNDB afldb_v2_qtmpl_test node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || return 1
  cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
  RUNDB afldb_v2_qtmpl_test node .probe-dbs.mjs afldb_v2_qtmpl_test | tee "$EV/qtmpl-probe.txt"; rm -f "$CAND/.probe-dbs.mjs"
  grep -q '"ledger":"117_brownlow_provider_eligibility_unknown.sql"' "$EV/qtmpl-probe.txt" && grep -q '"matches":17056' "$EV/qtmpl-probe.txt"
}
mkdbs() { for d in afldb_v2_gap029_prod_test afldb_v2_gap029lab_q_test; do IR create-db "$d" --template afldb_v2_qtmpl_test || return 1; done; }
p6_unit() { cd "$CAND" && node node_modules/vitest/vitest.mjs run tests/v2-gap029-label-checks.test.ts tests/v2-season-seal.test.ts tests/v2-module-boundaries.test.ts tests/v2-isolated-test-target.test.ts 2>&1 | tail -25; return ${PIPESTATUS[0]}; }
p8_labels() { RUNDB afldb_v2_gap029lab_q_test node --import tsx --conditions=react-server tools/v2/gap029-labels-isolated-e2e.mts "$EV/labels-e2e" 2>&1 | tail -90; return ${PIPESTATUS[0]}; }
p13_final() {
  echo "--- DEV services AFTER (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  IR stop || true; sleep 2
  ss -ltn | awk '{print $4}' | grep -E ":($PORT)$" && return 1
  pgrep -af "$W" | grep -v pgrep | head; du -sh "$W" | tail -1
}
ALL="p0_resources p1_verify_inputs p2_deps p3_typecheck p4_cluster p5_template mkdbs p6_unit p8_labels p13_final"
PH="${*:-$ALL}"
for ph in $PH; do phase "$ph" "$ph" || { case "$ph" in p0_resources|p1_verify_inputs|p2_deps|p4_cluster|p5_template|mkdbs) say "prerequisite $ph failed: stopping"; break;; esac; }; done
say "DONE"; cat "$SUM"
