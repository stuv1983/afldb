#!/usr/bin/env bash
# v2-coleman-publication on its documented schema-only base (adapted from run3/integ/evidence/host-scripts/coleschema.sh):
# create-db WITHOUT a template, the normal migration runner, the privileges script, then the suite in shared mode.
#   bash cs.sh <tag> <vitest file args...>
set -uo pipefail
export W=/mnt/ssd/afldb-rem4-rbfail-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55690
export NEXT_TELEMETRY_DISABLED=1
CAND=$W/cand; E=$W/evidence
tag=$1; shift
S=afldb_v2_rem4rbfail_${tag}_test
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -a -v -i 'postgres://'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
IR create-db "$S" 2>&1 | strip | tail -1
IR run "$S" -- node --import tsx tools/db/migrate.ts --target test > "$E/$tag-migrate.log" 2>&1 || { echo "migrate failed"; exit 1; }
strip < "$E/$tag-migrate.log" | tail -3
IR run "$S" -- node --import tsx tools/db/privileges.ts --target test > "$E/$tag-privileges.log" 2>&1 || { echo "privileges failed"; exit 1; }
strip < "$E/$tag-privileges.log" | tail -2
(cd "$CAND" && timeout 1800 env -u AFLDB_TEST_PER_FILE_DB node --import tsx tools/v2/isolated-pg.ts run "$S" -- node node_modules/vitest/vitest.mjs run "$@" --reporter=default --reporter=json --outputFile.json="$E/$tag.json") > "$E/$tag.log" 2>&1
echo "$tag rc=$?"
strip < "$E/$tag.log" | grep -a -E "Test Files|Tests |Duration|✓|×|FAIL" | tail -40
IR drop-db "$S" --acknowledge-destroy "$S" 2>&1 | strip | tail -1
