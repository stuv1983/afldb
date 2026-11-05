#!/usr/bin/env bash
# AFLDB-ISSUE-336 procedure corrections, isolated verification (part 4). DEV contact: read-only health probes and ONE read-only
# copy of DEV's current application artifact (.next/standalone + .next/BUILD_ID) into this mode-700 workspace. No DEV write,
# restart, timer change, sudo or provider request. Probe services are transient USER units on loopback ports 33364/33365.
#  R  the generated `-RestartMethod respawn` restart + ISSUE-107 worker/pool gate + readiness, executed for real against a user unit
#     running the pin's server-cluster.mjs (4 workers) over DEV data; downtime measured by a 0.2 s poller.
#  P  preserve DEV's artifact (BUILD_ID 8sFpWkolwF1yKuKbFkOir) and serve it WITHOUT npm ci or build, with 242fa276's
#     server-cluster.mjs, on the 118 schema; 4 workers; smoke.
#  N  the pin's nightly settle step on a fresh restore of today's DEV backup, fed the retained AUTHENTIC 2027 feed (218 matches),
#     two simulated nights; database facts before/after.
set -u -o pipefail
umask 077
W=/mnt/ssd/afldb/workspaces/i336-prep4-20261106
P1=/mnt/ssd/afldb/workspaces/i336-preview-20261106
CO=/mnt/ssd/afldb/workspaces/i336-preview2-20261106/checkout
OLD=/mnt/ssd/afldb/workspaces/i336-preview2-20261106/rollback-242fa276-b
BK=/mnt/ssd/afldb/workspaces/i336-backup-rehearsal-20261106
BKDUMP=$BK/out/dev-pre-v2-rehearsal/afldb_dev-20261105T191426Z.dump
PIN=8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a; OLDREV=242fa276b7b0fcb2613918984e82791faa1143d6
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=$P1/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55499
EV=$W/evidence; mkdir -p "$EV"
say() { echo "== $(date -u +%FT%TZ) $*"; }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password='; }
devhealth() { echo "afldb=$(systemctl is-active afldb) mainpid=$(systemctl show afldb -p MainPID --value) health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/health) head=$(git -C $HOME/projects/afldb rev-parse HEAD) porcelain=$(git -C $HOME/projects/afldb status --porcelain | wc -l) build_id=$(cat $HOME/projects/afldb/.next/BUILD_ID) timers=$(systemctl is-active afldb-settle-afl-api.timer)/$(systemctl is-active afldb-settle-afl-api-brownlow.timer)"; }
waitup() { for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/api/health")" = 200 ] && return 0; sleep 1; done; return 1; }
workers() { local mp; mp=$(systemctl --user show "$1" -p MainPID --value); echo "unit=$1 mainpid=$mp children=$(pgrep -P "$mp" | wc -l) distinct_x_afldb_worker_in_40=$(for i in $(seq 1 40); do curl -s -o /dev/null -D - "http://127.0.0.1:$2/api/health" | tr -d '\r' | sed -n 's/^x-afldb-worker: //Ip'; done | sort -u | tr '\n' ',') x_afldb_build=$(curl -s -o /dev/null -D - "http://127.0.0.1:$2/api/health" | tr -d '\r' | sed -n 's/^x-afldb-build: //Ip')"; }
mkenv() {  # <db> <port> <out>
  (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts run "$1" -- env) 2>/dev/null | grep -E '^(AFLDB_[A-Z0-9_]*=|DATABASE_URL=|PG[A-Z]+=)' > "$3"
  printf '%s\n' NODE_ENV=production HOSTNAME=127.0.0.1 "PORT=$2" AFLDB_WORKERS=4 AFLDB_POOL_MAX=10 AFLDB_TRACE_REQUESTS=on AFLDB_BETA_GATE=off "AFLDB_SESSION_SECRET=$(openssl rand -hex 32)" >> "$3"
  chmod 600 "$3"; echo "env file $3: $(cut -d= -f1 "$3" | sort | tr '\n' ' ')"
}
say "DEV health BEFORE"; devhealth | tee "$EV/dev-health-before.txt"

###################################################################################################################################
say "R  respawn restart, executed for real (user unit, pin's server-cluster.mjs, 4 workers, DEV data at 118)"
mkdir -p "$W/shim"; printf '#!/bin/sh\nexec /usr/bin/systemctl --user "$@"\n' > "$W/shim/systemctl"; chmod 700 "$W/shim/systemctl"
mkenv afldb_v2_i336prev_test 33364 "$W/probe-33364.env" | tee "$EV/R-env-names.txt"
systemd-run --user --unit=afldb-i336-respawn-probe -p Restart=always -p RestartSec=5 -p KillMode=mixed \
  -p "EnvironmentFile=$W/probe-33364.env" -p "WorkingDirectory=$CO" "$NODE" deploy/server-cluster.mjs 2>&1 | tee "$EV/R-unit.txt"
waitup 33364 && echo "probe unit up" | tee -a "$EV/R-unit.txt" || { echo "R: probe unit did not come up" | tee -a "$EV/R-unit.txt"; }
sleep 3; workers afldb-i336-respawn-probe 33364 | tee "$EV/R-workers-before.txt"
rm -f "$W/poll.stop"; : > "$EV/R-poll.txt"
( while [ ! -e "$W/poll.stop" ]; do echo "$(date +%s%3N) $(curl -s -o /dev/null -m 1 -w '%{http_code}' http://127.0.0.1:33364/api/health)"; sleep 0.2; done >> "$EV/R-poll.txt" ) &
POLLER=$!; sleep 2
T0=$(date +%s%3N)
PATH="$W/shim:$PATH" bash "$W/probe-restart.sh" > "$EV/R-restart.out" 2>&1; RC=$?
T1=$(date +%s%3N); sleep 2; touch "$W/poll.stop"; wait "$POLLER"
echo "generated restart+gate+readiness rc=$RC elapsed_ms=$((T1-T0))" | tee "$EV/R-summary.txt"
grep -E '^\[deploy\]|AFLDB_(WORKERS|POOL_MAX)=' "$EV/R-restart.out" | strip | tee -a "$EV/R-summary.txt"
awk 'BEGIN{down=0} { if ($2!="200") { if (!down) {s=$1; down=1}; n++ } else if (down) { d=$1-s; if (d>max) max=d; down=0; gaps++ } } END { printf "poll samples=%d non200=%d outage_windows=%d longest_outage_ms=%d\n", NR, n, gaps, max }' "$EV/R-poll.txt" | tee -a "$EV/R-summary.txt"
sleep 2; workers afldb-i336-respawn-probe 33364 | tee "$EV/R-workers-after.txt"
echo "unit NRestarts=$(systemctl --user show afldb-i336-respawn-probe -p NRestarts --value)" | tee -a "$EV/R-summary.txt"
systemctl --user stop afldb-i336-respawn-probe; systemctl --user reset-failed afldb-i336-respawn-probe 2>/dev/null
echo "probe unit stopped: $(systemctl --user is-active afldb-i336-respawn-probe)" | tee -a "$EV/R-summary.txt"

###################################################################################################################################
say "P  preserve DEV's current application artifact (read-only copy) and serve it without npm ci or build"
mkdir -p "$W/dev-app"; A=$W/dev-app/dev-app-8sFpWkolwF1yKuKbFkOir.tar
T0=$(date +%s)
tar -C "$HOME/projects/afldb" -cf "$A" .next/BUILD_ID .next/standalone; echo "tar rc=$? seconds=$(( $(date +%s)-T0 ))" | tee "$EV/P-preserve.txt"
(cd "$W/dev-app" && sha256sum "$(basename "$A")" > SHA256SUMS && cat SHA256SUMS) | tee -a "$EV/P-preserve.txt"
echo "bytes=$(stat -c %s "$A") entries=$(tar -tf "$A" | wc -l) env_files=$(tar -tf "$A" | grep -c '/\.env' ) BUILD_ID=$(tar -xOf "$A" .next/BUILD_ID) standalone_BUILD_ID=$(tar -xOf "$A" .next/standalone/.next/BUILD_ID)" | tee -a "$EV/P-preserve.txt"
R=$W/restore-app; mkdir -p "$R"
git -C "$OLD" archive "$OLDREV" deploy/server-cluster.mjs | tar -x -C "$R"
(cd "$W/dev-app" && sha256sum -c --quiet SHA256SUMS) && tar -C "$R" -xf "$A"
echo "restore dir: $(ls -A "$R" | tr '\n' ' '); root node_modules present: $([ -e "$R/node_modules" ] && echo yes || echo no); server-cluster.mjs from $OLDREV sha256 $(sha256sum "$R/deploy/server-cluster.mjs" | cut -c1-12)" | tee -a "$EV/P-preserve.txt"
mkenv afldb_v2_i336prev_test 33365 "$W/probe-33365.env" > /dev/null
systemd-run --user --unit=afldb-i336-restore-probe -p Restart=always -p RestartSec=5 -p KillMode=mixed \
  -p "EnvironmentFile=$W/probe-33365.env" -p "WorkingDirectory=$R" "$NODE" deploy/server-cluster.mjs >/dev/null 2>&1
if waitup 33365; then
  sleep 3; workers afldb-i336-restore-probe 33365 | tee "$EV/P-workers.txt"
  bash "$BK/scripts/smoke.sh" 33365 > "$EV/P-smoke-33365.txt" 2>&1
  paste -d'|' /mnt/ssd/afldb/workspaces/i336-preview2-20261106/evidence/smoke-33363-rollback.txt "$EV/P-smoke-33365.txt" \
    | awk -F'|' '{split($1,a," "); split($2,b," "); n++; if (a[1]!=b[1] || a[3]!=b[3]) {d++; print "DIFF: " $0}} END {print n " routes; " d+0 " status/marker differences from the isolated 242fa276 build"}' | tee "$EV/P-smoke-compare.txt"
else echo "P: restored artifact did not come up" | tee "$EV/P-workers.txt"; fi
systemctl --user stop afldb-i336-restore-probe; systemctl --user reset-failed afldb-i336-restore-probe 2>/dev/null
echo "restore probe stopped: $(systemctl --user is-active afldb-i336-restore-probe)" | tee -a "$EV/P-preserve.txt"

###################################################################################################################################
say "N  the pin's nightly settle on a fresh restore of today's DEV backup, fed the retained authentic 2027 feed"
NCO=$W/nightly-co
git clone -q --no-checkout "$CO" "$NCO" && git -C "$NCO" checkout -q --detach "$PIN" && [ "$(git -C "$NCO" rev-parse HEAD)" = "$PIN" ] || { echo "N: checkout failed"; exit 1; }
(cd "$NCO" && npm ci --no-audit --no-fund --include=dev > "$EV/N-npm-ci.log" 2>&1) || { echo "N: npm ci failed"; exit 1; }
cp "$W/nightly-facts.mjs" "$NCO/.nightly-facts.mjs"; cp "$BK/scripts/restore.mjs" "$NCO/.restore.mjs"
node "$W/build-match-snapshot.mjs" "$W/retained-2027" "$NCO" | tee "$EV/N-snapshot.txt"
node "$W/build-match-snapshot.mjs" "$W/retained-2027" "$NCO" afl-api-2027-2026-11-02-012026 | tee -a "$EV/N-snapshot.txt"
NDB=afldb_v2_i336night_test
NRUN() { (cd "$NCO" && AFLDB_SKIP_DOTENV=1 node --import tsx tools/v2/isolated-pg.ts run "$NDB" -- "$@") 2>&1 | strip | grep -v '^isolated-pg:'; return "${PIPESTATUS[0]}"; }
(cd "$NCO" && node --import tsx tools/v2/isolated-pg.ts create-db "$NDB") 2>&1 | strip
NRUN node .restore.mjs "$BKDUMP" "$(cut -d' ' -f1 "$BK/out/dev-pre-v2-rehearsal/SHA256SUMS" | head -1)" | tee "$EV/N-db.txt"
NRUN node --import tsx tools/db/migrate.ts --target test | tail -1 | tee -a "$EV/N-db.txt"
NRUN node --import tsx tools/db/privileges.ts --target test > "$EV/N-privileges.txt" 2>&1; echo "privileges rc=$?" | tee -a "$EV/N-db.txt"
NRUN node .nightly-facts.mjs before > "$EV/N-facts-0-before.json"
for L in afl-api-2027-2026-11-01-012026 afl-api-2027-2026-11-02-012026; do
  echo "-- $L --validate-only" | tee -a "$EV/N-settle.txt"
  NRUN node node_modules/tsx/dist/cli.mjs tools/current-season/settle-afl-api.ts --label "$L" --validate-only 2>&1 | tail -4 | tee -a "$EV/N-settle.txt"
  echo "-- $L --apply --auto-apply --require-complete-source (the wrapper's step 2, verbatim)" | tee -a "$EV/N-settle.txt"
  NRUN node node_modules/tsx/dist/cli.mjs tools/current-season/settle-afl-api.ts --label "$L" --apply --auto-apply --require-complete-source > "$EV/N-settle-$L.log" 2>&1
  echo "settle rc=$?" | tee -a "$EV/N-settle.txt"
  grep -E 'Season feed|Applied as import batch|Source complet|Refused|ERROR|afl_api settle exceptions|Latest completed batch|records read' "$EV/N-settle-$L.log" | head -12 | tee -a "$EV/N-settle.txt"
  NRUN node .nightly-facts.mjs "after $L" > "$EV/N-facts-after-$L.json"
done
(cd "$NCO" && node --import tsx tools/v2/isolated-pg.ts drop-db "$NDB" --acknowledge-destroy "$NDB") 2>&1 | strip
echo "snapshot files written per night: $(ls "$NCO/data/sources/afl_api/matches/afl-api-2027-2026-11-01-012026" | tr '\n' ' ')" | tee -a "$EV/N-settle.txt"

say "DEV health AFTER"; devhealth | tee "$EV/dev-health-after.txt"
echo PREP4-DONE
