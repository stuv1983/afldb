{
# AFLDB-ISSUE-316 v4: replacement separate operational observation (owner instruction 2026-10-25).
# Runs as arm with NO sudo. Streamed to `bash -s`; writes nothing on the host. Fail closed:
# every producer's exit status is checked before its captured output is analysed.
# Prints no DSN, password or credential. Process arguments are emitted credential-redacted.
set -u -o pipefail
export LC_ALL=C
stop() { printf 'I316_OBS_STOP %s\n' "$1"; printf 'I316_OBS_DECISION=STOP\n'; exit 1; }

host=$(/usr/bin/hostname) || stop host_producer_failed
user=$(/usr/bin/id -un) || stop user_producer_failed
[ "$host" = afldb-prod ] || stop host_mismatch
[ "$user" = arm ] || stop user_mismatch
printf 'I316_OBS_HOST=%s USER=%s\n' "$host" "$user"
printf 'I316_OBS_SELF pid=%s ppid=%s\n' "$$" "$PPID"

# --- /proc visibility mode: hidepid would hide other users' processes from arm ---
procopts=$(/usr/bin/awk '$2=="/proc" && $3=="proc" {print $4}' /proc/mounts) || stop proc_mounts_unreadable
[ -n "$procopts" ] || stop proc_mount_missing
printf 'I316_OBS_PROC_MOUNT_OPTIONS %s\n' "$procopts"
case ",$procopts," in
  *,hidepid=1,*|*,hidepid=2,*|*,hidepid=noaccess,*|*,hidepid=invisible,*|*,hidepid=ptraceable,*|*,subset=pid,*)
    stop proc_hidepid_restricts_visibility;;
esac

# --- AFLDB application service (read-only systemctl show) ---
appsvc=$(/usr/bin/systemctl show afldb.service --property=LoadState,ActiveState,SubState,MainPID,ExecMainStartTimestamp --no-pager)
rc=$?; [ "$rc" -eq 0 ] || stop systemctl_show_afldb_failed
[ -n "$appsvc" ] || stop systemctl_show_afldb_empty
printf '%s\n' "$appsvc" | /usr/bin/sed 's/^/SYSTEMD_AFLDB /'
app_active=$(printf '%s\n' "$appsvc" | /usr/bin/sed -n 's/^ActiveState=//p')
app_sub=$(printf '%s\n' "$appsvc" | /usr/bin/sed -n 's/^SubState=//p')
mainpid=$(printf '%s\n' "$appsvc" | /usr/bin/sed -n 's/^MainPID=//p')
[ "$app_active" = active ] && [ "$app_sub" = running ] || stop afldb_service_not_active_running
case "$mainpid" in ''|0|*[!0-9]*) stop afldb_mainpid_invalid;; esac

# --- System-wide process inventory: producer first, analysis separately ---
ps_out=$(/usr/bin/ps -eww -o pid=,ppid=,user:32=,stat=,lstart=,args=)
ps_rc=$?
printf 'I316_OBS_PS_EXIT %s\n' "$ps_rc"
[ "$ps_rc" -eq 0 ] || stop ps_failed
[ -n "$ps_out" ] || stop ps_empty

