#!/bin/bash
# D-316-12 UI release candidate: bounded Linux qualification on streamanator (disposable workspace on tmpfs, guarded isolated cluster).
# usage: run-qual.sh <phase>   phases: identity | stage | cluster | schema | focused | integration | release | typecheck | build | smoke | guard | stop
# Nothing here touches DEV services/databases (5432, 3000, 3100, 8090), the host's own checkout, retained baselines or production.
# The workspace lives under /dev/shm (RAM-backed) because / is 98% full; nothing outside $W is created or deleted.
set -uo pipefail
export LC_ALL=C
umask 077
W=/dev/shm/afldb-c316-ui-qual
SRC=$W/src
E=$W/evidence
HOSTMODULES=/home/arm/projects/afldb/node_modules
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
PGBIN=/usr/lib/postgresql/16/bin
PORT=55482
SMOKEPORT=3198
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
step() { echo "== $* $(date -u +%FT%TZ)"; }
die() { echo "STOP: $*"; exit "${2:-1}"; }
mkdir -p -m 700 "$W" "$E"
cd "$W" || die "no workspace"
# only the launcher settings survive; every PG*/DSN/AFLDB_ variable of the login shell is dropped
for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*|AFLDB_[A-Z_]*)=' | tr -d =); do unset "$k"; done
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_BIN=$PGBIN AFLDB_V2_PG_PORT=$PORT
ISO=("$NODE" node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts)
free_gb() { df -BG --output=avail /dev/shm | tail -1 | tr -dc 0-9; }
need_shm() { [ "$(free_gb)" -ge "${1:-2}" ] || die "free /dev/shm $(free_gb) GB < ${1:-2} GB" 7; }
listener_proof() {
  local P; P=$(ss -H -ltnp "sport = :$PORT" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  [ -n "$P" ] || die "nothing listening on $PORT" 4
  echo "listener 127.0.0.1:$PORT pid $P exe $(readlink /proc/$P/exe)"
  tr '\0' ' ' < /proc/$P/cmdline | grep -q -- "$W/pg/data" || die "listener is not this cluster" 4
  ss -H -ltn "sport = :$PORT" | grep -q "127.0.0.1:$PORT" || die "not bound to loopback" 4
  ss -H -ltn "sport = :$PORT" | grep -vq "127.0.0.1:$PORT" && die "also bound elsewhere" 4
  return 0
}
summ() { "$NODE" -e 'const j=require(process.argv[1]);console.log(`${process.argv[2]}: files ${j.testResults.length} total ${j.numTotalTests} passed ${j.numPassedTests} failed ${j.numFailedTests} skipped ${j.numPendingTests}`)' "$1" "$2"; }
vt() { # <db> <report-name> <vitest args...>
  local db=$1 name=$2; shift 2
  "${ISO[@]}" run "$db" -- "$NODE" node_modules/vitest/vitest.mjs run --no-cache "$@" --reporter=json --outputFile="$E/$name.json" > "$E/$name.stdout.log" 2> "$E/$name.stderr.log"
  local rc=$?; echo "vitest exit $rc"; summ "$E/$name.json" "$name"; return 0
}
DBS=afldb_v2_c316ui_schema_test

phase=${1:-}
case "$phase" in
identity)
  step "identity"
  echo "host $(hostname) kernel $(uname -r) cores $(nproc) node $($NODE -v) $($PGBIN/postgres --version)"
  free -m | sed -n 1,2p; df -h / /dev/shm | cat; echo "load $(cat /proc/loadavg)"
  ss -H -ltn "sport = :$PORT" | grep -q . && die "port $PORT in use" 4 || echo "port $PORT free"
  ss -H -ltn "sport = :$SMOKEPORT" | grep -q . && die "port $SMOKEPORT in use" 4 || echo "port $SMOKEPORT free"
  ;;
