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
NCO=$W/nightly-co; NDB=afldb_v2_i336night_test
NRUN() { (cd "$NCO" && AFLDB_SKIP_DOTENV=1 node --import tsx tools/v2/isolated-pg.ts run "$NDB" -- "$@") 2>&1 | strip | grep -v '^isolated-pg:'; return "${PIPESTATUS[0]}"; }
say "N (rerun from the facts step; the DB was restored, migrated to 118 and granted in prep4)"
cp "$W/nightly-facts.mjs" "$NCO/.nightly-facts.mjs"
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
echo PREP4N-DONE