/usr/bin/awk -v self="$$" -v parent="$PPID" -v me="$user" -v mainpid="$mainpid" '
BEGIN { rows=0; bad=0; malformed=0; pid1=0; pgserver=0; pgtitles=0; pgclient=0; foreign=0; app=0 }
{
  if (NF < 10 || $1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ || $9 !~ /^[0-9][0-9][0-9][0-9]$/ || ($1 in seen)) {
    malformed++; print "PS_MALFORMED_ROW", NR; next
  }
  seen[$1]=1; rows++
  args=""; red=""
  for (i=10; i<=NF; i++) {
    t=$i; args=args (i>10 ? " " : "") t; lt=tolower(t)
    if (lt ~ /:\/\/[^\/]*@/) t="<redacted-url>"
    else if (lt ~ /(pass|secret|token|pwd|apikey|api_key|credential|auth)[a-z_]*=/) sub(/=.*/, "=<redacted>", t)
    red=red (i>10 ? " " : "") t
  }
  la=tolower(args)
  print "PS", $1, $2, $3, $4, $5 " " $6 " " $7 " " $8 " " $9, red
  if ($1 == "1" && $3 == "root" && args !~ /^\[/) pid1=1
  if ($3 != me && args !~ /^\[/) foreign++
  if ($3 == "postgres" && (la ~ /(^|\/)postgres( |$)/ || la ~ /^postgres: /)) pgserver++
  if ($3 == "postgres" && la ~ /^postgres: /) pgtitles++
  if ($3 == "postgres" && la ~ /^postgres: .* afldb_prod /) pgclient++
  if ($1 == mainpid && la ~ /server-cluster\.mjs/) app=1
  if ($1 == self || $2 == self || $1 == parent) next
  r=""
  if (la ~ /tools\/db\/|db:migrate|(^|[\/ ])migrate(\.[a-z]+)?( |$)|migrations\/[^ ]*\.sql/) r="afldb_migration_tooling"
  else if (la ~ /tools\/(migration|aflw|email_intake|maintenance)\//) r="afldb_data_or_maintenance_job"
  else if (la ~ /deploy\/[^ ]*\.(sh|ps1)|afldb-settle|sync-dev/) r="afldb_deploy_or_settle_job"
  else if (la ~ /--apply|rollover|successor|rehearsal-package|promotion-(freeze|check)|prove-reset|rebuild-test|afl-api-identity|season-rekey/) r="apply_rollover_promotion_tooling"
  else if (la ~ /next build|npm (ci|install|i|run build|run deploy)( |$)|(^|\/)git (pull|fetch|checkout|reset|switch|merge|rebase|clone|stash)|rsync .*afldb|(^|\/)scp .*(afldb| -t)/) r="deployment_release"
  else if (la ~ /(^|\/)psql / && (la ~ / (-f|--file)[ =]?[^ ]*migrat/ || la ~ / (-c|--command)[ =]?.*(create|alter|drop|truncate|reindex|grant|revoke|refresh|comment on|vacuum)/)) r="psql_ddl_or_migration"
  else if (la ~ /(^|\/)(pg_restore|pg_upgrade|pg_upgradecluster|createdb|dropdb|pg_dropcluster|pg_createcluster)( |$)|(^|\/)pg_ctl(cluster)? .*(stop|restart|promote)/) r="postgres_admin_write"
  else if (la ~ /i316|metadata-repair|issue-316|issue316/) r="issue316_execution"
  else if ($3 == "postgres" && la ~ /^postgres: / && la !~ /autovacuum|walsender|checkpointer|background writer|walwriter|logical replication|archiver|startup|io worker/ && la ~ / (create|alter|drop|truncate|reindex|cluster|grant|revoke|comment|refresh|security label|lock table|vacuum|do)( |$)/) r="postgres_backend_ddl"
  else if ($3 == "postgres" && la ~ /^postgres: / && la ~ / idle in transaction/) r="postgres_backend_idle_in_transaction"
  else if (la ~ /(^|\/)(apt|apt-get|aptitude) (install|upgrade|full-upgrade|dist-upgrade|remove|purge)|(^|\/)dpkg (-i|--install|--configure|--unpack|--remove|--purge|-r|-p)( |$)|(^|\/)unattended-upgrade( |$)/) r="package_maintenance"
  if (r != "") { print "UNSAFE_PROCESS", $1, $3, r; bad++ }
}
END {
  print "PS_ROWS", rows; print "PS_MALFORMED", malformed; print "PS_PID1_ROOT_ARGS_VISIBLE", pid1
  print "PS_FOREIGN_USER_ARGS_VISIBLE", foreign; print "PS_POSTGRES_SERVER_ROWS", pgserver
  print "PS_POSTGRES_TITLE_ROWS", pgtitles; print "PS_POSTGRES_AFLDB_PROD_CLIENT_TITLES", pgclient
  print "PS_AFLDB_MAINPID_VISIBLE", app; print "UNSAFE_PROCESSES", bad
  if (malformed) exit 2
  if (rows < 20 || !pid1 || foreign < 5 || pgserver < 1 || pgtitles < 1 || !app) exit 3
  if (bad) exit 1
  exit 0
}' <<<"$ps_out"
awk_rc=$?
case "$awk_rc" in
  0) printf 'I316_OBS_PROCESS_GATE=PASS\n';;
  1) stop unsafe_process_detected;;
  2) stop ps_output_malformed;;
  3) stop process_visibility_insufficient;;
  *) stop process_analysis_failed;;
