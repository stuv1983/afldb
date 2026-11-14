#!/usr/bin/env bash
# v2-coleman-publication on its documented base: a fresh, schema-only database (create-db WITHOUT a template, the normal
# migration runner, then the privileges script) - the recipe of run3/integ (coleschema.sh). Usage: bash cole.sh <label> <shared|all>
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem4-coleman276-20261115
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55684
CAND=${CAND:-$W/cand}
label="$1"; mode="$2"
EV=$W/ev/$label; mkdir -p "$EV"
S=afldb_v2_rem4coleman276_${label}_test
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
echo "label=$label mode=$mode HEAD=$(git -C "$CAND" rev-parse HEAD) porcelain=$(git -C "$CAND" status --porcelain | wc -l)"
IR create-db "$S" 2>&1 | strip | tail -1
IR run "$S" -- node --import tsx tools/db/migrate.ts --target test > "$EV/migrate.log" 2>&1 || { echo "migrate failed"; exit 1; }
strip < "$EV/migrate.log" | tail -2
IR run "$S" -- node --import tsx tools/db/privileges.ts --target test > "$EV/privileges.log" 2>&1 || { echo "privileges failed"; exit 1; }
strip < "$EV/privileges.log" | tail -2
cd "$CAND" || exit 1
if [ "$mode" = all ]; then
  env AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super \
      AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw" \
      timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$S" -- node node_modules/vitest/vitest.mjs run tests/integration/v2-coleman-publication.test.ts \
      --reporter=default --reporter=json --outputFile.json="$EV/vitest.json" > "$EV/vitest-raw.log" 2>&1
else
  timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$S" -- node node_modules/vitest/vitest.mjs run tests/integration/v2-coleman-publication.test.ts \
      --reporter=default --reporter=json --outputFile.json="$EV/vitest.json" > "$EV/vitest-raw.log" 2>&1
fi
echo "vitest rc=$?"
strip < "$EV/vitest-raw.log" > "$EV/vitest.log"
grep -E "Tests |Test Files|FAIL|Error:" "$EV/vitest.log" | head -10
IR drop-db "$S" --acknowledge-destroy "$S" 2>&1 | strip | tail -1
