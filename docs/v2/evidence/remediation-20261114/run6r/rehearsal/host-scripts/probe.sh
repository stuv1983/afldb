#!/usr/bin/env bash
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
C=/mnt/ssd/afldb-rem5-t2-20261115/cand
export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
cd "$C"
IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
ss -ltn | grep -q ":55684 " && echo "cluster already up" || { IR start > /tmp/rem6r-pgstart.out 2>&1 < /dev/null; sleep 3; }
IR status 2>&1 | tail -2
IR run afldb_v2_rem4coleman276_sntmpl_test -- bash -c 'env | grep -o "^AFLDB_TEST[A-Z_]*DATABASE_URL" | sort | tr "\n" " "; echo;
 for v in AFLDB_TEST_DATABASE_URL AFLDB_TEST_IMPORT_DATABASE_URL; do echo "$v: $(psql "${!v}" -XAtc "select current_user, rolsuper from pg_roles where rolname=current_user")"; done;
 psql "$AFLDB_TEST_DATABASE_URL" -XAtc "select datname from pg_database where datname like '"'"'%rem4coleman276%'"'"' order by 1";
 psql "$AFLDB_TEST_DATABASE_URL" -XAtc "select rolname from pg_roles where rolname like '"'"'afldb%'"'"' order by 1" | tr "\n" " "; echo
 psql "$AFLDB_TEST_IMPORT_DATABASE_URL" -XAtc "select t, has_table_privilege(current_user, t, '"'"'UPDATE'"'"'), has_table_privilege(current_user, t, '"'"'TRUNCATE'"'"') from unnest(array['"'"'seasons'"'"','"'"'stat_availability'"'"','"'"'brownlow_season_votes'"'"','"'"'brownlow_season_authority'"'"','"'"'brownlow_vote_entry_state'"'"','"'"'brownlow_round_votes'"'"','"'"'player_season_stats'"'"']) t"' 2>&1 | grep -v "^isolated-pg:" | sed 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'