esac

# --- Queued/transitioning systemd work and AFLDB job units (read-only) ---
jobs=$(/usr/bin/systemctl list-jobs --no-legend --no-pager)
rc=$?; [ "$rc" -eq 0 ] || stop systemctl_list_jobs_failed
printf '%s\n' "$jobs" | /usr/bin/awk 'NF {print "SYSTEMD_JOB", $0}'
if /usr/bin/grep -Eiq 'afldb|postgres|deploy|migrat|rollover|schema|apply' <<<"$jobs"; then stop systemd_relevant_job_queued; fi
printf 'SYSTEMD_RELEVANT_JOBS_CLEAR\n'

trans=$(/usr/bin/systemctl list-units --type=service --state=activating,deactivating,reloading --plain --no-legend --no-pager)
rc=$?; [ "$rc" -eq 0 ] || stop systemctl_list_units_failed
printf '%s\n' "$trans" | /usr/bin/awk 'NF {print "TRANSITIONING_SERVICE", $0}'
if /usr/bin/grep -Eiq 'afldb|postgres|deploy|migrat|rollover|schema|apply' <<<"$trans"; then stop systemd_relevant_service_transitioning; fi
printf 'SYSTEMD_RELEVANT_TRANSITIONS_CLEAR\n'

units=$(/usr/bin/systemctl show afldb-settle-afltables.service afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service afldb-email-intake.service --property=Id,LoadState,ActiveState,SubState --no-pager)
rc=$?; [ "$rc" -eq 0 ] || stop systemctl_show_jobs_failed
[ -n "$units" ] || stop systemctl_show_jobs_empty
printf '%s\n' "$units" | /usr/bin/awk 'NF {print "SYSTEMD_AFLDB_JOB_UNIT", $0}'
if /usr/bin/grep -Eq '^ActiveState=(active|activating|deactivating|reloading)$' <<<"$units"; then stop afldb_data_job_unit_running; fi
printf 'SYSTEMD_AFLDB_JOB_UNITS_IDLE\n'

timers=$(/usr/bin/systemctl list-timers --all --no-legend --no-pager)
rc=$?; [ "$rc" -eq 0 ] || stop systemctl_list_timers_failed
printf '%s\n' "$timers" | /usr/bin/awk 'tolower($0) ~ /afldb/ {print "SYSTEMD_AFLDB_TIMER", $0}'
printf 'I316_OBS_SERVICE_GATE=PASS\n'

# --- Documented deployment markers: an in-progress Git operation on the deployed checkout ---
R=/home/arm/projects/afldb
[ -d "$R/.git" ] || stop deployed_checkout_git_dir_missing
for m in .git/index.lock .git/MERGE_HEAD .git/rebase-merge .git/rebase-apply .git/CHERRY_PICK_HEAD; do
  if [ -e "$R/$m" ]; then printf 'DEPLOY_MARKER_PRESENT %s\n' "$m"; stop deployed_checkout_git_operation_in_progress; fi
done
printf 'I316_OBS_DEPLOY_MARKERS_CLEAR\n'

