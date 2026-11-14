#!/usr/bin/env bash
# read-only SQL: q.sh <db> <sqlfile>   (runs through isolated-pg run on this scope's port)
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-integb-20261114
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55675
db=$1; f=$2
cd "$W/cand" && timeout 300 node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -F"|" "$AFLDB_TEST_DATABASE_URL" -f "$1"' _ "$f" 2>&1 | { grep -a -v '^isolated-pg:' || true; }
