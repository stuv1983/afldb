#!/bin/bash
# GAP-006 editor-protection candidate: bounded Linux qualification on streamanator (disposable workspace, guarded isolated cluster).
# usage: run-linux.sh <phase>   phases: identity | cluster | base | core | coupled | coleman | unit | typecheck | lint | build | stop
# Nothing here touches DEV services/databases (5432, 3000, 3100, 8090), retained baselines or frozen workspaces.
set -uo pipefail
export LC_ALL=C
umask 077
W=/home/arm/afldb-v2-gap006-linux-20261101
SRC=$W/src
E=$W/evidence
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
PGBIN=/usr/lib/postgresql/16/bin
PORT=55481
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
BASE=afldb_v2_rb_gap006lxbase_test
step() { echo "== $* $(date -u +%FT%TZ)"; }
die() { echo "STOP: $*"; exit "${2:-1}"; }
cd "$SRC" || die "no source"
# only the three launcher settings survive; every PG*/DSN/AFLDB_ variable of the login shell is dropped
for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*|AFLDB_[A-Z_]*)=' | tr -d =); do unset "$k"; done
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_BIN=$PGBIN AFLDB_V2_PG_PORT=$PORT
ISO=("$NODE" node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts)
free_gb() { df -BG --output=avail /home/arm | tail -1 | tr -dc 0-9; }
need_disk() { [ "$(free_gb)" -ge "${1:-2}" ] || die "free disk $(free_gb) GB < ${1:-2} GB (no retained evidence is deleted for space)" 7; }
listener_proof() {
  local P; P=$(ss -H -ltnp "sport = :$PORT" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  [ -n "$P" ] || die "nothing listening on $PORT" 4
  echo "listener 127.0.0.1:$PORT pid $P exe $(readlink /proc/$P/exe) data $(tr '\0' ' ' < /proc/$P/cmdline | grep -oE -- '-D [^ ]+')"
  tr '\0' ' ' < /proc/$P/cmdline | grep -q -- "$W/pg/data" || die "listener is not this cluster" 4
  ss -H -ltn "sport = :$PORT" | grep -q "127.0.0.1:$PORT" || die "not bound to loopback" 4
  ss -H -ltn "sport = :$PORT" | grep -vq "127.0.0.1:$PORT" && die "also bound elsewhere" 4
  return 0
}
# summary of a vitest JSON report
summ() { "$NODE" -e 'const j=require(process.argv[1]);console.log(`${process.argv[2]}: files ${j.testResults.length} total ${j.numTotalTests} passed ${j.numPassedTests} failed ${j.numFailedTests} skipped ${j.numPendingTests+(j.numTodoTests||0)} success ${j.success}`);for(const f of j.testResults)for(const a of f.assertionResults)if(a.status==="failed"){console.log("  FAILED: "+f.name.replace(/^.*\/tests\//,"tests/")+" :: "+a.title);console.log("    "+a.failureMessages.join(" | ").split("\n").filter(l=>!/^\s+at /.test(l)).join(" ").slice(0,400))};for(const f of j.testResults)if(f.status==="failed"&&!f.assertionResults.some(a=>a.status==="failed"))console.log("  FILE FAILED: "+f.name+" "+String(f.message).slice(0,300))' "$1" "$2" 2>&1 || echo "$2: no JSON report"; }
clone() { # <name>: fresh clone of the migrated base
  need_disk 2
  "${ISO[@]}" drop-db "$1" --acknowledge-destroy "$1" >/dev/null 2>&1
  "${ISO[@]}" create-db "$1" --template "$BASE" || return 1
  "${ISO[@]}" verify "$1" || return 1
}
vt() { # <db> <report-name> <vitest args...>
  local db=$1 name=$2; shift 2
  "${ISO[@]}" run "$db" -- "$NODE" node_modules/vitest/vitest.mjs run --no-cache "$@" --reporter=json --outputFile="$E/$name.json" > "$E/$name.stdout.log" 2> "$E/$name.stderr.log"
  local rc=$?; echo "vitest exit $rc"; summ "$E/$name.json" "$name"; return 0
}

CORE=(admin-awards admin-brownlow admin-club-leadership admin-coaches admin-draft admin-fixtures admin-season-lists admin-special-records
  data-editor match-admin-create match-admin-delete player-link-concurrency sealed-editor-guard special-records-public-suppression
  v2-brownlow-eligibility v2-curated-awards v2-fixture-writer awards-reload-links first-kick-goal-reload-links brownlow-pending-populated
  brownlow-pending-projection)
COUPLED=(database draftguru-import player-compare player-family-and-coaching match-results-promotion settle-afl-api settle-afl-api-state-b
  settle-afltables v2-afl-api-settle-findings)
files() { local a=("$@") o=(); for n in "${a[@]}"; do o+=("tests/integration/$n.test.ts"); done; printf '%s\n' "${o[@]}"; }

phase=${1:-}
case "$phase" in
identity)
  step "identity"
  echo "host $(hostname) kernel $(uname -r) $(grep PRETTY /etc/os-release | cut -d= -f2) cores $(nproc)"
  echo "node $($NODE -v) sha256 $(sha256sum $NODE | cut -c1-16)…; postgres $($PGBIN/postgres --version); load $(cat /proc/loadavg)"
  free -m | sed -n 1,2p; df -h /home/arm | tail -1
  echo "listeners (host's own, observed only): $(ss -H -ltn | awk '{print $4}' | grep -E '127.0.0.1:(5432|3000|3100)$' | sort -u | tr '\n' ' ')"
  ss -H -ltn "sport = :$PORT" | grep -q . && die "port $PORT in use" 4 || echo "port $PORT free"
  ;;