# --- Database-side observation via the existing read-only afldb_backup connection ---
ENVF="$R/.env"
[ -r "$ENVF" ] || stop env_file_unreadable
DSN=$(/usr/bin/sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$ENVF" | /usr/bin/tail -1 | /usr/bin/sed 's/^"\(.*\)"$/\1/') || stop dsn_read_failed
[ -n "$DSN" ] || stop dsn_empty
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
PGUSER=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\2#")
PGHOST=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\5#")
PGPORT=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\7#"); [ -n "$PGPORT" ] || PGPORT=5432
PGDATABASE=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\8#")
PWENC=$(printf '%s' "$DSN" | /usr/bin/sed -E "s#$RE#\4#")
PGPASSWORD=$(printf '%b' "${PWENC//%/\\x}"); unset PWENC DSN
[ "$PGDATABASE" = afldb_prod ] && [ "$PGUSER" = afldb_backup ] || { unset PGPASSWORD; stop credential_not_afldb_backup_at_afldb_prod; }
printf 'I316_OBS_DB_CONNECTION user=%s database=%s\n' "$PGUSER" "$PGDATABASE"
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=60000'
export PGAPPNAME=afldb-i316-operational-observation-v2 PGCONNECT_TIMEOUT=10

db_out=$(/usr/bin/psql -X -q -At -P pager=off -v ON_ERROR_STOP=1 -f - <<'I316_OBS_SQL'
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL timezone='UTC';
DO $identity$
BEGIN
 IF current_database() <> 'afldb_prod' OR current_user <> 'afldb_backup' OR session_user <> 'afldb_backup'
 OR (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) <> 66668
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7674454702926115004'
 OR current_setting('transaction_read_only') <> 'on'
 THEN RAISE EXCEPTION 'I316 production identity refused'; END IF;
END $identity$;
WITH me AS (
  SELECT pg_catalog.pg_backend_pid() AS pid, (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AS dboid),
priv AS (
  SELECT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AS superuser,
         pg_catalog.pg_has_role(current_user,'pg_read_all_stats','USAGE') AS read_all_stats,
         current_setting('update_process_title') AS update_process_title),
act AS (
  SELECT a.pid, a.datname, a.usename, a.application_name, a.backend_type, a.state,
    (a.query IS NOT NULL AND a.query <> '<insufficient privilege>') AS query_visible,
    COALESCE(a.state='active' AND a.query ~* '^\s*(create|alter|drop|truncate|reindex|cluster|vacuum|grant|revoke|comment\s+on|security\s+label|refresh|lock|do)\M',false) AS ddl,
    COALESCE(a.state IN ('idle in transaction','idle in transaction (aborted)'),false) AS idle_in_xact,
    COALESCE(a.application_name,'') ~* '(migrat|deploy|rebuild|schema|rollover|transition|apply|successor|freeze|settle|rehearsal|i316|metadata-repair|afldb-(issue|correct|promotion|reset))' AS tooling_app
  FROM pg_catalog.pg_stat_activity a CROSS JOIN me
  WHERE a.pid <> me.pid AND COALESCE(a.backend_type,'client backend') = 'client backend'),
lk AS (
  SELECT l.pid, l.mode, l.granted, COALESCE(a.backend_type,'unknown') AS backend_type
  FROM pg_catalog.pg_locks l CROSS JOIN me LEFT JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid
  WHERE l.database=me.dboid AND l.pid IS DISTINCT FROM me.pid AND l.locktype='relation'
    AND l.mode IN ('AccessExclusiveLock','ExclusiveLock','ShareRowExclusiveLock','ShareUpdateExclusiveLock','ShareLock')),
obs AS (
  SELECT
    (SELECT superuser FROM priv) AS superuser,
    (SELECT read_all_stats FROM priv) AS read_all_stats,
    (SELECT update_process_title FROM priv) AS update_process_title,
    (SELECT count(*) FROM act) AS client_sessions_all_databases,
    (SELECT count(*) FROM act WHERE datname=current_database()) AS client_sessions,
    (SELECT count(*) FROM act WHERE datname=current_database() AND NOT query_visible) AS sessions_query_redacted,
    (SELECT count(*) FROM act WHERE datname=current_database() AND ddl) AS ddl_sessions,
    (SELECT count(*) FROM act WHERE datname=current_database() AND idle_in_xact) AS idle_in_transaction_sessions,
    (SELECT count(*) FROM act WHERE datname=current_database() AND tooling_app) AS tooling_application_sessions,
    (SELECT count(*) FROM lk WHERE backend_type <> 'autovacuum worker') AS schema_class_relation_locks,
    (SELECT count(*) FROM lk WHERE backend_type = 'autovacuum worker') AS autovacuum_relation_locks,
    (SELECT count(*) FROM pg_catalog.pg_prepared_xacts WHERE database=current_database()) AS prepared_transactions,
    (SELECT count(*) FROM pg_catalog.pg_stat_progress_create_index p CROSS JOIN me WHERE p.datid=me.dboid) AS progress_create_index,
    (SELECT count(*) FROM pg_catalog.pg_stat_progress_cluster p CROSS JOIN me WHERE p.datid=me.dboid) AS progress_cluster,
    (SELECT count(*) FROM pg_catalog.pg_stat_progress_copy p CROSS JOIN me WHERE p.datid=me.dboid AND p.type IS DISTINCT FROM 'COPY TO') AS progress_copy_not_to,
    (SELECT count(*) FROM pg_catalog.pg_stat_progress_vacuum p CROSS JOIN me LEFT JOIN pg_catalog.pg_stat_activity a ON a.pid=p.pid
      WHERE p.datid=me.dboid AND COALESCE(a.backend_type,'unknown') <> 'autovacuum worker') AS progress_manual_vacuum,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('usename',usename,'application_name',application_name,'state',state,'query_visible',query_visible,'sessions',n) ORDER BY usename,application_name,state),'[]'::jsonb)
       FROM (SELECT usename, application_name, state, query_visible, count(*) AS n FROM act WHERE datname=current_database()
             GROUP BY usename, application_name, state, query_visible) g) AS session_summary)
