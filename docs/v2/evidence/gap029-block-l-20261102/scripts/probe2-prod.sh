:
{
# Block L second read-only probe: audited-writer grants (column level), triggers, prior use of the editor path, concurrency facts.
set -u -o pipefail
export LC_ALL=C
umask 077
R=/home/arm/projects/afldb; PGBIN=/usr/lib/postgresql/16/bin
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-1}"; }
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
DSN=$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$R/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/')
[[ "$DSN" =~ $RE ]] || stop "unexpected credential form" 2
PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}; PWENC=${BASH_REMATCH[4]}
PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC DSN BASH_REMATCH
[ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] && [ "$PGHOST" = localhost ] && [ "$PGPORT" = 5432 ] || stop "credential identity" 2
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-gap029-labels-probe2 "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }
echo "== column grants for afldb_import (the audited writer's connection)"
q -c "SELECT 'col', 'data_overrides.'||c, has_column_privilege('afldb_import','public.data_overrides',c,'INSERT')::text AS ins, has_column_privilege('afldb_import','public.data_overrides',c,'UPDATE')::text AS upd
  FROM unnest(ARRAY['entity_type','entity_key','field_group','override_values','admin_user_id','is_active','updated_at']) c ORDER BY 2"
q -c "SELECT 'seq', 'data_overrides_id_seq', has_sequence_privilege('afldb_import','public.data_overrides_id_seq','USAGE')::text"
q -c "SELECT 'col', 'matches.match_event', has_column_privilege('afldb_import','public.matches','match_event','UPDATE')::text"
q -c "SELECT 'sel', t, has_table_privilege('afldb_import','public.'||t,'SELECT')::text FROM unnest(ARRAY['matches','clubs','data_edits','data_overrides']) t ORDER BY 2"
echo "== non-internal triggers on the touched tables"
q -c "SELECT 'trigger', c.relname, t.tgname, t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('matches','data_edits','data_overrides') ORDER BY 2,3"
echo "== prior use of the audited editor path in production"
q -c "SELECT 'data_edits_by_table', table_name, field_group, count(*)::text, min(created_at)::date::text, max(created_at)::date::text FROM data_edits GROUP BY 2,3 ORDER BY 2,3"
q -c "SELECT 'overrides_by_entity', entity_type, count(*)::text, count(*) FILTER (WHERE is_active)::text FROM data_overrides GROUP BY 2 ORDER BY 2"
echo "== concurrency facts (editing / maintenance exclusivity)"
q -c "SELECT 'sessions_by_user_app', usename, coalesce(application_name,''), state, count(*)::text FROM pg_stat_activity WHERE datname=current_database() GROUP BY 2,3,4 ORDER BY 2,3,4"
q -c "SELECT 'recent_import_batches', id::text, source, status, started_at::text FROM import_batches ORDER BY id DESC LIMIT 3" || true
q -c "SELECT 'max_data_edit', max(id)::text, max(created_at)::text FROM data_edits"
unset PGPASSWORD
echo "== DONE"
}
