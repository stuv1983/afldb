#!/usr/bin/env bash
# Read-only provenance probe on a FRESH template copy of each base. Usage: bash prov.sh
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-coleman276-20261115
CAND=${CAND:-$W/cand}
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
mkdir -p "$W/ev/prov"
for base in rb sn; do
  case "$base" in rb) T=afldb_v2_rem4coleman276_rbtmpl_test;; sn) T=afldb_v2_rem4coleman276_sntmpl_test;; esac
  db=afldb_v2_rem4coleman276_prov${base}_test
  IR create-db "$db" --template "$T" 2>&1 | strip | tail -1
  { echo "### base=$base"; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q \"\$AFLDB_TEST_DATABASE_URL\" -f $W/prov.sql" 2>&1 | strip | grep -v '^isolated-pg:'); } > "$W/ev/prov/prov-$base.txt"
  IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
done
cat "$W/ev/prov/prov-rb.txt" "$W/ev/prov/prov-sn.txt"
