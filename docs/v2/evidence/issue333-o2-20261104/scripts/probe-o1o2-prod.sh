:
{
# ISSUE-333 (O1) / O2 read-only production probe, 2026-11-04. No write of any kind: every statement runs in a read-only session
# (default_transaction_read_only=on) as afldb_backup through the existing protected channel (AFLDB_BACKUP_DATABASE_URL in the
# checkout .env), parsed into PG* variables only, never argv, never printed. Output goes to stdout only.
set -u -o pipefail
export LC_ALL=C
umask 077
R=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-1}"; }

step "H host, user, disk"
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
echo "host=$(hostname) user=$(id -un) date_local=$(date '+%F %T %Z')"
df --output=avail,pcent -B1 /home/arm | tail -1
for u in afldb.service afldb-settle-afltables.service afldb-settle-afltables.timer afldb-settle-afl-api.service afldb-settle-afl-api.timer \
  afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer afldb-email-intake.service afldb-email-intake.timer; do
  printf '%s active=%s enabled=%s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null)" "$(systemctl is-enabled "$u" 2>/dev/null)"
done
echo "afl-api timer next=$(systemctl show --timestamp=unix -p NextElapseUSecRealtime --value afldb-settle-afl-api.timer 2>/dev/null) now=$(date +%s)"
echo "afldb-settle-afl-api.service User=$(systemctl show -p User --value afldb-settle-afl-api.service 2>/dev/null) EnvironmentFiles=$(systemctl show -p EnvironmentFiles --value afldb-settle-afl-api.service 2>/dev/null | cut -c1-120)"
echo "checkout_head=$(GIT_OPTIONAL_LOCKS=0 git -C $R rev-parse HEAD 2>&1) status_lines=$(GIT_OPTIONAL_LOCKS=0 git -C $R status --porcelain 2>&1 | wc -l)"
echo "python=$($R/.venv/bin/python -c 'import sys, psycopg; print(sys.version.split()[0], psycopg.__version__)' 2>&1)"
ls -ld /home/arm/ops /home/arm/backups/afldb 2>&1
ls /home/arm/ops 2>&1 | tr '\n' ' '; echo

