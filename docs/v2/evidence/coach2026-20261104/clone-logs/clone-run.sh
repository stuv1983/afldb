#!/bin/bash
# Run phase: measure, validate, dry-run, apply on the DISPOSABLE database only, measure again, diff. Loopback cluster, no production access.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
OLD=/mnt/ssd/afldb-v2-gap029-prod-20261103
W=/mnt/ssd/afldb-v2-coach2026-20261104
NEWDB=afldb_v2_coach2026_20261104_test
export AFLDB_V2_PG_ROOT="$OLD/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55493
PY="$OLD/venv/bin/python"
cd "$W/repo"
RUN() { node --import tsx tools/v2/isolated-pg.ts run "$NEWDB" -- "$@"; }
CENSUS="select table_name||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
FACTS="select 'match_coaches', count(*) from match_coaches union all select 'coaches', count(*) from coaches union all select '2026 sides w/o coach', count(*) from (select m.id, m.home_club_id c from matches m where season=2026 union all select m.id, m.away_club_id from matches m where season=2026) s left join match_coaches mc on mc.match_id=s.id and mc.club_id=s.c where mc.match_id is null union all select 'nm1940 sides w/o coach', count(*) from (select m.id, m.home_club_id c from matches m where season=1940 union all select m.id, m.away_club_id from matches m where season=1940) s join clubs cl on cl.id=s.c left join match_coaches mc on mc.match_id=s.id and mc.club_id=s.c where mc.match_id is null and cl.name='North Melbourne'"
echo "UTC=$(date -u +%FT%TZ) workspace=$W"
echo "== BEFORE: facts"; RUN bash -c "psql \"\$AFLDB_OWNER_DATABASE_URL\" -X -At -F '|' -c \"$FACTS\"" 2>&1 | tail -6
RUN bash -c "psql \"\$AFLDB_OWNER_DATABASE_URL\" -X -At -c \"$CENSUS\"" > "$W/logs/census-before.txt" 2>&1; wc -l < "$W/logs/census-before.txt"
RUN bash -c "psql \"\$AFLDB_OWNER_DATABASE_URL\" -X -At -F '|' -c \"select md5(string_agg(concat_ws('|',match_id,club_id,coach_id),',' order by match_id,club_id)) from match_coaches\"" > "$W/logs/mc-digest-before.txt" 2>&1; echo "match_coaches digest before: $(cat "$W/logs/mc-digest-before.txt")"
echo "== importer: validate-only (offline artefact check)"
$PY tools/migration/import_match_coaches.py --label coaches-20260905 --fitzroy-label c2-2026-final-core-v1 --validate-only 2>&1 | tail -15
echo "== importer: dry-run on the disposable database"
RUN "$PY" tools/migration/import_match_coaches.py --label coaches-20260905 --fitzroy-label c2-2026-final-core-v1 --dry-run 2>&1 | tail -40 | tee "$W/logs/dry-run.out"
echo "== done (dry-run phase)"
