#!/usr/bin/env bash
# Run 5: characterise which award_winners columns differ from the template after one shared awards-reload-links run at Q''''.
# Fresh copies of the run-4 templates; kept only for the comparison, then dropped. Cluster start/stop is done by the caller.
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
W=/mnt/ssd/afldb-rem5-t2-20261115
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
cd "$W/cand" || exit 1
IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
dumprows() { # <db> <out> : one line per award_winners row, column=value pairs (jsonb each), sorted
  IR run "$1" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -At \"\$AFLDB_TEST_DATABASE_URL\" -c \"SELECT w.id || ' ' || a.slug || ' ' || k || '=' || coalesce(v::text,'null') FROM award_winners w JOIN awards a ON a.id = w.award_id, jsonb_each(to_jsonb(w)) AS e(k, v) ORDER BY w.id, k\"" 2>&1 | grep -v '^isolated-pg:' > "$2"
}
for base in sn rb; do
  db="afldb_v2_rem5t2_diag_${base}_test"; t="afldb_v2_rem4coleman276_${base}tmpl_test"; ev="$W/ev/diag_$base"; mkdir -p "$ev"
  IR create-db "$db" --template "$t" 2>&1 | strip | tail -1
  timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run tests/integration/awards-reload-links.test.ts > "$ev/vitest-raw.log" 2>&1
  echo "$base vitest rc=$?"; strip < "$ev/vitest-raw.log" | grep -E "Tests |Test Files"
  dumprows "$t" "$ev/rows-template.txt"; dumprows "$db" "$ev/rows-after.txt"
  diff "$ev/rows-template.txt" "$ev/rows-after.txt" > "$ev/rows.diff"
  echo "$base changed column-values: $(grep -c '^>' "$ev/rows.diff")"
  echo "$base by award/column:"; grep '^>' "$ev/rows.diff" | awk '{split($4,kv,"="); print $3, kv[1]}' | sort | uniq -c | sort -rn | head -20
  echo "$base distinct rows changed: $(grep '^>' "$ev/rows.diff" | awk '{print $2}' | sort -u | wc -l)"
  echo "$base sample:"; head -6 "$ev/rows.diff"
  IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
done