step "C credential channel (values never printed)"
ENVF="$R/.env"; [ -r "$ENVF" ] || stop "env file unreadable" 2
DSN=$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/')
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
[[ "$DSN" =~ $RE ]] || { unset DSN; stop "backup credential has an unexpected form (value not printed)" 2; }
PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}; PWENC=${BASH_REMATCH[4]}
PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC DSN BASH_REMATCH
[ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] || stop "credential is not afldb_backup/afldb_prod" 2
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
q() { PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=2000' PGAPPNAME=afldb-o1o2-probe "$PGBIN/psql" -X -q -At -F '|' -P pager=off -v ON_ERROR_STOP=1 -c "$1"; }

step "I identity"
q "SELECT current_database(), current_user, current_setting('transaction_read_only'), (SELECT system_identifier::text FROM pg_control_system()), (SELECT oid FROM pg_database WHERE datname=current_database()), current_setting('cluster_name'), current_setting('server_version'), now()"

q "SELECT 'timezone', current_setting('TimeZone'), current_setting('lock_timeout'), current_setting('statement_timeout')"
systemctl list-timers --all --no-pager 2>/dev/null | grep -i afldb | cut -c1-200
for t in afldb-settle-afltables.timer afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer; do echo "$t $(systemctl show -p TimersCalendar,Persistent,RandomizedDelayUSec --value $t 2>/dev/null | tr '\n' ' ')"; done
echo "host_tz=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)"

step "L ledger"
LED=$(q "SELECT name||chr(9)||checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\"")
echo "ledger rows=$(printf '%s\n' "$LED" | wc -l) last=$(printf '%s\n' "$LED" | tail -1 | cut -f1) digest=$(printf '%s\n' "$LED" | sha256sum | cut -c1-64)"
q "SELECT string_agg(extname||'='||extversion, ' ' ORDER BY extname) FROM pg_extension"

step "O1 counts"
q "SELECT 'match_coaches', count(*) FROM match_coaches UNION ALL SELECT 'coaches', count(*) FROM coaches
 UNION ALL SELECT 'matches_2026', count(*) FROM matches WHERE season=2026
 UNION ALL SELECT 'sides_2026_without_coach', count(*) FROM (SELECT id, home_club_id c FROM matches WHERE season=2026 UNION ALL SELECT id, away_club_id FROM matches WHERE season=2026) s LEFT JOIN match_coaches mc ON mc.match_id=s.id AND mc.club_id=s.c WHERE mc.match_id IS NULL
 UNION ALL SELECT 'match_coaches_2026', count(*) FROM match_coaches mc JOIN matches m ON m.id=mc.match_id WHERE m.season=2026
 UNION ALL SELECT 'import_batches', count(*) FROM import_batches UNION ALL SELECT 'import_batches_max_id', max(id) FROM import_batches
 UNION ALL SELECT 'import_rejections', count(*) FROM import_rejections UNION ALL SELECT 'import_rejections_max_id', coalesce(max(id),0) FROM import_rejections
 UNION ALL SELECT 'data_overrides_coach_all', count(*) FROM data_overrides WHERE entity_type IN ('coaches','match_coaches')
 UNION ALL SELECT 'data_overrides_coach_active', count(*) FROM data_overrides WHERE entity_type IN ('coaches','match_coaches') AND is_active
 UNION ALL SELECT 'coaches_manual', count(*) FROM coaches WHERE afltables_coach_path LIKE 'manual:%'
 UNION ALL SELECT 'match_coaches_non_afltables_source', count(*) FROM match_coaches mc JOIN sources s ON s.id=mc.source_id WHERE s.key<>'afltables'
 UNION ALL SELECT 'data_edits_coach_assignment', count(*) FROM data_edits WHERE field_group='coach_assignment'
 UNION ALL SELECT 'data_edits_coaches', count(*) FROM data_edits WHERE table_name='coaches'"
q "SELECT 'carr_fraser', id, afltables_coach_path, name_key, (SELECT count(*) FROM match_coaches mc WHERE mc.coach_id=c.id) FROM coaches c WHERE name_key IN ('Carr, Josh','Fraser, Josh')"
q "SELECT 'recent_batch', id, tool, target_table, status::text, started_at, completed_at FROM import_batches ORDER BY id DESC LIMIT 4"

step "S schema: columns, triggers, rules, dependants"
q "SELECT table_name, string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-')||':'||is_identity, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('match_coaches','coaches','import_batches','data_issues') GROUP BY 1 ORDER BY 1"
q "SELECT 'trigger', c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('match_coaches','coaches','import_batches','data_issues','player_match_stats') ORDER BY 2,3"
q "SELECT 'rule', tablename, rulename FROM pg_rules WHERE tablename IN ('match_coaches','coaches','import_batches','data_issues')"
q "SELECT 'policy', tablename, policyname FROM pg_policies WHERE tablename IN ('match_coaches','coaches','import_batches','data_issues')"
q "SELECT 'rowsecurity', relname, relrowsecurity FROM pg_class WHERE relname IN ('match_coaches','coaches','import_batches','data_issues') AND relnamespace='public'::regnamespace"
q "SELECT 'dependent_view', DISTINCT_v FROM (SELECT DISTINCT v.oid::regclass::text AS DISTINCT_v FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class v ON v.oid=r.ev_class WHERE d.refobjid IN ('public.match_coaches'::regclass,'public.coaches'::regclass,'public.data_issues'::regclass) AND v.oid NOT IN ('public.match_coaches'::regclass,'public.coaches'::regclass,'public.data_issues'::regclass)) x"
q "SELECT 'matviews', count(*) FROM pg_matviews"
q "SELECT 'index', indexname, indexdef FROM pg_indexes WHERE tablename IN ('match_coaches','data_issues') ORDER BY 2"
q "SELECT 'fk_to', conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE confrelid IN ('public.match_coaches'::regclass,'public.data_issues'::regclass)"

step "P privileges (no grant is made; read only)"
for r in afldb_import afldb_app afldb_owner; do
  q "SELECT '$r', t, string_agg(p, ',' ORDER BY p) FROM (VALUES ('public.match_coaches'),('public.coaches'),('public.import_batches'),('public.import_rejections'),('public.data_issues'),('public.player_match_stats'),('staging.afl_api_player_match'),('public.data_overrides')) v(t)
   CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) w(p) WHERE has_table_privilege('$r', t, p) GROUP BY t ORDER BY t" 2>&1
