#!/usr/bin/env bash
# Cleanup proof: run one file per-file-less (shared) on a FRESH copy, keep the database, then diff every table's row count
# against the untouched template. Usage: bash leak.sh <label> <rb|sn> <vitest file...>
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem4-coleman276-20261115
CAND=${CAND:-$W/cand}
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
label="$1"; base="$2"; shift 2
case "$base" in rb) T=afldb_v2_rem4coleman276_rbtmpl_test;; sn) T=afldb_v2_rem4coleman276_sntmpl_test;; esac
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
EV="$W/ev/$label"; mkdir -p "$EV"
db=afldb_v2_rem4coleman276_${label}_test
IR create-db "$db" --template "$T" 2>&1 | strip | tail -1
cd "$CAND" || exit 1
timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" > "$EV/vitest-raw.log" 2>&1
echo "vitest rc=$?"
strip < "$EV/vitest-raw.log" | grep -E "Tests |Test Files|FAIL|Error:" | head -20
node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q \"\$AFLDB_TEST_DATABASE_URL\" -f $W/counts.sql" 2>&1 | strip | grep -v '^isolated-pg:' > "$EV/counts-after.txt"
# the untouched template
node --import tsx tools/v2/isolated-pg.ts run "$T" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q \"\$AFLDB_TEST_DATABASE_URL\" -f $W/counts.sql" 2>&1 | strip | grep -v '^isolated-pg:' > "$EV/counts-template.txt"
wc -l "$EV/counts-after.txt" "$EV/counts-template.txt" | head -2
diff "$EV/counts-template.txt" "$EV/counts-after.txt" > "$EV/counts.diff"; echo "count diff lines: $(wc -l < "$EV/counts.diff")"; cat "$EV/counts.diff" | head -30
[ "${KEEP:-0}" = 1 ] || IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