cluster)
  step "init/start cluster 127.0.0.1:$PORT"
  ss -H -ltn "sport = :$PORT" | grep -q . && die "port $PORT in use" 4
  mkdir -p -m 700 "$W/pg"
  "${ISO[@]}" init || die init 4
  "${ISO[@]}" start || die start 4
  "${ISO[@]}" roles || die roles 4
  listener_proof
  ;;
base)
  step "base: restore the approved baseline dump, migrate 116/117, privileges"
  listener_proof; need_disk 3
  "$NODE" -e '' ; echo "659e471beb990aecfb276c13a010630e02d50184d2b121c0e0ae2497a819345f  $W/xfer/baseline-rb_final.dump" | sha256sum -c - || die "baseline dump hash" 3
  "${ISO[@]}" create-db "$BASE" || die create-db 5
  $PGBIN/pg_restore -l "$W/xfer/baseline-rb_final.dump" > "$E/base.toc"
  grep -vE ' (EXTENSION|COMMENT) - (EXTENSION )?(pg_trgm|unaccent)( |$)' "$E/base.toc" > "$E/base.uselist"
  echo "toc entries $(grep -cv '^;' "$E/base.toc"); excluded $(( $(grep -cv '^;' "$E/base.toc") - $(grep -cv '^;' "$E/base.uselist") ))"
  (
    export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=afldb_v2_super PGDATABASE=$BASE PGCONNECT_TIMEOUT=5
    PGPASSWORD=$(tr -d '\r\n' < "$W/pg/secrets/superuser.pw"); export PGPASSWORD
    $PGBIN/pg_restore --exit-on-error --use-list "$E/base.uselist" -d "$BASE" "$W/xfer/baseline-rb_final.dump"; echo "pg_restore exit $?"
    $PGBIN/vacuumdb --analyze-only --quiet -d "$BASE"; echo "analyze exit $?"
  )
  "${ISO[@]}" run "$BASE" -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/migrate.ts --target test --status > "$E/base-status-before.log" 2>&1; tail -3 "$E/base-status-before.log"
  "${ISO[@]}" run "$BASE" -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/migrate.ts --target test > "$E/base-migrate.log" 2>&1 || { cat "$E/base-migrate.log"; die migrate 6; }
  grep -E 'appl|Nothing' "$E/base-migrate.log" | tail -3
  "${ISO[@]}" run "$BASE" -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/privileges.ts --target test > "$E/base-privileges.log" 2>&1 || { tail -5 "$E/base-privileges.log"; die privileges 6; }
  tail -1 "$E/base-privileges.log"
  (
    export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=afldb_v2_super PGDATABASE=$BASE PGCONNECT_TIMEOUT=5
    PGPASSWORD=$(tr -d '\r\n' < "$W/pg/secrets/superuser.pw"); export PGPASSWORD
    PGOPTIONS='-c default_transaction_read_only=on' $PGBIN/psql -X -A -t -v ON_ERROR_STOP=1 -c "select 'ledger_count='||count(*)||' ledger_max='||max(name) from afldb_meta.schema_migrations" -c "select 'matches='||count(*)||' seasons='||min(season)||'..'||max(season) from matches" -c "select 'players='||count(*) from players" | tee "$E/base-probe.txt"
  )
  "${ISO[@]}" verify "$BASE"
  ;;