stage)
  step "stage: verify the streamed git archive, copy the host's node_modules privately, check the lock"
  [ -f "$W/xfer/src.tar" ] && [ -f "$W/xfer/ls-tree.txt" ] || die "xfer/src.tar or xfer/ls-tree.txt missing"
  need_shm 4
  rm -rf "$SRC"; mkdir -p -m 700 "$SRC"; tar -xf "$W/xfer/src.tar" -C "$SRC" || die "extract"
  "$NODE" "$W/xfer/verify-tree.mjs" "$SRC" "$W/xfer/ls-tree.txt" || die "tree verification" 3
  [ -d "$HOSTMODULES" ] || die "no host node_modules"
  cp -a "$HOSTMODULES" "$SRC/node_modules" || die "copy node_modules"
  "$NODE" "$W/xfer/lock-check.mjs" "$SRC" > "$E/lock-check.txt" 2>&1; cat "$E/lock-check.txt"
  # DISCLOSED deviation: the host checkout's node_modules predates the devDependency @electric-sql/pglite, which only
  # unrelated test suites import (never the app, the build, a changed file or any suite this script runs). Any OTHER
  # mismatch still stops the run; nothing is installed.
  BAD=$(grep -E '^(ABSENT|VERSION)' "$E/lock-check.txt" | grep -vc '^ABSENT node_modules/@electric-sql/pglite@0.2.17$')
  [ "$BAD" = 0 ] || die "lock check: mismatches beyond the disclosed pglite devDependency" 3
  echo "lock check: only the disclosed pglite devDependency is absent"
  echo "lock sha $(sha256sum "$SRC/package-lock.json" | cut -c1-16); src $(du -sh "$SRC" | cut -f1)"; df -h /dev/shm | tail -1
  ;;
pglite)
  step "add the missing devDependency from the workstation's lock-installed copy (private workspace only), recheck the lock"
  [ -f "$W/xfer/pglite.tar" ] || die "xfer/pglite.tar missing"
  mkdir -p "$SRC/node_modules/@electric-sql" && rm -rf "$SRC/node_modules/@electric-sql/pglite"
  tar -xf "$W/xfer/pglite.tar" -C "$SRC/node_modules/@electric-sql" || die "extract pglite"
  "$NODE" "$W/xfer/lock-check.mjs" "$SRC" > "$E/lock-check-after-pglite.txt" 2>&1; cat "$E/lock-check-after-pglite.txt"
  grep -q 'bad 0$' "$E/lock-check-after-pglite.txt" || die "lock check still not clean" 3
  ;;
cluster)
  step "init/start cluster 127.0.0.1:$PORT"
  cd "$SRC" || die "no src"
  ss -H -ltn "sport = :$PORT" | grep -q . && die "port $PORT in use" 4
  mkdir -p -m 700 "$W/pg"
  "${ISO[@]}" init || die init 4
  "${ISO[@]}" start || die start 4
  "${ISO[@]}" roles || die roles 4
  listener_proof
  ;;
schema)
  step "schema-only target: create, migrate, privileges"
  cd "$SRC" || die "no src"; listener_proof; need_shm 2
  "${ISO[@]}" drop-db $DBS --acknowledge-destroy $DBS >/dev/null 2>&1
  "${ISO[@]}" create-db $DBS || die create 5
  "${ISO[@]}" run $DBS -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/migrate.ts --target test > "$E/schema-migrate.log" 2>&1 || { tail -20 "$E/schema-migrate.log"; die migrate 6; }
  grep -E 'appl|Nothing' "$E/schema-migrate.log" | tail -2
  "${ISO[@]}" run $DBS -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/privileges.ts --target test > "$E/schema-privileges.log" 2>&1 || { tail -5 "$E/schema-privileges.log"; die privileges 6; }
  tail -1 "$E/schema-privileges.log"
  "${ISO[@]}" verify $DBS
  ;;
focused)
  step "focused unit suites (changed UI tests, boundaries, safety, C7 classifier)"
  cd "$SRC" || die "no src"; listener_proof
  vt $DBS lx-focused tests/admin-current-season-settle.test.ts tests/v2-admin-operations-ui.test.ts tests/v2-module-boundaries.test.ts tests/afl-api-ingestion-safety.test.ts tests/afl-api-c7-observation.test.ts
  ;;
integration)
  step "C7 observer reader against real PostgreSQL (rolled-back transaction)"
  cd "$SRC" || die "no src"; listener_proof
  vt $DBS lx-integration tests/integration/afl-api-c7-observation.test.ts
  ;;
release)
  step "deploy-release route suite with TMPDIR on tmpfs (admission measures the temp root's filesystem)"
  cd "$SRC" || die "no src"; listener_proof
  T=$W/tmp-release; rm -rf "$T"; mkdir -p -m 700 "$T"
  echo "TMPDIR filesystem: $(df -h "$T" | tail -1)"
  TMPDIR=$T "${ISO[@]}" run $DBS -- "$NODE" node_modules/vitest/vitest.mjs run --no-cache tests/deploy-release.test.ts --reporter=json --outputFile="$E/lx-deploy-release.json" > "$E/lx-deploy-release.stdout.log" 2> "$E/lx-deploy-release.stderr.log"
  echo "vitest exit $?"; summ "$E/lx-deploy-release.json" lx-deploy-release
  rm -rf "$T"
  ;;
