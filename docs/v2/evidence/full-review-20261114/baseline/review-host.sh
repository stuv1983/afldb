#!/usr/bin/env bash
# AFLDB full review 2026-11-14: baseline automated evidence at the reviewed revision on streamanator.
# Pattern: docs/v2/evidence/issue336-337-340-345-release-20261109/host-scripts/qual336-host.sh.
# Everything under $W on /mnt/ssd. No sudo. Touches no DEV service. Only READS the approved, restore-verified
# production snapshot (ISSUE-333 O2 capture, ledger 118). Own loopback cluster on $PORT, databases afldb_v2_rv*_test only.
# The cluster is left RUNNING after the run phases (for review reproductions); phase p9_stop stops it.
# Usage: W=/mnt/ssd/afldb-review-<ts> REV=<40-hex> bash review-host.sh [phase ...]
set -u -o pipefail
: "${W:?}" "${REV:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
DUMP_BYTES=30141895
PORT=55520
EV="$W/evidence"; mkdir -p "$EV"
SUM="$EV/SUMMARY.txt"
CAND="$W/cand"
TMPL=afldb_v2_rvtmpl_test
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
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -v -i 'postgres://'; }
listener_is_ours() {
  local pmpid; pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
  ss -ltnp 2>/dev/null | grep ":$PORT " > "$EV/listener.txt"
  cat "$EV/listener.txt"; echo "postmaster pid $pmpid"
  [ "$(grep -c "127.0.0.1:$PORT " "$EV/listener.txt")" = 1 ] || { echo "not exactly one listener on 127.0.0.1:$PORT"; return 1; }
  [ "$(grep -c "pid=$pmpid," "$EV/listener.txt")" = 1 ] || { echo "listener is not our postmaster"; return 1; }
}
p0_resources() {
  df -h /mnt/ssd /; free -g | sed -n 2p; uptime; nproc
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port $PORT in use"; return 1; fi
  echo "--- DEV services BEFORE (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  ls -l "$DUMP"
}
p1_clone() {
  [ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { echo "snapshot size mismatch"; return 1; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "snapshot sha256 mismatch"; return 1; }
  echo "snapshot verified $DUMP_SHA"
  cd "$W" && git -c advice.detachedHead=false clone -q https://github.com/stuv1983/afldb.git cand || return 1
  cd "$CAND" && git checkout -q --detach "$REV" || return 1
  [ "$(git rev-parse HEAD)" = "$REV" ] || { echo "HEAD is not $REV"; return 1; }
  echo "origin/main=$(git rev-parse origin/main) HEAD=$(git rev-parse HEAD) tracked=$(git ls-files | wc -l) dirty=$(git status --porcelain | wc -l)"
  sha256sum package-lock.json
  ls src/db/migrations | grep -c '\.sql$'; ls src/db/migrations | tail -1
}
p2_deps() {
  cd "$CAND" && node -v && npm -v && npm ci --no-audit --no-fund 2>&1 | tail -8 || return 1
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "npm ci dirtied tracked files"; git status --porcelain | head; return 1; }
}
p3_typecheck() {
  cd "$CAND" && node node_modules/next/dist/bin/next typegen && node node_modules/typescript/bin/tsc --noEmit -p . || return 1
  echo "tsc exit 0"; git status --porcelain | head
}
p3b_lint() { cd "$CAND" && node node_modules/eslint/bin/eslint.js . 2>&1 | tail -40; }
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
  grep -q '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/tmpl-probe.txt" || { echo "template ledger is not 118"; return 1; }
}
mkdbs() { for d in afldb_v2_rvint_test afldb_v2_rvbuild_test; do IR create-db "$d" --template "$TMPL" || return 1; done; }
# Every Vitest suite outside tests/integration, with no database variable (the unit gate).
p6_unit() {
  cd "$CAND" || return 1
  env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run --exclude 'tests/integration/**' \
    --reporter=default --reporter=json --outputFile.json="$EV/unit.json" > "$EV/unit-verbose.log" 2>&1; local rc=$?
  strip < "$EV/unit-verbose.log" | grep -E "^ +(×|FAIL)|Tests |Test Files|Duration" | tail -60
  return $rc
}
# Every integration suite, serially (vitest fileParallelism false), on one fresh copy of the production-derived template.
p7_integration() {
  cd "$CAND" || return 1
  RUNDB afldb_v2_rvint_test node node_modules/vitest/vitest.mjs run tests/integration \
    --reporter=default --reporter=json --outputFile.json="$EV/integration.json" > "$EV/integration-verbose.log" 2>&1; local rc=$?
  strip < "$EV/integration-verbose.log" | grep -E "^ +(×|FAIL)|Tests |Test Files|Duration" | tail -80
  return $rc
}
p7b_shell() {
  cd "$CAND" || return 1
  local rc=0
  bash tests/restore-test.test.sh > "$EV/restore-test-sh.log" 2>&1 || rc=$?; echo "restore-test.test.sh rc=$rc"; tail -5 "$EV/restore-test-sh.log" | strip
  local rc2=0
  bash tests/sync-dev-remote.test.sh > "$EV/sync-dev-remote-sh.log" 2>&1 || rc2=$?; echo "sync-dev-remote.test.sh rc=$rc2"; tail -5 "$EV/sync-dev-remote-sh.log" | strip
  [ $rc -eq 0 ] && [ $rc2 -eq 0 ]
}
p8_build() {
  cd "$CAND" || return 1
  RUNDB afldb_v2_rvbuild_test env NODE_ENV=production node node_modules/next/dist/bin/next build --webpack > "$EV/build-next.log" 2>&1; local b=$?
  strip < "$EV/build-next.log" | grep -v -E '^\s*$' | tail -25
  [ "$b" -eq 0 ] || { echo "next build rc=$b"; return 1; }
  RUNDB afldb_v2_rvbuild_test node tools/build/prepare-standalone.mjs > "$EV/build-standalone.log" 2>&1 || { echo "prepare-standalone failed"; tail -20 "$EV/build-standalone.log"; return 1; }
  echo "BUILD_ID=$(cat .next/BUILD_ID)"; [ -f .next/standalone/server.js ] || { echo "no standalone server"; return 1; }
  git status --porcelain | head
}
p9_stop() {
  echo "--- DEV services AFTER (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  IR stop || true
  sleep 2
  if ss -ltn | awk '{print $4}' | grep -E ":$PORT$"; then echo "port still listening"; return 1; fi
  echo "cluster stopped; no listener on $PORT"; du -sh "$W" | tail -1
}
ALL="p0_resources p1_clone p2_deps p3_typecheck p3b_lint p4_cluster p5_template mkdbs p6_unit p7_integration p7b_shell p8_build"
PH="${*:-$ALL}"
stop_now=0
for ph in $PH; do
  if [ $stop_now = 1 ]; then continue; fi
  phase "$ph" "$ph" || { case "$ph" in p0_resources|p1_clone|p2_deps|p4_cluster|p5_template|mkdbs) say "prerequisite $ph failed: stopping"; stop_now=1;; esac; }
done
say "DONE"; cat "$SUM"
