#!/usr/bin/env bash
# SHARED mode on ONE fresh copy: one `isolated-pg run` invocation per file, in the given order (AFLDB_TEST_PER_FILE_DB unset),
# then a per-table row-count diff of the used database against the untouched template. Usage:
#   bash seq.sh <label> <rb|sn> <file1> [file2 ...]
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
echo "label=$label base=$base mode=shared(unset) HEAD=$(git -C "$CAND" rev-parse HEAD) porcelain=$(git -C "$CAND" status --porcelain | wc -l)"
env | grep -c '^AFLDB_TEST_PER_FILE_DB=' | sed 's/^/per-file env vars set: /'
IR create-db "$db" --template "$T" 2>&1 | strip | tail -1
cd "$CAND" || exit 1
n=0
for f in "$@"; do
  n=$((n+1))
  timeout "${TMO:-1500}" node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$f" \
    --reporter=default --reporter=json --outputFile.json="$EV/vitest-$n.json" > "$EV/vitest-$n-raw.log" 2>&1
  rc=$?
  strip < "$EV/vitest-$n-raw.log" > "$EV/vitest-$n.log"
  echo "[$n] $f rc=$rc: $(grep -E 'Tests ' "$EV/vitest-$n.log" | tail -1 | tr -s ' ')"
  grep -E "FAIL |Error:" "$EV/vitest-$n.log" | head -6
done
node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q \"\$AFLDB_TEST_DATABASE_URL\" -f $W/counts.sql" 2>&1 | strip | grep -v '^isolated-pg:' > "$EV/counts-after.txt"
node --import tsx tools/v2/isolated-pg.ts run "$T" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q \"\$AFLDB_TEST_DATABASE_URL\" -f $W/counts.sql" 2>&1 | strip | grep -v '^isolated-pg:' > "$EV/counts-template.txt"
diff "$EV/counts-template.txt" "$EV/counts-after.txt" > "$EV/counts.diff"; echo "count diff lines (template vs used db): $(wc -l < "$EV/counts.diff")"; head -30 "$EV/counts.diff"
[ "${KEEP:-0}" = 1 ] || IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