typecheck)
  step "typecheck (next typegen then tsc --noEmit)"
  cd "$SRC" || die "no src"
  /usr/bin/time -v -o "$E/typecheck.time" "$NODE" node_modules/next/dist/bin/next typegen > "$E/typecheck.log" 2>&1; echo "typegen exit $?"
  /usr/bin/time -v -a -o "$E/typecheck.time" "$NODE" node_modules/typescript/bin/tsc --noEmit >> "$E/typecheck.log" 2>&1; echo "tsc exit $?"
  grep -E "Maximum resident|Elapsed" "$E/typecheck.time"
  ;;
build)
  step "isolated production-mode build (off-host typecheck switch, 1 worker, 3072 MB heap) with resource sampling"
  cd "$SRC" || die "no src"; listener_proof; need_shm 4
  ( while :; do echo "$(date +%s) $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"; sleep 2; done ) > "$E/build-memavail.txt" & SAMP=$!
  /usr/bin/time -v -o "$E/build.time" "${ISO[@]}" run $DBS -- /usr/bin/env AFLDB_ENV=production AFLDB_BUILD_TYPECHECK=off-host AFLDB_BUILD_WORKERS=1 NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=3072 npm run build > "$E/build.log" 2>&1
  rc=$?; kill $SAMP 2>/dev/null; echo "build exit $rc"; grep -E "Maximum resident|Elapsed" "$E/build.time"
  sort -k2 -n "$E/build-memavail.txt" | head -1 | awk '{print "min MemAvailable during build: "$2" MB"}'
  du -sh .next 2>/dev/null; cat .next/BUILD_ID 2>/dev/null; echo; tail -5 "$E/build.log" | cut -c1-200
  ;;
smoke)
  step "boot smoke of the built bundle on loopback 127.0.0.1:$SMOKEPORT against the disposable schema DB"
  cd "$SRC" || die "no src"; listener_proof; ss -H -ltn "sport = :$SMOKEPORT" | grep -q . && die "$SMOKEPORT in use" 4
  ( "${ISO[@]}" run $DBS -- /usr/bin/env AFLDB_ENV=production AFLDB_WORKERS=1 PORT=$SMOKEPORT HOSTNAME=127.0.0.1 AFLDB_SESSION_SECRET="$(head -c 24 /dev/urandom | base64)" "$NODE" deploy/server-cluster.mjs > "$E/smoke-server.log" 2>&1 & echo $! > "$E/smoke.pid" )
  for i in $(seq 1 60); do curl -s -m 3 -o "$E/smoke-health.json" -w '%{http_code}' http://127.0.0.1:$SMOKEPORT/api/health 2>/dev/null | grep -q 200 && break; sleep 1; done
  echo "health: $(cut -c1-120 "$E/smoke-health.json" 2>/dev/null)"
  B=$(cat .next/BUILD_ID); echo "buildManifest: $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:$SMOKEPORT/_next/static/$B/_buildManifest.js)"
  for p in / /beta /admin/current-season; do echo "$p -> $(curl -s -m 20 -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:$SMOKEPORT$p)"; done
  P=$(ss -H -ltnp "sport = :$SMOKEPORT" | grep -oE "pid=[0-9]+" | head -1 | cut -d= -f2)
  if [ -n "$P" ] && [ "$(readlink /proc/$P/cwd)" = "$SRC" ]; then pkill -TERM -P "$P" 2>/dev/null; kill -TERM "$P" 2>/dev/null; sleep 4; else echo "smoke listener not found or not ours (pid=${P:-none}); nothing killed"; fi
  ss -H -ltn "sport = :$SMOKEPORT" | grep -q . && echo "WARNING $SMOKEPORT still listening" || echo "$SMOKEPORT free"
  grep -c -E "Error:" "$E/smoke-server.log" | sed 's/^/server-log error lines: /'
  ;;
guard)
  step "C5 process guard: table test, then the real-process test (one harmless probe, killed)"
  cd "$SRC/docs/v2/evidence/c5-prep-20261102" || die "no guard scripts"
  [ "$(hostname)" = afldb-prod ] && die "REFUSED: not on production" 3
  bash c5-proc-guard-test.sh 2>&1 | tail -4
  bash c5-proc-guard-live-test.sh 2>&1 | tail -12
  ;;
stop)
  step "stop cluster, final state"
  cd "$SRC" || die "no src"
  "${ISO[@]}" list | awk '{print $1, $2}' | head -20
  "${ISO[@]}" stop; ss -H -ltn "sport = :$PORT" | grep -q . && echo "WARNING $PORT listening" || echo "$PORT free"; df -h /dev/shm | tail -1
  ;;
*) echo "unknown phase"; exit 2 ;;
esac
step "phase $phase done"
