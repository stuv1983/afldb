set -eu
[ "$(hostname)" = afldb-prod ]
[ "$(id -un)" = arm ]
# Current owner instruction authorises no migration/deployment/apply work.
# Check known host processes and queued service work; print no command arguments.
# This is a bounded observation, not a global scheduler or future-DDL lock.
processes=$(sudo -n /usr/bin/ps -eo pid=,ppid=,comm=,args= | /usr/bin/awk -v self="$$" -v parent="$PPID" '
  $1 != self && $1 != parent && $3 != "awk" && $3 != "ps" && $3 != "sudo" &&
  /tools\/db\/migrate|db:migrate|rebuild-test|rehearsal-package|transition.*--apply|deploy[^ ]*\.(sh|ps1)|npm (run )?(build|start:prod)|rsync .*afldb/ { print $1, $3 }
')
if [ -n "$processes" ]; then
  printf 'I316_HOST_SCHEMA_WORK_DETECTED\n%s\n' "$processes"
  exit 1
fi
jobs=$(/usr/bin/systemctl list-jobs --no-legend --no-pager)
if printf '%s\n' "$jobs" | /usr/bin/awk '/afldb|postgres|deploy|migrat/ { found=1 } END { exit !found }'; then
  printf 'I316_HOST_SERVICE_WORK_DETECTED\n'
  exit 1
fi
printf 'I316_OPERATIONAL_HOST_GATE_PASS\n'
