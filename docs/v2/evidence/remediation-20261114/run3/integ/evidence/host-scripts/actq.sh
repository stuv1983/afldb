#!/usr/bin/env bash
# read-only: what is the running Brownlow production-correction backend doing (aggregates of pg_stat_activity only)
W=/mnt/ssd/afldb-rem3-integ-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" AFLDB_V2_PG_ROOT=$W-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55673
cd $W/cand || exit 1
cat > $W/in/actq.sql <<'SQL'
select pid, state, now()-query_start as running, wait_event_type, left(regexp_replace(query, '\s+', ' ', 'g'), 500) as q
from pg_stat_activity where datname = 'afldb_v2_brownlow_policy_final_test';
SQL
timeout 60 node --import tsx tools/v2/isolated-pg.ts run afldb_v2_rem3integ_tmpl_test -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -f '"$W"'/in/actq.sql' 2>&1 | grep -a -v '^isolated-pg:'