core)
  step "core editor + publication integration suites ($(( ${#CORE[@]} )) files) on a fresh clone"
  listener_proof; DB=afldb_v2_rb_gap006lxa_test; clone $DB || die clone 5
  mapfile -t F < <(files "${CORE[@]}"); vt $DB lx-core "${F[@]}"
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
coupled)
  step "import/settle-coupled integration suites (${#COUPLED[@]} files) on a fresh clone"
  listener_proof; DB=afldb_v2_rb_gap006lxb_test; clone $DB || die clone 5
  mapfile -t F < <(files "${COUPLED[@]}"); vt $DB lx-coupled "${F[@]}"
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
coleman)
  step "Coleman publication on its own schema-only target"
  listener_proof; need_disk 2; DB=afldb_v2_gap006lxschema_test
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB >/dev/null 2>&1
  "${ISO[@]}" create-db $DB || die create 5
  "${ISO[@]}" run $DB -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/migrate.ts --target test > "$E/schema-migrate.log" 2>&1 || { tail -20 "$E/schema-migrate.log"; die migrate 6; }
  grep -E 'appl|Nothing' "$E/schema-migrate.log" | tail -2
  "${ISO[@]}" run $DB -- "$NODE" node_modules/tsx/dist/cli.mjs tools/db/privileges.ts --target test > "$E/schema-privileges.log" 2>&1 || die privileges 6
  vt $DB lx-coleman tests/integration/v2-coleman-publication.test.ts
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
unit)
  step "unit suites (everything outside tests/integration, run under a disposable DSN so nothing can reach a default target)"
  listener_proof; DB=afldb_v2_rb_gap006lxc_test; clone $DB || die clone 5
  vt $DB lx-unit --exclude 'tests/integration/**' --exclude 'tests/nl-ui/**'
  "${ISO[@]}" drop-db $DB --acknowledge-destroy $DB
  ;;
typecheck)
  step "npm run typecheck (next typegen && tsc --noEmit)"
  /usr/bin/time -v -o "$E/typecheck.time" "$NODE" node_modules/next/dist/bin/next typegen > "$E/typecheck.log" 2>&1; echo "typegen exit $?"
  /usr/bin/time -v -a -o "$E/typecheck.time" "$NODE" node_modules/typescript/bin/tsc --noEmit >> "$E/typecheck.log" 2>&1; echo "tsc exit $?"
  grep -E "Maximum resident|Elapsed" "$E/typecheck.time"
  ;;
