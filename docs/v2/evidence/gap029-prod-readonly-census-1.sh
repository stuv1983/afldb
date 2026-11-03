:
# READ-ONLY production census for GAP-029 D1/D2/D4. No remote file is written; the DSN is parsed in-process and never printed.
set -u
PROD=/home/arm/projects/afldb
envval() { sed -n "s/^$1=//p" "$PROD/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
DSN=$(envval AFLDB_IMPORT_DATABASE_URL); [ -n "$DSN" ] || { echo "no credential"; exit 2; }
Q() { PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000' psql "$DSN" -X -v ON_ERROR_STOP=0 -At -F '|' -c "$1" 2>&1; }
echo "UTC=$(date -u +%FT%TZ)"
echo "== identity"; Q "select current_database(), current_user, (select oid from pg_database where datname=current_database()), current_setting('cluster_name'), current_setting('transaction_read_only')"
echo "== system identifier"; Q "select system_identifier from pg_control_system()"
echo "== captaincies"; Q "select count(*), max(id), min(import_batch_id), max(import_batch_id), md5(string_agg(concat_ws('|',season,club_id,player_id,player_name_raw,link_status_value,role,period,notes,source_id,source_record_id), E'\n' order by source_record_id)) from captaincies"
echo "== captaincies seven keys present (expect 0)"; Q "select count(*) from captaincies where source_record_id in ('0a590b03a95e13bcfac2c41c','8dbd379972bbe7f8ecf68a10','25f8dac05c6995eb838d7bef','3469269fae62fa9aa25d705d','91b499dcbe61d3386183fc8e','2c4db502ad00390a4f74db74','c9d6a0dffa2a7035f52c66e7')"
echo "== captaincies natural-key clashes for the seven (expect 0)"; Q "select count(*) from captaincies c join clubs cl on cl.id=c.club_id where (c.season,cl.name,c.player_name_raw,c.role) in ((2008,'Melbourne','Cameron Bruce','Captain'),(2008,'Melbourne','James McDonald','Captain'),(2017,'Gold Coast','Steven May','Captain'),(2018,'Gold Coast','Steven May','Captain'),(2019,'Gold Coast','Jarrod Witts','Captain'),(2020,'Gold Coast','Jarrod Witts','Captain'),(2021,'Gold Coast','Jarrod Witts','Captain'))"
echo "== identity resolution (profile|player ids|display names)"; Q "select ei.external_id, string_agg(ei.player_id::text,','), string_agg(p.display_name,',') from external_identities ei join sources s on s.id=ei.source_id and s.key='afltables' join players p on p.id=ei.player_id where ei.match_method='afltables_profile_url' and ei.status::text in ('unique','resolved') and ei.external_id in ('players/C/Cameron_Bruce.html','players/J/James_McDonald.html','players/S/Steven_May.html','players/J/Jarrod_Witts.html','players/M/Mitch_McGovern.html','players/J/Jeremy_McGovern.html','players/J/Jimmy_Webster.html') group by 1 order by 1"
echo "== clubs / source / seasons"; Q "select id, name from clubs where name in ('Melbourne','Gold Coast') order by id"; Q "select id, key from sources where key='wikipedia'"
echo "== draft state"; Q "select (select count(*) from draft_persons), (select count(player_id) from draft_persons), (select count(*) from draft_persons where is_matching_backlog), (select count(*) from draft_picks), (select count(player_id) from draft_picks)"
Q "select link_status_value::text, coalesce(match_method,'-'), count(*) from draft_picks group by 1,2 order by 3 desc"
Q "select s.key, ei.status::text, coalesce(ei.match_method,'-'), count(*), count(ei.player_id) from external_identities ei join sources s on s.id=ei.source_id where s.key in ('draftguru','afltables') group by 1,2,3 order by 1,2,3"
Q "select notes, count(*) from external_identities ei join sources s on s.id=ei.source_id where s.key='draftguru' group by 1"
Q "select id, tool, status::text, started_at from import_batches where tool ilike '%draft%' order by id"
echo "== draft non-link and link digests (persons / picks / draftguru identities)"
Q "select md5(string_agg((to_jsonb(t) - ARRAY['player_id','link_status','match_method','confidence_notes','is_matching_backlog'])::text, '|' order by id)), md5(string_agg(concat_ws(',',id,player_id,link_status,match_method,is_matching_backlog), '|' order by id)) from draft_persons t"
Q "select md5(string_agg((to_jsonb(t) - ARRAY['player_id','link_status_value','match_method','confidence_notes'])::text, '|' order by id)), md5(string_agg(concat_ws(',',id,player_id,link_status_value,match_method), '|' order by id)) from draft_picks t"
Q "select md5(string_agg((to_jsonb(t) - ARRAY['player_id','status','match_method'])::text, '|' order by id)), md5(string_agg(concat_ws(',',id,player_id,status,match_method), '|' order by id)) from external_identities t where source_id=(select id from sources where key='draftguru')"
echo "== afltables registration (rows, distinct external ids)"; Q "select count(*), count(distinct external_id) from external_identities ei join sources s on s.id=ei.source_id and s.key='afltables' where ei.player_id is not null and ei.status::text in ('unique','resolved') and ei.match_method='afltables_profile_url'"
echo "== max season / 2026"; Q "select max(season), count(*) filter (where season=2026) from matches"
echo "== siblings"; Q "select count(*) from player_relationships where relationship_type::text='sibling'" 
echo "== done"
