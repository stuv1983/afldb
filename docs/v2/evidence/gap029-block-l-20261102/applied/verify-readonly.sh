#!/bin/bash
# independent read-only verification as afldb_backup
set -u -o pipefail
export LC_ALL=C
PROD=/home/arm/projects/afldb; PGBIN=/usr/lib/postgresql/16/bin
DSN=$(sed -n "s/^AFLDB_BACKUP_DATABASE_URL=//p" "$PROD/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/')
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
[[ "$DSN" =~ $RE ]] || { echo bad dsn; exit 2; }
export PGUSER=${BASH_REMATCH[2]} PGHOST=${BASH_REMATCH[5]} PGPORT=${BASH_REMATCH[7]:-5432} PGDATABASE=${BASH_REMATCH[8]}; PWENC=${BASH_REMATCH[4]}
export PGPASSWORD=$(printf '%b' "${PWENC//\%/\x}"); unset PWENC DSN BASH_REMATCH
q() { PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000' "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -v ON_ERROR_STOP=1 "$@"; }
echo "## identity"; q -c "SELECT current_user, current_database(), (SELECT system_identifier FROM pg_control_system()), (SELECT oid FROM pg_database WHERE datname=current_database()), now()"
echo "## columns"; q -c "SELECT table_name, string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name IN ('data_edits','data_overrides') AND table_schema='public' GROUP BY 1"
echo "## totals"; q -c "SELECT 'matches', count(*)::text, max(match_date)::text FROM matches" -c "SELECT 'labelled', count(*)::text FROM matches WHERE match_event IS NOT NULL" -c "SELECT 'data_edits_total', count(*)::text, max(id)::text FROM data_edits" -c "SELECT 'data_overrides_total', count(*)::text, max(id)::text FROM data_overrides" -c "SELECT 'ledger', count(*)::text, max(name) FROM afldb_meta.schema_migrations"
echo "## labelled rows"; q -c "SELECT id, match_event FROM matches WHERE match_event IS NOT NULL ORDER BY id"
echo "## edits"; q -c "SELECT id, table_name, row_id, field_group, old_values::text, new_values::text, admin_user_id, coalesce(note,'') FROM data_edits WHERE table_name='matches' AND field_group='match_event' ORDER BY row_id, id"
echo "## overrides"; q -c "SELECT to_jsonb(o)::text FROM data_overrides o WHERE entity_type='matches' AND field_group='match_event' ORDER BY id"
echo "## other edits in last 24h (not match_event)"; q -c "SELECT id, table_name, field_group, admin_user_id FROM data_edits WHERE NOT (table_name='matches' AND field_group='match_event') AND id > (SELECT max(id) - 5 FROM data_edits WHERE NOT (table_name='matches' AND field_group='match_event')) ORDER BY id"
unset PGPASSWORD