lint)
  step "eslint on every changed TypeScript/JS file since production 65c02ecc"
  mapfile -t L < "$W/xfer/changed-lintable.txt"
  "$NODE" node_modules/eslint/bin/eslint.js "${L[@]}" > "$E/eslint.log" 2>&1; echo "eslint exit $?"; tail -6 "$E/eslint.log"
  ;;
build)
  step "isolated production-mode build (off-host typecheck switch, 1 worker, 3072 MB heap) with resource sampling"
  listener_proof; need_disk 3; DB=afldb_v2_rb_gap006lxd_test; clone $DB || die clone 5
  ( while :; do echo "$(date +%s) $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"; sleep 2; done ) > "$E/build-memavail.txt" & SAMP=$!
  /usr/bin/time -v -o "$E/build.time" "${ISO[@]}" run $DB -- /usr/bin/env AFLDB_ENV=production AFLDB_BUILD_TYPECHECK=off-host AFLDB_BUILD_WORKERS=1 NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=3072 npm run build > "$E/build.log" 2>&1
  rc=$?; kill $SAMP 2>/dev/null; echo "build exit $rc"; grep -E "Maximum resident|Elapsed" "$E/build.time"
  sort -k2 -n "$E/build-memavail.txt" | head -1 | awk '{print "min MemAvailable during build: "$2" MB"}'
  du -sh .next .next/standalone 2>/dev/null; cat .next/BUILD_ID 2>/dev/null; echo; tail -5 "$E/build.log" | cut -c1-200
  echo "$DB" > "$E/build-db.txt"; df -h /home/arm | tail -1
  ;;
smoke)
  step "boot smoke of the built bundle on loopback 127.0.0.1:3197 against the disposable build DB"
  listener_proof; DB=$(cat "$E/build-db.txt") || die "no build"; ss -H -ltn "sport = :3197" | grep -q . && die "3197 in use" 4
  ( "${ISO[@]}" run $DB -- /usr/bin/env AFLDB_ENV=production AFLDB_WORKERS=1 PORT=3197 HOSTNAME=127.0.0.1 AFLDB_SESSION_SECRET="$(head -c 24 /dev/urandom | base64)" "$NODE" deploy/server-cluster.mjs > "$E/smoke-server.log" 2>&1 & echo $! > "$E/smoke.pid" )
  for i in $(seq 1 60); do curl -s -m 3 -o "$E/smoke-health.json" -w '%{http_code}' http://127.0.0.1:3197/api/health 2>/dev/null | grep -q 200 && break; sleep 1; done
  echo "health: $(cat "$E/smoke-health.json" 2>/dev/null | cut -c1-120)"
  B=$(cat .next/BUILD_ID); echo "buildManifest: $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3197/_next/static/$B/_buildManifest.js)"
  for p in / /beta /players /clubs /seasons; do echo "$p -> $(curl -s -m 20 -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:3197$p)"; done
  P=$(ss -H -ltnp "sport = :3197" | grep -oE "pid=[0-9]+" | head -1 | cut -d= -f2)
  if [ -n "$P" ] && [ "$(readlink /proc/$P/cwd)" = "$SRC" ]; then pkill -TERM -P "$P" 2>/dev/null; kill -TERM "$P" 2>/dev/null; sleep 4; else echo "smoke listener not found or not ours (pid=${P:-none}); nothing killed"; fi
  ss -H -ltn "sport = :3197" | grep -q . && echo "WARNING 3197 still listening" || echo "3197 free"
  grep -c -E "⨯|Error:" "$E/smoke-server.log" | sed 's/^/server-log error lines: /'
  ;;
stop)
  step "stop cluster, final state"
  "${ISO[@]}" list | awk '{print $1, $2}' | head -20
  "${ISO[@]}" stop; ss -H -ltn "sport = :$PORT" | grep -q . && echo "WARNING $PORT listening" || echo "$PORT free"; df -h /home/arm | tail -1
  ;;
*) echo "unknown phase"; exit 2 ;;
esac
step "phase $phase done"
