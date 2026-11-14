#!/usr/bin/env bash
# Own-leftover refusal: fresh copy, seed the suite's OWN rows, run state-b shared; beforeAll must refuse; snapshot row untouched.
# Usage: bash ownleft.sh <label>   (CAND = checkout under test)
set -u -o pipefail
label="$1"
W=/mnt/ssd/afldb-rem3-stateb-20261114
. <(sed -n '/^W=/,/^strip()/p' "$W/in/h.sh")
EV="$W/evidence/$label"; mkdir -p "$EV"
db="afldb_v2_rem3stateb_${label}_test"
{
echo "label=$label db=$db CAND=$CAND HEAD=$(git -C "$CAND" rev-parse HEAD) porcelain=$(git -C "$CAND" status --porcelain | wc -l)"
date -u +%FT%TZ
IR create-db "$db" --template "$TMPL" 2>&1 | strip
RUNDB "$db" node "$W/in/snaprow.mjs" BEFORE 2>&1 | strip | grep -v '^isolated-pg:'
RUNDB "$db" node "$W/in/leftover.mjs" 2>&1 | strip | grep -v '^isolated-pg:'
RUNDB "$db" node "$W/in/snaprow.mjs" AFTER-SEED 2>&1 | strip | grep -v '^isolated-pg:'
cd "$CAND" || exit 1
node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run tests/integration/settle-afl-api-state-b.test.ts \
    --reporter=default --reporter=json --outputFile.json="$EV/vitest.json" > "$EV/vitest-raw.log" 2>&1
echo "vitest rc=$?"
strip < "$EV/vitest-raw.log" > "$EV/vitest.log"
RUNDB "$db" node "$W/in/snaprow.mjs" AFTER-RUN 2>&1 | strip | grep -v '^isolated-pg:'
date -u +%FT%TZ
[ "${KEEP:-0}" = 1 ] || IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -2
} 2>&1 | tee "$EV/summary.txt"
