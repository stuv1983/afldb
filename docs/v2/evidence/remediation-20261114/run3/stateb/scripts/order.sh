#!/usr/bin/env bash
# Explicit ORDER experiment on ONE fresh template copy: each file is its own vitest invocation, in the order given.
# Usage: bash order.sh <label> <shared|all> <file> <file> ...   (CAND = checkout under test)
set -u -o pipefail
label="$1"; mode="$2"; shift 2
W=/mnt/ssd/afldb-rem3-stateb-20261114
. <(sed -n '/^W=/,/^strip()/p' "$W/in/h.sh")
EV="$W/evidence/$label"; mkdir -p "$EV"
db="afldb_v2_rem3stateb_${label}_test"
{
echo "label=$label mode=$mode db=$db CAND=$CAND HEAD=$(git -C "$CAND" rev-parse HEAD) porcelain=$(git -C "$CAND" status --porcelain | wc -l)"
echo "order requested: $*"
date -u +%FT%TZ
IR create-db "$db" --template "$TMPL" 2>&1 | strip
RUNDB "$db" node "$W/in/snaprow.mjs" BEFORE 2>&1 | strip | grep -v '^isolated-pg:'
cd "$CAND" || exit 1
n=0
for f in "$@"; do
  n=$((n+1)); b=$(basename "$f" .test.ts)
  echo "--- step $n: $f  start $(date -u +%T.%N | cut -c1-12)"
  if [ "$mode" = all ]; then
    env AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super \
        AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw" \
        node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$f" \
        --reporter=default --reporter=json --outputFile.json="$EV/$n-$b.json" > "$EV/$n-$b.raw.log" 2>&1
  else
    node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$f" \
        --reporter=default --reporter=json --outputFile.json="$EV/$n-$b.json" > "$EV/$n-$b.raw.log" 2>&1
  fi
  echo "step $n rc=$? end $(date -u +%T.%N | cut -c1-12)"
  strip < "$EV/$n-$b.raw.log" > "$EV/$n-$b.log"
  RUNDB "$db" node "$W/in/snaprow.mjs" "AFTER-step-$n" 2>&1 | strip | grep -v '^isolated-pg:'
done
node "$W/in/summ.mjs" "$EV"/[0-9]*.json
date -u +%FT%TZ
[ "${KEEP:-0}" = 1 ] || IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -2
} 2>&1 | tee "$EV/summary.txt"
