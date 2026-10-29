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
WITH canonical_only AS MATERIALIZED (
 SELECT p.id,p.player_id,p.match_id,p.club_id,m.match_key
 FROM player_match_stats p JOIN matches m ON m.id=p.match_id
 WHERE m.season=2026 AND NOT EXISTS (SELECT 1 FROM staging.afltables_player_match a
 WHERE a.season=2026 AND a.match_key=m.match_key AND a.player_id=p.player_id AND a.club_id=p.club_id)
), afltables_only AS MATERIALIZED (
 SELECT a.player_id,a.club_id,a.match_key FROM staging.afltables_player_match a
 WHERE a.season=2026 AND NOT EXISTS (SELECT 1 FROM player_match_stats p JOIN matches m ON m.id=p.match_id
 WHERE m.season=2026 AND m.match_key=a.match_key AND p.player_id=a.player_id AND p.club_id=a.club_id)
)
SELECT jsonb_build_object(
 'snapshot',jsonb_build_object('utc',now() AT TIME ZONE 'UTC','database',current_database(),'user',current_user,
 'oid',(SELECT oid FROM pg_database WHERE datname=current_database()),'system_id',(SELECT system_identifier::text FROM pg_control_system()),
 'read_only',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation')),
 'target_rows',(SELECT count(*) FROM player_match_stats WHERE id=705437),
 'target_key_rows',(SELECT count(*) FROM player_match_stats WHERE player_id=2121 AND match_id=17214),
 'counts',jsonb_build_object(
 'pms_total',(SELECT count(*) FROM player_match_stats),
 'pms_2026',(SELECT count(*) FROM player_match_stats p JOIN matches m ON m.id=p.match_id WHERE m.season=2026),
 'afltables_2026',(SELECT count(*) FROM staging.afltables_player_match WHERE season=2026),
 'essendon_match17214',(SELECT count(*) FROM player_match_stats WHERE match_id=17214 AND club_id=6)),
 'canonical_only',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM canonical_only c),'[]'::jsonb),
 'afltables_only',COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM afltables_only a),'[]'::jsonb),
 'fingerprints',jsonb_build_object(
 'pms_ids_excluding_target',(SELECT md5(string_agg(id::text,',' ORDER BY id)) FROM player_match_stats WHERE id<>705437),
 'pms_2026_excluding_target',(SELECT md5(string_agg(to_jsonb(p)::text,E'\n' ORDER BY p.id)) FROM player_match_stats p JOIN matches m ON m.id=p.match_id WHERE m.season=2026 AND p.id<>705437),
 'matches_2026',(SELECT md5(string_agg(to_jsonb(m)::text,E'\n' ORDER BY m.id)) FROM matches m WHERE season=2026),
 'application20834',(SELECT md5(to_jsonb(ca)::text) FROM canonical_applications ca WHERE id=20834)),
 'match17214',(SELECT to_jsonb(m) FROM matches m WHERE id=17214),
 'authority',COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM data_overrides o
 WHERE entity_type='player_match_stats' AND starts_with(entity_key,'2026|4|2026-03-28|Essendon|North Melbourne|')),'[]'::jsonb),
 'edits',COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM (SELECT * FROM data_edits
 WHERE table_name='matches' AND row_id=17214 AND field_group='match_sheet' ORDER BY id DESC LIMIT 5) d),'[]'::jsonb),
 'target_derived',jsonb_build_object(
 'career',(SELECT to_jsonb(d) FROM player_career_stats d WHERE player_id=2121),
 'season',(SELECT to_jsonb(d) FROM player_season_stats d WHERE player_id=2121 AND season=2026),
 'club_season',COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM player_club_season_stats d WHERE player_id=2121 AND season=2026),'[]'::jsonb),
 'clubs',COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM player_clubs d WHERE player_id=2121),'[]'::jsonb)),
 'write_attempted',false
)::text;
\else
\echo 'STOP: database identity or read-only gate failed'
\quit 3
\endif
ROLLBACK;
SQL
unset PGPASSWORD
echo READ_ONLY_CORRECTION_POSTCHECK_COMPLETED
