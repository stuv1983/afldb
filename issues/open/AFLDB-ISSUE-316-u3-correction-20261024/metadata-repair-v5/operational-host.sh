{
# v5 operational host gate. Replaces v4's `sudo -n ps | awk` pipeline (F-006): no sudo, pipefail, and
# every producer's exit status is checked before its output is analysed. Derived from the passed
# replacement observation (operational-observation.sh), host checks only. Prints PIDs, users and
# reasons, never command arguments. Reads nothing from stdin: psql's stdin is the reviewed SQL.
set -u -o pipefail
export LC_ALL=C
hstop() { printf 'I316_OPERATIONAL_HOST_STOP %s\n' "$1"; exit 1; }

host=$(/usr/bin/hostname) || hstop host_producer_failed
user=$(/usr/bin/id -un) || hstop user_producer_failed
[ "$host" = afldb-prod ] || hstop host_mismatch
[ "$user" = arm ] || hstop user_mismatch

procopts=$(/usr/bin/awk '$2=="/proc" && $3=="proc" {print $4}' /proc/mounts) || hstop proc_mounts_unreadable
[ -n "$procopts" ] || hstop proc_mount_missing
case ",$procopts," in
  *,hidepid=1,*|*,hidepid=2,*|*,hidepid=noaccess,*|*,hidepid=invisible,*|*,hidepid=ptraceable,*|*,subset=pid,*)
    hstop proc_hidepid_restricts_visibility;;
esac

appsvc=$(/usr/bin/systemctl show afldb.service --property=ActiveState,SubState,MainPID --no-pager) || hstop systemctl_show_afldb_failed
app_active=$(printf '%s\n' "$appsvc" | /usr/bin/sed -n 's/^ActiveState=//p')
app_sub=$(printf '%s\n' "$appsvc" | /usr/bin/sed -n 's/^SubState=//p')
mainpid=$(printf '%s\n' "$appsvc" | /usr/bin/sed -n 's/^MainPID=//p')
[ "$app_active" = active ] && [ "$app_sub" = running ] || hstop afldb_service_not_active_running
case "$mainpid" in ''|0|*[!0-9]*) hstop afldb_mainpid_invalid;; esac

ps_out=$(/usr/bin/ps -eww -o pid=,ppid=,user:32=,stat=,lstart=,args=) || hstop ps_failed
[ -n "$ps_out" ] || hstop ps_empty
/usr/bin/awk -v self="$$" -v parent="$PPID" -v me="$user" -v mainpid="$mainpid" '
BEGIN { rows=0; bad=0; malformed=0; pid1=0; pgserver=0; pgtitles=0; foreign=0; app=0 }
{
  if (NF < 10 || $1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ || $9 !~ /^[0-9][0-9][0-9][0-9]$/ || ($1 in seen)) { malformed++; next }
  seen[$1]=1; rows++
  args=""; for (i=10; i<=NF; i++) args=args (i>10 ? " " : "") $i
  la=tolower(args)
  if ($1 == "1" && $3 == "root" && args !~ /^\[/) pid1=1
  if ($3 != me && args !~ /^\[/) foreign++
  if ($3 == "postgres" && (la ~ /(^|\/)postgres( |$)/ || la ~ /^postgres: /)) pgserver++
  if ($3 == "postgres" && la ~ /^postgres: /) pgtitles++
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
  if (r != "") { print "I316_OPERATIONAL_HOST_UNSAFE_PROCESS", $1, $3, r; bad++ }
}
END {
  print "I316_OPERATIONAL_HOST_PS rows=" rows " malformed=" malformed " pid1_root_args=" pid1 " foreign_args=" foreign " postgres_server=" pgserver " postgres_titles=" pgtitles " app_mainpid=" app " unsafe=" bad
  if (malformed) exit 2
  if (rows < 20 || !pid1 || foreign < 5 || pgserver < 1 || pgtitles < 1 || !app) exit 3
  if (bad) exit 1
  exit 0
}' <<<"$ps_out"
awk_rc=$?
case "$awk_rc" in
  0) ;;
  1) hstop unsafe_process_detected;;
  2) hstop ps_output_malformed;;
  3) hstop process_visibility_insufficient;;
  *) hstop process_analysis_failed;;
esac

jobs=$(/usr/bin/systemctl list-jobs --no-legend --no-pager) || hstop systemctl_list_jobs_failed
if /usr/bin/grep -Eiq 'afldb|postgres|deploy|migrat|rollover|schema|apply' <<<"$jobs"; then hstop systemd_relevant_job_queued; fi
trans=$(/usr/bin/systemctl list-units --type=service --state=activating,deactivating,reloading --plain --no-legend --no-pager) || hstop systemctl_list_units_failed
if /usr/bin/grep -Eiq 'afldb|postgres|deploy|migrat|rollover|schema|apply' <<<"$trans"; then hstop systemd_relevant_service_transitioning; fi
units=$(/usr/bin/systemctl show afldb-settle-afltables.service afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service afldb-email-intake.service --property=Id,ActiveState --no-pager) || hstop systemctl_show_jobs_failed
[ -n "$units" ] || hstop systemctl_show_jobs_empty
if /usr/bin/grep -Eq '^ActiveState=(active|activating|deactivating|reloading)$' <<<"$units"; then hstop afldb_data_job_unit_running; fi

R=/home/arm/projects/afldb
[ -d "$R/.git" ] || hstop deployed_checkout_git_dir_missing
for m in .git/index.lock .git/MERGE_HEAD .git/rebase-merge .git/rebase-apply .git/CHERRY_PICK_HEAD; do
  [ ! -e "$R/$m" ] || hstop deployed_checkout_git_operation_in_progress
done
printf 'I316_OPERATIONAL_HOST_GATE_PASS\n'
} </dev/null
