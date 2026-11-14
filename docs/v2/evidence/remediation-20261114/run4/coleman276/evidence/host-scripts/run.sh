#!/usr/bin/env bash
# One experiment on a FRESH template copy. Usage: bash run.sh <label> <base: rb|sn> <mode: shared|all> <vitest args...>
# Db name afldb_v2_rem4coleman276_<label>_test (label: [a-z0-9]+). Checkout under test = $CAND (default $W/cand).
set -u -o pipefail
label="$1"; base="$2"; mode="$3"; shift 3
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem4-coleman276-20261115
CAND=${CAND:-$W/cand}
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
case "$base" in rb) TMPL=afldb_v2_rem4coleman276_rbtmpl_test;; sn) TMPL=afldb_v2_rem4coleman276_sntmpl_test;; *) echo "bad base"; exit 2;; esac
EV="$W/ev/$label"; mkdir -p "$EV"
db="afldb_v2_rem4coleman276_${label}_test"
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
{
echo "label=$label base=$base mode=$mode db=$db CAND=$CAND HEAD=$(git -C "$CAND" rev-parse HEAD) porcelain=$(git -C "$CAND" status --porcelain | wc -l)"
echo "args: $*"
date -u +%FT%TZ
IR create-db "$db" --template "$TMPL" 2>&1 | strip
cd "$CAND" || exit 1
set +e
if [ "$mode" = all ]; then
  env AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super \
      AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw" \
      timeout "${TMO:-1500}" node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" \
      --reporter=default --reporter=json --outputFile.json="$EV/vitest.json" > "$EV/vitest-raw.log" 2>&1
else
  timeout "${TMO:-1500}" node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" \
      --reporter=default --reporter=json --outputFile.json="$EV/vitest.json" > "$EV/vitest-raw.log" 2>&1
fi
rc=$?
echo "vitest rc=$rc"
strip < "$EV/vitest-raw.log" > "$EV/vitest.log"
grep -E "Tests |Test Files|FAIL|Error:|✓|×|AssertionError" "$EV/vitest.log" | head -${HEADN:-40}
date -u +%FT%TZ
[ "${KEEP:-0}" = 1 ] || IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -2
} 2>&1 | tee "$EV/summary.txt"
