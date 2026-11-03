#!/bin/bash
# Disposable proof of the 2026 coach load (ISSUE-321 follow-up). Runs on streamanator in a FRESH workspace; the retained
# GAP-029 cluster and its restored final database are used only as a TEMPLATE (read), nothing in them is modified.
# No production access. No sudo. Does not touch DEV services or the DEV database.
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
OLD=/mnt/ssd/afldb-v2-gap029-prod-20261103
W=/mnt/ssd/afldb-v2-coach2026-20261104
TEMPLATE=afldb_v2_gap029_final_20261103_091009_rst_test
NEWDB=afldb_v2_coach2026_20261104_test
echo "UTC=$(date -u +%FT%TZ)"; df -h /mnt/ssd | tail -1
[ -d "$W/repo" ] && { echo "workspace already extracted: $W/repo"; } || {
  mkdir -p "$W/repo" "$W/logs"
  tar -C "$W/repo" -xf "$W/in/repo.tar"
  mkdir -p "$W/repo/data/sources/afltables/fitzroy_core/c2-2026-final-core-v1"
  tar -C "$W/repo/data/sources/afltables/fitzroy_core/c2-2026-final-core-v1" -xf "$W/in/core.tar"
  ln -s "$OLD/cand/node_modules" "$W/repo/node_modules"
}
ls "$W/repo/data/sources/afltables/fitzroy_core/c2-2026-final-core-v1" | wc -l
export AFLDB_V2_PG_ROOT="$OLD/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55493
cd "$W/repo"
node --import tsx tools/v2/isolated-pg.ts status || true
node --import tsx tools/v2/isolated-pg.ts start
node --import tsx tools/v2/isolated-pg.ts list
node --import tsx tools/v2/isolated-pg.ts create-db "$NEWDB" --template "$TEMPLATE"
node --import tsx tools/v2/isolated-pg.ts verify "$NEWDB" | tail -8
"$OLD/venv/bin/python" -c 'import psycopg; print("psycopg", psycopg.__version__)'
echo "== setup done"
