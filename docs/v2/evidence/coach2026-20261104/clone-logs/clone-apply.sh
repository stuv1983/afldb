#!/bin/bash
# Apply phase ON THE DISPOSABLE DATABASE ONLY (afldb_v2_coach2026_20261104_test, loopback cluster). Then measure, diff, rerun for idempotence.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
OLD=/mnt/ssd/afldb-v2-gap029-prod-20261103
W=/mnt/ssd/afldb-v2-coach2026-20261104
NEWDB=afldb_v2_coach2026_20261104_test
export AFLDB_V2_PG_ROOT="$OLD/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55493
PY="$OLD/venv/bin/python"
cd "$W/repo"
RUN() { node --import tsx tools/v2/isolated-pg.ts run "$NEWDB" -- "$@"; }
PS() { RUN bash -c "psql \"\$AFLDB_OWNER_DATABASE_URL\" -X -At -F '|' -c \"$1\"" 2>&1 | grep -v '^isolated-pg:'; }
CENSUS="select table_name||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
echo "UTC=$(date -u +%FT%TZ)"
echo "== existing-rows digest of the 32,034 pre-existing assignments BEFORE"
PS "select md5(string_agg(concat_ws('|',match_id,club_id,coach_id),',' order by match_id,club_id)), count(*) from match_coaches"
echo "== APPLY (disposable database)"
RUN "$PY" tools/migration/import_match_coaches.py --label coaches-20260905 --fitzroy-label c2-2026-final-core-v1 2>&1 | grep -v '^isolated-pg:' | tail -14 | tee "$W/logs/apply1.out"
PS "$CENSUS" > "$W/logs/census-after.txt"
echo "== table-count differences (before -> after)"
diff "$W/logs/census-before.txt" "$W/logs/census-after.txt" | grep '^[<>]' || echo "(none)"
echo "== facts after"
PS "select 'match_coaches', count(*) from match_coaches union all select 'coaches', count(*) from coaches union all select 'matches', count(*) from matches"
echo "== pre-existing 32,034 assignments unchanged? (rows for seasons <=2025: digest + count)"
PS "select md5(string_agg(concat_ws('|',mc.match_id,mc.club_id,mc.coach_id),',' order by mc.match_id,mc.club_id)), count(*) from match_coaches mc join matches m on m.id=mc.match_id where m.season<=2025"
echo "== 2026 sides still without a coach"
PS "select count(*) from (select m.id, m.home_club_id c from matches m where season=2026 union all select m.id, m.away_club_id from matches m where season=2026) s left join match_coaches mc on mc.match_id=s.id and mc.club_id=s.c where mc.match_id is null"
echo "== 2026 games per coach (derived from match_coaches join matches)"
PS "select co.name_raw, cl.name, count(*) from match_coaches mc join matches m on m.id=mc.match_id join coaches co on co.id=mc.coach_id join clubs cl on cl.id=mc.club_id where m.season=2026 group by 1,2 order by 3 desc, 1 limit 25"
echo "== Josh Carr / Josh Fraser totals"
PS "select co.name_raw, count(*), min(m.season), max(m.season) from match_coaches mc join matches m on m.id=mc.match_id join coaches co on co.id=mc.coach_id where co.name_raw ilike '%Carr, Josh%' or co.name_raw ilike '%Fraser, Josh%' group by 1"
echo "== new import batch"
PS "select id, tool, status::text, records_read, records_inserted, records_updated from import_batches order by id desc limit 2"
echo "== other tables touched? data_overrides / data_edits / players / external_identities counts"
PS "select 'data_overrides', count(*) from data_overrides union all select 'players', count(*) from players union all select 'external_identities', count(*) from external_identities"
echo "== IDEMPOTENCE rerun"
RUN "$PY" tools/migration/import_match_coaches.py --label coaches-20260905 --fitzroy-label c2-2026-final-core-v1 2>&1 | grep -v '^isolated-pg:' | tail -4
PS "select md5(string_agg(concat_ws('|',match_id,club_id,coach_id),',' order by match_id,club_id)), count(*) from match_coaches"
echo "== done (apply phase)"
