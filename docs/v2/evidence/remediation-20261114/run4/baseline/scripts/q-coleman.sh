#!/usr/bin/env bash
# read-only aggregate probe: Coleman 2001 award_winners rows on each pristine template (counts only)
set -u
export W=/mnt/ssd/afldb-rem4-baseline-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55686
cd $W/cand
for db in afldb_v2_rem4baseline_snap_tmpl_test afldb_v2_rem4baseline_rb_tmpl_test; do
  echo "== $db"
  node --import tsx tools/v2/isolated-pg.ts run $db -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -c "SELECT '"'"'coleman_2001_rows='"'"'||count(*)||'"'"' total_coleman='"'"'||(SELECT count(*) FROM award_winners w2 JOIN awards a2 ON a2.id=w2.award_id WHERE a2.slug='"'"'coleman'"'"') FROM award_winners w JOIN awards a ON a.id=w.award_id WHERE a.slug='"'"'coleman'"'"' AND w.season=2001"' 2>&1 | grep -a -v '^isolated-pg:'
done
