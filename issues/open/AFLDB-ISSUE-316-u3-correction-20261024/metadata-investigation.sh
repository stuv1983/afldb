#!/bin/bash
# AFLDB-ISSUE-316: owner-authorised U3 correction precondition gate, 2026-10-24.
# Streamed through ssh; no remote files or canonical changes. No census or Brownlow table reads.
set -eu -o pipefail
R=/home/arm/projects/afldb
[ "$(hostname)" = afldb-prod ] || { echo "STOP: unexpected host"; exit 3; }
ENVF="$R/.env"
[ -r "$ENVF" ] || { echo "BLOCKED: env file unreadable"; exit 2; }
DSN=$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/')
[ -n "$DSN" ] || { echo "BLOCKED: AFLDB_BACKUP_DATABASE_URL empty"; exit 2; }
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
PGUSER=$(printf '%s' "$DSN" | sed -E "s#$RE#\2#")
PGHOST=$(printf '%s' "$DSN" | sed -E "s#$RE#\5#")
PGPORT=$(printf '%s' "$DSN" | sed -E "s#$RE#\7#"); [ -n "$PGPORT" ] || PGPORT=5432
PGDATABASE=$(printf '%s' "$DSN" | sed -E "s#$RE#\8#")
PWENC=$(printf '%s' "$DSN" | sed -E "s#$RE#\4#")
PGPASSWORD=$(printf '%b' "${PWENC//%/\\x}"); unset PWENC DSN
echo "dsn_identity user=$PGUSER host=$PGHOST port=$PGPORT database=$PGDATABASE"
[ "$PGDATABASE" = afldb_prod ] && [ "$PGUSER" = afldb_backup ] || { unset PGPASSWORD; echo "BLOCKED: credential is not afldb_backup@afldb_prod"; exit 2; }
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
export PGAPPNAME=afldb-i316-u3-correction-precheck PGCONNECT_TIMEOUT=10


echo DEPLOYED_SOURCE_BEGIN
sha256sum "$R/src/db/queries/audit-log.ts"
sha256sum "$R/src/db/queries/match-sheet.ts"
sha256sum "$R/src/db/queries/player-derived.ts"
sha256sum "$R/src/app/admin/data-editor/MatchSheetEditor.tsx"
sha256sum "$R/src/app/admin/data-editor/actions.ts"
sha256sum "$R/src/app/admin/audit/page.tsx"
sha256sum "$R/src/app/admin/audit/entity/[table]/[rowId]/page.tsx"
sha256sum "$R/src/db/queries/audit-reader.ts"
sed -n '200,240p' "$R/src/app/admin/data-editor/actions.ts"
sed -n '836,855p' "$R/src/app/admin/data-editor/MatchSheetEditor.tsx"
cat "$R/src/db/queries/audit-log.ts"
echo DEPLOYED_SOURCE_END
psql -X -q -At -P pager=off -v ON_ERROR_STOP=1 -f - <<'SQL'
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database()='afldb_prod' AND current_user='afldb_backup'
 AND (SELECT oid FROM pg_database WHERE datname=current_database())=66668
 AND (SELECT system_identifier::text FROM pg_control_system())='7674454702926115004'
 AND current_setting('transaction_read_only')='on' AS identity_ok \gset
\if :identity_ok
SELECT jsonb_build_object('columns',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('public','staging') AND (table_name IN ('data_edits','data_overrides','player_career_stats','player_season_stats','player_club_season_stats','player_clubs','club_seasons') OR table_name LIKE '%period%' OR table_name LIKE 'afltables_match%') ORDER BY table_schema,table_name,ordinal_position) x),'triggers',(SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT c.relname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname IN ('data_edits','data_overrides') AND NOT t.tgisinternal) x),'authority93',(SELECT to_jsonb(o) FROM data_overrides o WHERE id=93),'edit94',(SELECT to_jsonb(d) FROM data_edits d WHERE id=94))::text;
\else
\echo STOP_IDENTITY
\quit 3
\endif
ROLLBACK;
SQL
unset PGPASSWORD
echo READ_ONLY_INVESTIGATION_COMPLETED
