#!/usr/bin/env bash
set -uo pipefail; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-backlog-20261122b-348; C=$W/co
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61540 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
for db in afldb_v2_b348_r0tpl_test afldb_v2_b348_reh1_test afldb_v2_b348_reh2_test; do
  echo "== $db"
  (cd $C && node --import tsx tools/v2/isolated-pg.ts run $db -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -At -F'|' \"\$AFLDB_BACKUP_DATABASE_URL\" -f $W/draftguru-surface-digest.sql") 2>&1 | grep -v '^isolated-pg:' | tee $W/ev/digest-$db.txt
done
