#!/usr/bin/env bash
# AFLDB-ISSUE-334/335 Linux qualification on streamanator (procedure of docs/v2/master-execution-sequence-2026-11-01.md 8.2).
# Everything lives under $W on /mnt/ssd. Touches no DEV service, no existing directory, no retained material;
# only READS the verified production dump. No sudo. Own loopback cluster on $PORT, databases afldb_v2_*_test only.
# Usage: W=/mnt/ssd/afldb-i335-qual-... R=<40-hex> BASE=<40-hex> CAND_SHA=<sha256> bash qual-host.sh [phase ...]
set -u -o pipefail
: "${W:?}" "${R:?}" "${BASE:?}" "${CAND_SHA:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
DUMP=/home/arm/afldb-v2-prodexec-20261030T210000Z/archive/afldb_prod-20261031-084435.dump
DUMP_SHA=3f5b5339cee312950c308b494ca98ff29a2f1620d9f60a4d062fbaf37b624730
LOCK_SHA=984b44221f8f7256
PORT=55497
EV="$W/evidence"; mkdir -p "$EV"
SUM="$EV/SUMMARY.txt"
CAND="$W/cand"
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

p0_resources() {
  df -h /mnt/ssd /; free -g | sed -n 2p; uptime; nproc
  avail_kb=$(df --output=avail -k /mnt/ssd | tail -1); [ "$avail_kb" -gt $((30*1024*1024)) ] || { echo "less than 30 GB free"; return 1; }
  mem_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo); [ "$mem_kb" -gt $((8*1024*1024)) ] || { echo "less than 8 GB MemAvailable"; return 1; }
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { echo "port $PORT in use"; return 1; }
  echo "--- DEV services BEFORE (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  echo "--- dump present"; ls -l "$DUMP"
}
p1_verify_inputs() {
  [ "$(sha256sum "$W/in/cand.tar.gz" | cut -d' ' -f1)" = "$CAND_SHA" ] || { echo "cand.tar.gz sha256 mismatch"; return 1; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "production dump sha256 mismatch"; return 1; }
  echo "tar and dump hashes verified"
  cd "$W" && rm -rf cand && tar xzf in/cand.tar.gz || return 1
  cd "$CAND"
  [ "$(git rev-parse HEAD)" = "$R" ] || { echo "HEAD is not $R"; return 1; }
  git cat-file -e "$BASE^{commit}" || { echo "base $BASE absent"; return 1; }
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "candidate tree is dirty"; git status --porcelain | head; return 1; }
  echo "HEAD=$(git rev-parse HEAD) base=$BASE tracked=$(git ls-files | wc -l) dirty=0"
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] || { echo "package-lock.json differs"; return 1; }
  echo "--- files R changes against base"; git diff --stat "$BASE" "$R" | tail -12
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
  IR init && IR start > "$EV/pg-start.out" 2>&1 < /dev/null &
  wait
  sleep 3
  IR roles && IR status || return 1
  pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); echo "postmaster pid $pmpid"
  ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EV/listener.txt"
  grep -q "127.0.0.1:$PORT" "$EV/listener.txt" || { echo "not listening on 127.0.0.1:$PORT"; return 1; }
  grep -q "pid=$pmpid," "$EV/listener.txt" || { echo "listener is not our postmaster"; return 1; }
  [ "$(grep -c . "$EV/listener.txt")" = 1 ] || { echo "more than one listener row"; return 1; }
}
p5_template() {
  IR create-db afldb_v2_i335tmpl_test || return 1
  RUNDB afldb_v2_i335tmpl_test node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || return 1
  RUNDB afldb_v2_i335tmpl_test node --import tsx tools/db/migrate.ts --target test 2>&1 | tail -6
  cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
  RUNDB afldb_v2_i335tmpl_test node .probe-dbs.mjs afldb_v2_i335tmpl_test | tee "$EV/tmpl-probe.txt"
  rm -f "$CAND/.probe-dbs.mjs"
  grep -q '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/tmpl-probe.txt"
}
mkdbs() { for d in afldb_v2_i335red_test afldb_v2_i335_test afldb_v2_i335draft_test; do IR create-db "$d" --template afldb_v2_i335tmpl_test || return 1; done; }
p6_unit() {
  cd "$CAND" && VT tests/admin-upload-route.test.ts tests/auth.test.ts tests/admin-coach-actions.test.ts tests/issue333-coach-row-selector.test.ts 2>&1 | tail -15
  return ${PIPESTATUS[0]}
}
# RED: the new tests against the BASE source of the three fixed files (tests at R). Expected: both runs FAIL,
# on exactly the refusal cases. The tree is restored and proven clean afterwards.
p7_red() {
  cd "$CAND" || return 1
  for f in src/app/admin/content/media/route.ts src/db/queries/admin-coaches.ts src/db/queries/match-admin.ts; do git show "$BASE:$f" > "$f"; done
  echo "--- base source in place:"; git status --porcelain
  echo "=== RED unit (ISSUE-334)"; VT tests/admin-upload-route.test.ts -t "AFLDB-ISSUE-334" --reporter=verbose > "$EV/red-unit.log" 2>&1
  local u=$?
  sed 's/\x1b\[[0-9;]*m//g' "$EV/red-unit.log" | grep -E "^ +(✓|×)|Tests |→ expected" | head -40
  echo "=== RED database (ISSUE-335)"; RUNDB afldb_v2_i335red_test node node_modules/vitest/vitest.mjs run tests/integration/data-editor.test.ts -t "AFLDB-ISSUE-335" --reporter=verbose > "$EV/red-db.log" 2>&1
  local d=$?
  sed 's/\x1b\[[0-9;]*m//g' "$EV/red-db.log" | grep -E "^ +(✓|×)|Tests |→ expected" | grep -v -i 'postgres://' | head -40
  git checkout -- src; [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "tree not restored"; return 1; }
  echo "unit rc=$u database rc=$d; tree restored and clean"
  # Exactly the expected red: 8 refusal cases fail and 4 controls pass; the blocked case alone fails, because the deletion succeeded.
  sed 's/\x1b\[[0-9;]*m//g' "$EV/red-unit.log" | grep -qE "Tests +8 failed \| 4 passed" || { echo "unit red is not 8 failed | 4 passed"; return 1; }
  sed 's/\x1b\[[0-9;]*m//g' "$EV/red-db.log" | grep -qE "Tests +1 failed \| 3 passed" || { echo "database red is not 1 failed | 3 passed"; return 1; }
  sed 's/\x1b\[[0-9;]*m//g' "$EV/red-db.log" | grep -E "^ +×" | grep -q "real coach mutation blocks deletion" || { echo "the failing database case is not the blocked case"; return 1; }
  sed 's/\x1b\[[0-9;]*m//g' "$EV/red-db.log" | grep -q "expected true to be false" || { echo "the blocked case did not fail on a successful deletion"; return 1; }
  [ "$u" -ne 0 ] && [ "$d" -ne 0 ]
}
# The release delta from the serving revision also carries the GAP-029 admin-draft refactor (never Linux-qualified).
p8b_release_delta() {
  cd "$CAND" || return 1
  VT tests/admin-draft-actions.test.ts tests/v2-season-seal.test.ts 2>&1 | tail -6; local u=${PIPESTATUS[0]}
  RUNDB afldb_v2_i335draft_test node node_modules/vitest/vitest.mjs run tests/integration/admin-draft.test.ts tests/integration/sealed-editor-guard.test.ts > "$EV/release-delta-integration.log" 2>&1; local d=$?
  sed 's/\x1b\[[0-9;]*m//g' "$EV/release-delta-integration.log" | grep -E "^ +×|SKIPPED|Tests |Test Files" | grep -v -i 'postgres://' | tail -12
  echo "unit rc=$u integration rc=$d"
  [ "$u" -eq 0 ] && [ "$d" -eq 0 ]
}
p8_green() {
  cd "$CAND" || return 1
  RUNDB afldb_v2_i335_test node node_modules/vitest/vitest.mjs run tests/integration/data-editor.test.ts tests/integration/match-admin-delete.test.ts tests/integration/admin-coaches.test.ts --reporter=verbose > "$EV/green-verbose.log" 2>&1
  local rc=$?
  sed 's/\x1b\[[0-9;]*m//g' "$EV/green-verbose.log" | grep -E "ISSUE-335" | grep -E "✓|×" | head -10
  sed 's/\x1b\[[0-9;]*m//g' "$EV/green-verbose.log" | grep -E "^ +×" | head -20
  sed 's/\x1b\[[0-9;]*m//g' "$EV/green-verbose.log" | grep -E "SKIPPED|Tests |Test Files" | tail -8
  return $rc
}
p9_final() {
  echo "--- DEV services AFTER (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  IR stop || true
  sleep 2; ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && { echo "port still listening"; return 1; }
  echo "no listener on $PORT"; (cd "$CAND" && echo "candidate dirty=$(git status --porcelain | wc -l) HEAD=$(git rev-parse HEAD)")
  du -sh "$W" | tail -1
}

ALL="p0_resources p1_verify_inputs p2_deps p3_typecheck p4_cluster p5_template mkdbs p6_unit p7_red p8_green p8b_release_delta p9_final"
PH="${*:-$ALL}"
for ph in $PH; do
  phase "$ph" "$ph" || { case "$ph" in p0_resources|p1_verify_inputs|p2_deps|p4_cluster|p5_template|mkdbs) say "prerequisite $ph failed: stopping"; break;; esac; }
done
say "DONE"; cat "$SUM"