SELECT 'I316_OBS_DB_IDENTITY=' || jsonb_build_object('database',current_database(),'user',current_user,
  'oid',(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()),
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'read_only',current_setting('transaction_read_only'),'server_version_num',current_setting('server_version_num'),
  'observed_utc',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
UNION ALL
SELECT 'I316_OBS_DB=' || to_jsonb(obs)::text FROM obs
UNION ALL
SELECT 'I316_OBS_DB_GATE=' || CASE
  WHEN ddl_sessions + idle_in_transaction_sessions + tooling_application_sessions + schema_class_relation_locks
     + prepared_transactions + progress_create_index + progress_cluster + progress_copy_not_to + progress_manual_vacuum > 0
    THEN 'STOP_ACTIVITY_DETECTED'
  WHEN NOT (superuser OR read_all_stats) AND update_process_title <> 'on'
    THEN 'STOP_VISIBILITY_INADEQUATE'
  ELSE 'PASS' END FROM obs;
ROLLBACK;
I316_OBS_SQL
)
db_rc=$?
unset PGPASSWORD
printf '%s\n' "$db_out"
printf 'I316_OBS_DB_EXIT %s\n' "$db_rc"
[ "$db_rc" -eq 0 ] || stop database_observation_failed
gate=$(printf '%s\n' "$db_out" | /usr/bin/sed -n 's/^I316_OBS_DB_GATE=//p')
[ "$gate" = PASS ] || stop "database_gate_${gate:-missing}"
# Query text redaction is tolerated only because host-side PostgreSQL process titles were proven visible above.
printf 'I316_OBS_DECISION=PASS\n'
exit 0
}
