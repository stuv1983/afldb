#!/usr/bin/env bash
# rbfail: run a read-only SQL file against one of MY isolated databases and print it (aggregates/ids only).
#   bash probe.sh <db> <sqlfile>
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-rbfail-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55690
db=$1; f=$2
cd "$W/cand" || exit 1
node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -F"|" "$AFLDB_TEST_DATABASE_URL" -f "$1"' _ "$f" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v '^isolated-pg:' || true; }
