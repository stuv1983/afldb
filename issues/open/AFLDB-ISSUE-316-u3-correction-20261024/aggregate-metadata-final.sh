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


psql -X -q -At -P pager=off -v ON_ERROR_STOP=1 -f - <<'SQL'
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database()='afldb_prod' AND current_user='afldb_backup'
 AND (SELECT oid FROM pg_database WHERE datname=current_database())=66668
 AND (SELECT system_identifier::text FROM pg_control_system())='7674454702926115004'
 AND current_setting('transaction_read_only')='on' AS identity_ok \gset
\if :identity_ok
WITH clubs AS(SELECT unnest(ARRAY[6,16]) AS club_id), sides AS(SELECT c.club_id,m.*,CASE WHEN c.club_id=m.home_club_id THEN m.home_score ELSE m.away_score END AS score_for,CASE WHEN c.club_id=m.home_club_id THEN m.away_score ELSE m.home_score END AS score_against FROM clubs c JOIN matches m ON c.club_id IN(m.home_club_id,m.away_club_id) WHERE season=2026), expected AS(SELECT club_id,count(*) FILTER(WHERE NOT is_final) AS played,count(*) FILTER(WHERE NOT is_final AND winner_club_id=club_id) AS wins,count(*) FILTER(WHERE NOT is_final AND result='draw') AS draws,count(*) FILTER(WHERE NOT is_final AND result<>'draw' AND winner_club_id<>club_id) AS losses,sum(score_for) FILTER(WHERE NOT is_final) AS points_for,sum(score_against) FILTER(WHERE NOT is_final) AS points_against,count(*) FILTER(WHERE is_finals_series) AS finals_played,bool_or(round_type='grand_final' AND winner_club_id=club_id) AS is_premier FROM sides GROUP BY club_id) SELECT jsonb_build_object('snapshot_utc',now() AT TIME ZONE 'UTC','club_expected',(SELECT jsonb_agg(to_jsonb(e) ORDER BY club_id) FROM expected e),'club_actual',(SELECT jsonb_agg(to_jsonb(c) ORDER BY club_id) FROM club_seasons c WHERE season=2026 AND club_id IN(6,16)),'edit94_rules',(SELECT jsonb_agg(pg_get_ruledef(oid)) FROM pg_rewrite WHERE ev_class='public.data_edits'::regclass),'audit_privileges',(SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT grantee,privilege_type FROM information_schema.table_privileges WHERE table_schema='public' AND table_name='data_edits' AND grantee IN('afldb_import','afldb_app','afldb_auth') ORDER BY grantee,privilege_type)p),'data_edit_constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public.data_edits'::regclass),'write_attempted',false)::text;
\else
\echo STOP_IDENTITY
\quit 3
\endif
ROLLBACK;
SQL
unset PGPASSWORD
echo READ_ONLY_AGGREGATE_METADATA_COMPLETED
