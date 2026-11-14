#!/usr/bin/env bash
# rbfail: prove the cross-file leak by running TWO SINGLE-FILE shared runs back to back on ONE rebuild copy (no multi-file group).
set -u -o pipefail
export W=/mnt/ssd/afldb-rem4-rbfail-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55690 NEXT_TELEMETRY_DISABLED=1
CAND=$W/cand; E=$W/evidence; T=tests/integration
db=afldb_v2_rem4rbfail_pair_test
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
Q() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | grep -a -v '^isolated-pg:'); }
IR create-db $db --template afldb_v2_rem4rbfail_rbb_tmpl_test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -1
for step in "1 match-admin-delete" "2 afl-api-c7-observation" "3 afl-api-c7-observation"; do
  set -- $step; n=$1; f=$2
  (cd "$CAND" && timeout 900 env -u AFLDB_TEST_PER_FILE_DB node --import tsx tools/v2/isolated-pg.ts run $db -- node node_modules/vitest/vitest.mjs run $T/$f.test.ts --reporter=default --reporter=json --outputFile.json="$E/pair-$n.json") > "$E/pair-$n.log" 2>&1
  echo "pair step $n ($f) rc=$?"; sed 's/\x1b\[[0-9;]*m//g' < "$E/pair-$n.log" | grep -a -E "Test Files|Tests " | tail -2
  node "$W/in/vfail.js" "$E/pair-$n.json" "$CAND" > "$E/pair-$n-failures.tsv" 2>/dev/null; cut -c1-330 "$E/pair-$n-failures.tsv"
  echo "-- committed leftovers after step $n"
  Q "SELECT 'club_seasons2027', count(*) FROM club_seasons WHERE season=2027 UNION ALL SELECT 'matches2027', count(*) FROM matches WHERE season=2027 UNION ALL SELECT 'seasons2027', count(*) FROM seasons WHERE year=2027" | tee "$E/pair-$n-leftovers.txt"
done
IR drop-db $db --acknowledge-destroy $db 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -1