done
q "SELECT 'column_update_data_issues', r, string_agg(c, ',' ORDER BY c) FROM (VALUES ('afldb_import'),('afldb_app')) a(r) CROSS JOIN (SELECT column_name c FROM information_schema.columns WHERE table_schema='public' AND table_name='data_issues') b WHERE has_column_privilege(r, 'public.data_issues', c, 'UPDATE') GROUP BY r"
q "SELECT 'role', rolname, rolsuper, rolinherit, rolbypassrls FROM pg_roles WHERE rolname LIKE 'afldb%' ORDER BY 2"
q "SELECT 'member', r.rolname, m.rolname FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.roleid JOIN pg_roles m ON m.oid=am.member WHERE m.rolname LIKE 'afldb%' ORDER BY 2,3"

step "O2 the open canonical_apply_failed findings"
q "SELECT 'open_by_type', issue_type, details->>'refusal', details->>'source_key', entity_type, count(*), min(id), max(id), min(detected_at), max(detected_at) FROM data_issues WHERE resolved_at IS NULL GROUP BY 2,3,4,5 ORDER BY 2,3"
q "SELECT 'o2_rows', count(*), min(id), max(id), md5(string_agg(id::text||'|'||issue_key, ',' ORDER BY id)), sum(jsonb_array_length(details->'fields')), count(DISTINCT details->>'owner'), string_agg(DISTINCT details->>'owner', ';')
   FROM data_issues WHERE id BETWEEN 41 AND 76"
q "SELECT 'o2_ids_match_predicate', count(*) FROM data_issues WHERE id BETWEEN 41 AND 76 AND issue_type='canonical_apply_failed' AND resolved_at IS NULL AND details->>'refusal'='foreign_source_owner' AND details->>'source_key'='afl_api' AND entity_type='player_match_stats'"
q "SELECT 'o2_predicate_total', count(*), min(id), max(id) FROM data_issues WHERE issue_type='canonical_apply_failed' AND resolved_at IS NULL AND details->>'refusal'='foreign_source_owner'"
q "SELECT 'o2_detail_keys', string_agg(DISTINCT k, ',') FROM data_issues, jsonb_object_keys(details) k WHERE id BETWEEN 41 AND 76"
q "SELECT 'o2_sample', id, issue_key, entity_id, details::text FROM data_issues WHERE id IN (41, 76)"
q "WITH f AS (SELECT d.id, d.entity_id, d.details->>'external_record_id' ext, (d.details->>'source_version_seq')::int seq, jsonb_array_elements_text(d.details->'fields') fld FROM data_issues d WHERE d.id BETWEEN 41 AND 76)
 SELECT 'o2_compare', f.fld, count(*), count(*) FILTER (WHERE to_jsonb(p)->f.fld IS NOT DISTINCT FROM to_jsonb(s)->f.fld) eq,
   count(*) FILTER (WHERE to_jsonb(p)->>f.fld IS NULL OR to_jsonb(s)->>f.fld IS NULL) nulls, count(*) FILTER (WHERE s.version_seq = f.seq) same_version, count(*) FILTER (WHERE p.id IS NULL) no_canonical, count(*) FILTER (WHERE s.external_record_id IS NULL) no_staged
 FROM f LEFT JOIN player_match_stats p ON p.id=f.entity_id LEFT JOIN staging.afl_api_player_match s ON s.external_record_id=f.ext AND s.family='player_match_stats' AND s.source_id=(SELECT id FROM sources WHERE key='afl_api')
 GROUP BY 2 ORDER BY 3 DESC, 2"
q "SELECT 'o2_canonical_owner', s.key, p.import_batch_id, count(*) FROM data_issues d JOIN player_match_stats p ON p.id=d.entity_id JOIN sources s ON s.id=p.source_id WHERE d.id BETWEEN 41 AND 76 GROUP BY 2,3"
q "SELECT 'o2_staged_versions', count(*) FILTER (WHERE s.version_seq=(d.details->>'source_version_seq')::int), count(*) FILTER (WHERE s.version_seq>(d.details->>'source_version_seq')::int), count(*) FILTER (WHERE s.version_seq IS NULL) FROM data_issues d LEFT JOIN staging.afl_api_player_match s ON s.external_record_id=d.details->>'external_record_id' AND s.family='player_match_stats' WHERE d.id BETWEEN 41 AND 76"
q "SELECT 'o2_resolution_vocab', resolution, count(*) FROM data_issues WHERE issue_type='canonical_apply_failed' AND resolved_at IS NOT NULL GROUP BY 2 ORDER BY 3 DESC LIMIT 10"
q "SELECT 'data_issues_total', count(*), count(*) FILTER (WHERE resolved_at IS NULL), max(id) FROM data_issues"
unset PGPASSWORD
step DONE
}
