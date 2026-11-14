#!/usr/bin/env bash
# war-years proof experiment, one fresh copy per run, shared mode, forced file order as separate invocations:
#   exp.sh <label> <template-db> <order>     order = steps joined by '+' from: b (settle-afl-api-brownlow) d (database)
# Writes evidence/exp/<label>-* : vitest JSON per step, stat_availability season-2026 rows before and after every step.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-integb-20261114
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55675
label=$1; tmpl=$2; order=$3
E="$W/evidence/exp"; mkdir -p "$E"
cd "$W/cand"
db=afldb_v2_rem3integb_x_${label}_test
echo "HEAD $(git rev-parse HEAD) porcelain $(git status --porcelain | wc -l)" | tee "$E/$label.head"
node --import tsx tools/v2/isolated-pg.ts create-db "$db" --template "$tmpl" 2>&1 | tail -1
cat > "$W/in/rows2026.sql" <<'EOF'
SELECT stat_key, season, is_recorded, coverage::text, populated_rows, total_rows FROM stat_availability WHERE season = 2026 ORDER BY stat_key;
EOF
rows() { # rows <tag>
  node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -f "$1"' _ "$W/in/rows2026.sql" 2>&1 | { grep -a -v '^isolated-pg:' || true; } > "$E/$label-rows-$1.txt"
  echo "rows $1: $(wc -l < "$E/$label-rows-$1.txt") lines, md5 $(md5sum < "$E/$label-rows-$1.txt" | cut -c1-12)"
}
rows start
i=0
IFS='+' read -r -a steps <<< "$order"
for s in "${steps[@]}"; do
  i=$((i+1))
  case "$s" in b) f=tests/integration/settle-afl-api-brownlow.test.ts ;; d) f=tests/integration/database.test.ts ;; *) echo "bad step $s"; exit 2 ;; esac
  timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$f" --no-cache \
    --reporter=default --reporter=json --outputFile.json="$E/$label-step$i-$s.json" > "$E/$label-step$i-$s.log" 2>&1
  echo "step $i $s rc=$?"
  rows "after$i$s"
done
