#!/usr/bin/env bash
# ISSUE-316 C4b gate fix: reduced Linux qualification of the fix revision F on streamanator (the DEV host; arm, no sudo).
# Derived from the corrected 8.2 qualification (docs/v2/master-execution-sequence-2026-11-01.md section 8.2), cut to what the
# fix can affect: typecheck, the three focused suites, and the C4b end-to-end on a fresh guarded cluster. No application
# build and no boot are repeated: the fix changes no application source (see static-delta-check.sh).
# It touches no DEV service and no existing directory. Everything lives under $W on /mnt/ssd.
# Usage: W=/mnt/ssd/afldb-c4b-fix-qual-<stamp> R=<40-hex F> CAND_SHA=<sha256 of in/cand.tar.gz> bash qual-host.sh [phase ...]
set -u -o pipefail
: "${W:?}" "${R:?}" "${CAND_SHA:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
LOCK_SHA=984b44221f8f7256
PORT=55494
EV="$W/evidence"; mkdir -p "$EV"
SUM="$EV/SUMMARY.txt"
CAND="$W/cand"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
phase() { # name, command...
  local name="$1"; shift
  say "PHASE $name: start"
  "$@" > "$EV/$name.log" 2>&1; local rc=$?
  if [ $rc -eq 0 ]; then say "PHASE $name: PASS"; echo "PASS $name" >> "$SUM"; else say "PHASE $name: FAIL rc=$rc (see $EV/$name.log)"; echo "FAIL $name rc=$rc" >> "$SUM"; fi
  return $rc
}
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }

p0_resources() {
  df -h /mnt/ssd /; free -g | sed -n 2p; uptime; nproc; node -v
  [ "$(node -v)" = v22.23.2 ] || { echo "node is not the production-compatible v22.23.2"; return 1; }
  avail_kb=$(df --output=avail -k /mnt/ssd | tail -1); [ "$avail_kb" -gt $((20*1024*1024)) ] || { echo "less than 20 GB free on /mnt/ssd"; return 1; }
  mem_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo); [ "$mem_kb" -gt $((6*1024*1024)) ] || { echo "less than 6 GB MemAvailable"; return 1; }
  echo "--- listeners for $PORT (must be empty)"; ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && return 1
  echo "--- DEV services BEFORE (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  echo "--- existing sibling dirs left alone"; ls -d /mnt/ssd/afldb-* 2>/dev/null
  return 0
}
p1_verify_inputs() {
  cd "$W/in" || return 1
  [ "$(sha256sum cand.tar.gz | cut -d' ' -f1)" = "$CAND_SHA" ] || { echo "cand.tar.gz sha256 mismatch"; return 1; }
  echo "tar hash verified"
  cd "$W" && rm -rf cand && tar xzf in/cand.tar.gz || return 1
  cd "$CAND"
  [ "$(git rev-parse HEAD)" = "$R" ] || { echo "HEAD is not $R"; return 1; }
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "candidate tree is dirty"; return 1; }
  echo "HEAD=$(git rev-parse HEAD) tracked files=$(git ls-files | wc -l) dirty=0"
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] || { echo "package-lock.json differs from the verified lock"; return 1; }
  echo "package-lock.json prefix $LOCK_SHA verified"
}
p2_deps() {
  cd "$CAND" && node -v && npm -v && npm ci --no-audit --no-fund 2>&1 | tail -15 || return 1
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] || { echo "npm ci changed package-lock.json"; return 1; }
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "npm ci dirtied tracked files"; git status --porcelain | head; return 1; }
}
p3_typecheck() { cd "$CAND" && node node_modules/typescript/bin/tsc --noEmit -p . ; }
p4_cluster() {
  IR init && IR start > "$EV/pg-start.out" 2>&1 < /dev/null &
  wait
  sleep 3
  IR roles && IR status || return 1
  echo "--- listener ownership"
  pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); echo "postmaster pid $pmpid"
  ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EV/listener.txt"
  grep -q "127.0.0.1:$PORT" "$EV/listener.txt" || { echo "not listening on 127.0.0.1:$PORT"; return 1; }
  grep -q "pid=$pmpid," "$EV/listener.txt" || { echo "listener is not the postmaster we started"; return 1; }
  [ "$(grep -c . "$EV/listener.txt")" = 1 ] || { echo "more than one listener row for the port"; return 1; }
  echo "owner of postmaster: $(ps -o user= -p "$pmpid") ; cmd: $(ps -o args= -p "$pmpid" | cut -c1-120)"
  echo "--- DEV postgres untouched (5432 still its own pid)"; ss -ltnp 2>/dev/null | grep ":5432 " | head -2
}
# A fresh disposable database, migrated from scratch to the repository's own ledger (no production dump is read).
p5_db() {
  IR create-db afldb_v2_c4b_r2_test || return 1
  RUNDB afldb_v2_c4b_r2_test node --import tsx tools/db/migrate.ts --target test 2>&1 | tail -8 || return 1
  RUNDB afldb_v2_c4b_r2_test node --input-type=module -e "
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1 });
const r = await sql\`SELECT count(*)::int AS n, max(name) AS last FROM afldb_meta.schema_migrations\`;
console.log('ledger', JSON.stringify(r[0]));
await sql.end();" | tee "$EV/db-probe.txt"
  grep -q '"n":118' "$EV/db-probe.txt" && grep -q '118_fixtures_unconfirmed_participants.sql' "$EV/db-probe.txt"
}
p6_unit() { # no database environment: the same shape as the Windows run, plus the POSIX-only cases that Windows skips
  cd "$CAND" && node node_modules/vitest/vitest.mjs run tests/afl-api-cutover.test.ts tests/afl-api-settle-cli-gate.test.ts tests/afl-api-ingestion-safety.test.ts
}
p7_c4b() { RUNDB afldb_v2_c4b_r2_test node --import tsx tools/v2/c4b-isolated-e2e.mts "$EV/c4b-e2e" 2>&1 | tail -90; return ${PIPESTATUS[0]}; }
p13_final() {
  echo "--- DEV services AFTER (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  IR stop || true
  sleep 2; echo "--- listeners for $PORT after stop (expect none)"; ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && return 1
  echo "--- leftover processes from this workspace (expect none)"; pgrep -af "$W" | grep -v pgrep | head
  du -sh "$W" | tail -1; df -h /mnt/ssd | tail -1
  return 0
}

ALL="p0_resources p1_verify_inputs p2_deps p3_typecheck p4_cluster p5_db p6_unit p7_c4b p13_final"
PH="${*:-$ALL}"
for ph in $PH; do
  phase "$ph" "$ph" || { case "$ph" in p0_resources|p1_verify_inputs|p2_deps|p4_cluster|p5_db) say "prerequisite $ph failed: stopping (cluster stop is left to p13_final)"; break;; esac; }
done
say "DONE"; cat "$SUM"
