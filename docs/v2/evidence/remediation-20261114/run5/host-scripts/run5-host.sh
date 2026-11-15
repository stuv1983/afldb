#!/usr/bin/env bash
# Run 5 second host batch: start the cluster, award_winners diagnosis, then the B1a rehearsal (which stops the cluster).
set -u
W=/mnt/ssd/afldb-rem5-t2-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
cd "$W/cand" && node --import tsx tools/v2/isolated-pg.ts start > "$W/ev/pg-start2.out" 2>&1 < /dev/null; sleep 3
echo "=== diag $(date -u +%T)"; bash "$W/aw-diag.sh"
echo "=== b1a $(date -u +%T)"; bash "$W/b1a-rehearsal.sh"
ss -ltn | grep ":55684 " || echo "port 55684 closed (final)"
echo "=== ALL-DONE $(date -u +%T)"
