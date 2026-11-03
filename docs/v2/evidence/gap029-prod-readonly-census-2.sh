:
set -u
PROD=/home/arm/projects/afldb
envval() { sed -n "s/^$1=//p" "$PROD/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
DSN=$(envval AFLDB_IMPORT_DATABASE_URL); [ -n "$DSN" ] || { echo "no credential"; exit 2; }
Q() { PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000' psql "$DSN" -X -At -F '|' -c "$1" 2>&1; }
echo "UTC=$(date -u +%FT%TZ)"; Q "select current_database(), current_user, current_setting('transaction_read_only')"
echo "== sibling rows"; Q "select relationship::text, count(*), count(*) filter (where person_a_player_id is not null and person_b_player_id is not null) from player_relationships group by 1"
Q "select count(*) from player_relationships where source_record_id like 'siblings:afldb-sibling-supplement:%'"
Q "select md5(string_agg(concat_ws('|',source_record_id,person_a_player_id,person_b_player_id,relationship_label,family_key), E'\n' order by source_record_id)) from player_relationships where source_record_id like 'siblings:%'"
echo "== pair already present (expect 0)"; Q "select count(*) from player_relationships where (person_a_player_id,person_b_player_id) in ((6937,9714),(9714,6937))"
echo "== mitch / jeremy career games"; Q "select p.id, p.display_name, coalesce(sum(s.games),0) from players p left join player_career_stats s on s.player_id=p.id where p.id in (6937,9714,7271) group by 1,2 order by 1"
echo "== done"
