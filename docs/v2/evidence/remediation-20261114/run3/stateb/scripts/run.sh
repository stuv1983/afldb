#!/usr/bin/env bash
# One experiment on a FRESH template copy. Usage: bash run.sh <label> <mode: shared|all> <vitest args...>
# Db name afldb_v2_rem3stateb_<label>_test (label: [a-z0-9]+). CAND (default $W/cand) must be the checkout under test.
set -u -o pipefail
label="$1"; mode="$2"; shift 2
HELP=/mnt/ssd/afldb-rem3-stateb-20261114/in/h.sh
W=/mnt/ssd/afldb-rem3-stateb-20261114
. <(sed -n '/^W=/,/^strip()/p' "$HELP")   # same env + IR/RUNDB helpers
EV="$W/evidence/$label"; mkdir -p "$EV"
db="afldb_v2_rem3stateb_${label}_test"
{
echo "label=$label mode=$mode db=$db CAND=$CAND HEAD=$(git -C "$CAND" rev-parse HEAD) porcelain=$(git -C "$CAND" status --porcelain | wc -l)"
echo "args: $*"
date -u +%FT%TZ
IR create-db "$db" --template "$TMPL" 2>&1 | strip
RUNDB "$db" node "$W/in/snaprow.mjs" BEFORE 2>&1 | strip | grep -v '^isolated-pg:'
cd "$CAND" || exit 1
set +e
if [ "$mode" = all ]; then
  env AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super \
      AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw" \
      node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" \
      --reporter=default --reporter=json --outputFile.json="$EV/vitest.json" > "$EV/vitest-raw.log" 2>&1
else
  node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" \
      --reporter=default --reporter=json --outputFile.json="$EV/vitest.json" > "$EV/vitest-raw.log" 2>&1
fi
rc=$?
echo "vitest rc=$rc"
strip < "$EV/vitest-raw.log" > "$EV/vitest.log"
RUNDB "$db" node "$W/in/snaprow.mjs" AFTER 2>&1 | strip | grep -v '^isolated-pg:'
date -u +%FT%TZ
[ "${KEEP:-0}" = 1 ] || IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -2
} 2>&1 | tee "$EV/summary.txt"
