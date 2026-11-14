#!/usr/bin/env bash
# read-only aggregate probe of the two templates
export W=/mnt/ssd/afldb-rem4-fixup-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55692
cd $W/cand || exit 1
SQLQ="SELECT current_database()||' decided2026='||(SELECT count(*) FROM brownlow_vote_entry_state es JOIN matches mt ON mt.id=es.match_id WHERE es.season=2026 AND es.status IN ('final','void') AND mt.round_type='home_and_away')||' status2026='||(SELECT status::text FROM seasons WHERE year=2026)||' votes2026='||(SELECT count(*) FROM brownlow_season_votes WHERE season=2026)"
for t in afldb_v2_rem4fixup_snap_tmpl_test afldb_v2_rem4fixup_rb_tmpl_test; do
  node --import tsx tools/v2/isolated-pg.ts run $t -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$SQLQ" 2>&1 | grep -a -v '^isolated-pg:'
done
