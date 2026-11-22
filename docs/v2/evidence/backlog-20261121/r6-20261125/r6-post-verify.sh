#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), runbook steps (f) and (g): POST-REBOOT verification (also after a rollback boot into 137).
# PRODUCTION (afldb-prod), as arm, ONE connection per run. READ-ONLY by construction: no sudo, no write of any kind, no restart;
# `release.mjs status` WITHOUT --expect (the --expect form, and post-install-check.sh, append to events.log: they are the separate,
# named acceptance step A3 of the runbook); one read-only database transaction through the backup role (ledger count, the
# afldb_restore_test catalog comment, the postmaster start time; no row data); one loopback GET of /api/health.
# Command inventory (closure allowlist): hostname id date cat uname uptime awk sed grep tr cut sort wc head tail sha256sum stat ls
#   systemctl(show|is-active|is-enabled|--failed) journalctl(-b read forms) pgrep pg_isready readlink curl(GET) df printf echo test
#   node deploy/release.mjs status | sh deploy/afldb-settle-failure-status.sh | bash tools/maintenance/scheduled-backup.sh status
#   psql (read-only shape of a2-p0-entry.sh); redirections only 2>&1, 2>/dev/null, here-strings, here-docs.
# Modes (workstation Git Bash; only after the public HTTPS smoke answers, runbook E3; never at minute :16-:18):
#   full: tr -d '\r' < r6-post-verify.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- full \
#           <KERNEL> <CURRENT_ID> <PRE_BOOT_ID> <PRE_INVOCATION_ID> <RESTORE_SHA|none> <r4:yes|no> <GRUB_BASELINE>
#   grub: ... bash -s -- grub <GRUB_BASELINE>      (after the owner's GRUB restore, step F5: arm-readable GRUB state = baseline)
#   <KERNEL> 6.8.0-149-generic (after the reboot) or 6.8.0-137-generic (after a rollback); the other values are printed by
#   r6-pre-verify.sh (BOOT_ID, INVOCATION_ID, RESTORE-SHA, GRUB-BASELINE). In `full`, a GRUB state different from the baseline is
#   reported as NOTE (expected while the chosen GRUB option is still applied); `grub` mode FAILs on any difference.
# Dry run: R6_DRYRUN=1 on a non-production host (refused on afldb-prod); production-only facts then FAIL (expected).
check_revalidation_processes() { # primary PID, immutable release directory; fixture proc root only in direct unit tests
  local main=$1 release=$2 proc=${3:-/proc} p u s un sn cwd ordinal seen=' ' workers
  [[ $main =~ ^[1-9][0-9]*$ ]] || return 1
  workers=$(pgrep -P "$main" || true)
  [ "$(wc -w <<< "$workers")" = 2 ] || { echo 'FAIL expected both release workers'; return 1; }
  for p in $main $workers; do
    [ -r "$proc/$p/environ" ] || return 1
    cwd=$(readlink "$proc/$p/cwd") || return 1
    if [ "$p" = "$main" ]; then
      [ "$cwd" = "$release" ] || return 1
      echo "primary pid=$p"
    else
      [ "$cwd" = "$release" ] || [ "$cwd" = "$release/.next/standalone" ] || return 1
      ordinal=$(tr '\0' '\n' < "$proc/$p/environ" | sed -n 's/^AFLDB_WORKER_ID=//p')
      [[ $ordinal =~ ^[12]$ && $seen != *" $ordinal "* ]] || return 1
      seen="$seen$ordinal "
      echo "worker=$ordinal pid=$p parent=$main"
    fi
    u=$(tr '\0' '\n' < "$proc/$p/environ" | grep -c '^AFLDB_REVALIDATE_URL=' || true)
    s=$(tr '\0' '\n' < "$proc/$p/environ" | grep -c '^AFLDB_REVALIDATE_SECRET=' || true)
    un=$(tr '\0' '\n' < "$proc/$p/environ" | grep -c '^AFLDB_REVALIDATE_URL=[^[:space:]]' || true)
    sn=$(tr '\0' '\n' < "$proc/$p/environ" | grep -c '^AFLDB_REVALIDATE_SECRET=[^[:space:]]' || true)
    echo "pid=$p URL count=$u nonempty=$un SECRET count=$s nonempty=$sn"
    [ "$u/$s/$un/$sn" = 1/1/1/1 ] || return 1
  done
}
main() {
set -uo pipefail; export LC_ALL=C
MODE=${1:-}
F=0
ok()   { echo "PASS $*"; }
bad()  { echo "FAIL $*"; F=$((F+1)); }
info() { echo "INFO $*"; }
mel()  { TZ=Australia/Melbourne date -d "@$1" '+%a %F %H:%M:%S %Z'; }
ts()   { local v; v=$(systemctl show --timestamp=unix -p "$2" --value "$1" 2>/dev/null); v=${v#@}; [[ $v =~ ^[0-9]+$ ]] && echo "$v" || echo 0; }
# Timer next elapse in epoch seconds (0 = none), from `systemctl list-timers --all -o json` (see r6-pre-verify.sh).
nxt()  { systemctl list-timers --all -o json --no-pager 2>/dev/null | tr '{' '\n' \
           | sed -n 's/.*"next":\([0-9][0-9]*\).*"unit":"\([^"]*\)".*/\2 \1/p' \
           | awk -v u="$1" '$1 == u { print int($2 / 1000000); f = 1 } END { if (!f) print 0 }'; }
gstate() { { for f in /etc/default/grub /etc/default/grub.d/*.cfg; do [ -f "$f" ] && printf '%s %s\n' "$f" "$(sha256sum < "$f" | cut -d' ' -f1)"; done; } | sha256sum | cut -d' ' -f1; }
guard() {
  if [ "${R6_DRYRUN:-0}" = 1 ]; then [ "$(hostname)" != afldb-prod ] || { echo "STOP R6_DRYRUN is refused on afldb-prod"; exit 2; }; info "DRY RUN (not production)"
  else [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP not arm@afldb-prod"; exit 2; }; fi; }
grubcheck() { # <baseline> <strict:1|0>
  local g; g=$(gstate)
  { for f in /etc/default/grub /etc/default/grub.d/*.cfg; do [ -f "$f" ] && printf '     %s %s\n' "$(sha256sum < "$f" | cut -c1-16)" "$f"; done; }
  local ge; ge=$(grep -v '^#' /boot/grub/grubenv 2>/dev/null | tr '\n' ' ')
  info "grubenv variables (non-padding lines): '${ge}'"
  if [ "$g" = "$1" ]; then ok "GRUB inputs equal the pre-R6 baseline ($g)"
  elif [ "$2" = 1 ]; then bad "GRUB inputs $g differ from the pre-R6 baseline $1 (a drop-in is still present or a file changed)"
  else echo "NOTE GRUB inputs $g differ from the baseline $1 (expected while the chosen option is applied; the grub mode must PASS after F5)"; fi
  if [ "$2" = 1 ]; then grep -qE '^(next_entry|saved_entry)=' /boot/grub/grubenv 2>/dev/null && bad "grubenv still carries next_entry/saved_entry" || ok "grubenv has no next_entry/saved_entry (arm view)"; fi
}
case $MODE in
grub)
  GB=${2:-}; [[ $GB =~ ^[0-9a-f]{64}$ ]] || { echo "STOP usage: grub <GRUB_BASELINE>"; exit 2; }
  echo "== R6 POST grub $(date -u +%FT%TZ) host=$(hostname) running $(uname -r)"; guard
  grubcheck "$GB" 1
  echo; [ $F = 0 ] && echo "R6 GRUB RESULT PASS (arm-readable GRUB state = pre-R6 baseline; the owner's sudo grub.cfg checks of F5 complete it)" || { echo "R6 GRUB RESULT FAIL ($F)"; exit 1; }
  ;;
full)
  K=${2:-}; CUR=${3:-}; PB=${4:-}; PI=${5:-}; RS=${6:-}; R4=${7:-}; GB=${8:-}
  [[ $K =~ ^6\.8\.0-(149|137)-generic$ ]] && [[ $CUR =~ ^(7d92042fd110-[A-Za-z0-9_-]{1,64}|c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC)$ ]] \
    && [[ $PB =~ ^[0-9a-f-]{36}$ ]] && [[ $PI =~ ^[0-9a-f]{32}$ ]] && [[ $RS =~ ^([0-9a-f]{64}|none)$ ]] && [[ $R4 =~ ^r4:(yes|no)$ ]] && [[ $GB =~ ^[0-9a-f]{64}$ ]] \
    || { echo "STOP usage: full <KERNEL> <CURRENT_ID> <PRE_BOOT_ID> <PRE_INVOCATION_ID> <RESTORE_SHA|none> <r4:yes|no> <GRUB_BASELINE>"; exit 2; }
  N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; BK=/home/arm/backups/afldb-scheduled; NOW=$(date +%s)
  echo "== R6 POST full $(date -u +%FT%TZ) local $(mel "$NOW") host=$(hostname) user=$(id -un) expect kernel=$K"; guard
  echo "-- 1. kernel and boot"
  [ "$(uname -r)" = "$K" ] && ok "running $(uname -r)" || bad "running $(uname -r) (expected $K)"
  BID=$(cat /proc/sys/kernel/random/boot_id); [ "$BID" != "$PB" ] && ok "new boot_id $BID" || bad "boot_id unchanged: the host did not reboot"
  UP=$(awk '{print int($1)}' /proc/uptime); info "up since $(uptime -s) ($((UP/60)) min)"; [ "$UP" -lt 7200 ] && ok "uptime < 2 h" || bad "uptime ${UP}s >= 2 h"
  if [ "$K" = 6.8.0-149-generic ]; then [ ! -e /var/run/reboot-required ] && ok "reboot-required absent" || bad "reboot-required still present: $(tr '\n' ' ' < /var/run/reboot-required.pkgs 2>/dev/null)"
  else info "reboot-required $( [ -e /var/run/reboot-required ] && echo present || echo absent) (after a rollback to 137 it is expected to be present)"; fi
  info "kernel cmdline: $(sed -E 's/(UUID=)[0-9a-fA-F-]+/\1<redacted>/g' /proc/cmdline)"; info "taint $(cat /proc/sys/kernel/tainted)"
  echo "-- 2. PostgreSQL, the application and Caddy"
  for u in postgresql@16-main afldb caddy; do [ "$(systemctl is-active "$u")" = active ] && ok "$u active" || bad "$u $(systemctl is-active "$u")"; done
  pg_isready -q -h /var/run/postgresql -p 5432; R=$?; [ $R = 0 ] && ok "pg_isready" || bad "pg_isready exit $R"
  INV=$(systemctl show afldb -p InvocationID --value); NR=$(systemctl show afldb -p NRestarts --value)
  [ "$INV" != "$PI" ] && ok "afldb InvocationID new: $INV (the owner attests it as the R6 boot for acceptance step A3)" || bad "afldb InvocationID unchanged"
  echo "INVOCATION_ID $INV"
  [ "$NR" = 0 ] && ok "afldb NRestarts 0" || bad "afldb NRestarts $NR (restart loop after boot?)"
  info "afldb active since $(systemctl show afldb -p ActiveEnterTimestamp --value)"
  MAIN=$(systemctl show afldb -p MainPID --value); NW=0; PIDS=''
  if [[ $MAIN =~ ^[1-9][0-9]*$ ]]; then NW=$(pgrep -P "$MAIN" | wc -l); PIDS="$MAIN $(pgrep -P "$MAIN" | tr '\n' ' ')"; fi
  [ "$NW" = 2 ] && ok "exactly 2 worker processes" || bad "worker processes $NW (expected 2)"
  check_revalidation_processes "$MAIN" "$ROOT/releases/$CUR" && ok 'revalidation configured 1/1 in primary and both release workers' || bad 'revalidation process identity or nonempty 1/1 configuration failed'
  if cd "$CHK" 2>/dev/null; then
    [ "$(readlink "$ROOT/current")" = "releases/$CUR" ] && ok "current = $CUR (unchanged by the reboot)" || bad "current = $(readlink "$ROOT/current")"
    "$N" deploy/release.mjs status 2>&1 | sed 's/^/     /'; info "release.mjs status exit ${PIPESTATUS[0]} (a restart note is expected after a reboot)"
    CS=$(sha256sum < /etc/caddy/Caddyfile | cut -d' ' -f1)
    if [ "$R4" = r4:yes ]; then [ "$CS" = f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d ] && ok "Caddyfile f00859d5 unchanged" || bad "Caddyfile $CS"
    else [ "$CS" = 4f6972ec119f5d33fff4c16cbbce15c50a36b883654dcffcabdb01776d7af036 ] && ok "Caddyfile 4f6972ec unchanged" || bad "Caddyfile $CS"; fi
    P=$(sed -n 's/^PORT=//p' .env | tail -1 | tr -d '"'); P=${P:-3100}
    H=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$P/api/health"); [ "$H" = 200 ] && ok "loopback /api/health 200" || bad "loopback /api/health $H"
    sh deploy/afldb-settle-failure-status.sh 2>&1 | sed 's/^/     /'; info "settle-failure-status rc ${PIPESTATUS[0]} (compare with the pre-reboot record; the timer must be active again)"
    if [ "$RS" != none ]; then (AFLDB_BACKUP_DIR=$BK bash tools/maintenance/scheduled-backup.sh status) 2>&1 | sed 's/^/     /'; [ "${PIPESTATUS[0]}" = 0 ] && ok "scheduled-backup.sh status rc 0" || bad "scheduled-backup.sh status not 0"; fi
  else bad "no checkout $CHK"; fi
  echo "-- 3. timers (active, enabled, next due sane)"
  tchk() { local n st en; n=$(nxt "$1"); st=$(systemctl is-active "$1"); en=$(systemctl is-enabled "$1" 2>/dev/null)
    if [ "$st" = active ] && [ "$en" = enabled ] && [ "$n" -gt "$NOW" ] && [ "$n" -le $((NOW + $2*3600)) ]; then ok "$1 active, enabled, next $(mel "$n")"
    else bad "$1 active=$st enabled=$en next=$([ "$n" -gt 0 ] && mel "$n" || echo none) (expected within $2 h)"; fi; }
  tchk afldb-settle-afl-api.timer 24
  if [ "$RS" != none ]; then tchk afldb-backup.timer 24; tchk afldb-backup-verify.timer 192; fi
  tchk apt-daily.timer 24; tchk apt-daily-upgrade.timer 24
  systemctl list-timers --all --no-pager 2>/dev/null | sed 's/^/     /'
  FL=$(systemctl --failed --no-legend --plain 2>/dev/null); [ -z "$FL" ] && ok "no failed units" || bad "failed units: $FL"
  echo "-- 4. journal since boot (arm may not read the system journal; the owner's sudo count of step F3 then decides)"
  if [ "$(journalctl -b -q --no-pager -n 1 2>/dev/null | wc -l)" -gt 0 ]; then info "journal err lines since boot (arm view): $(journalctl -b -p err -q --no-pager 2>/dev/null | wc -l)"
  else info "journal unreadable as arm: owner step F3 counts it"; fi
  echo "-- 5. database, restore target, GRUB, disk"
  RO=$( ( cd "$CHK" 2>/dev/null && set -a && . ./.env && set +a
    re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=${AFLDB_BACKUP_DATABASE_URL:-}; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
    printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
    PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=20000' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'ledger|'||count(*)||'|'||max(name) FROM afldb_meta.schema_migrations;
SELECT 'rt|'||d.datname||'|'||coalesce(shobj_description(d.oid,'pg_database'),'-')||'|'||coalesce(s.numbackends,0) FROM pg_database d LEFT JOIN pg_stat_database s ON s.datid = d.oid WHERE d.datname = 'afldb_restore_test';
SELECT 'pgstart|'||to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
ROLLBACK;
SQL
  ) 2>&1 )
  printf '%s\n' "$RO" | sed 's/^/     /'
  grep -qx 'ledger|118|118_fixtures_unconfirmed_participants.sql' <<< "$RO" && ok "ledger 118" || bad "ledger differs"
  if [ "$RS" != none ]; then grep -qx "rt|afldb_restore_test|afldb.restore_test.v1 sha256=$RS|0" <<< "$RO" && ok "afldb_restore_test present, comment unchanged, numbackends 0" || bad "afldb_restore_test differs from the pre-reboot record"
  else grep -qE '^rt\|afldb_restore_test\|' <<< "$RO" && ok "afldb_restore_test present" || bad "afldb_restore_test missing"; fi
  grubcheck "$GB" 0
  df -h / 2>/dev/null | sed 's/^/     /'; AV=$(df -Pm / | awk 'NR==2{print $4}'); [ "${AV:-0}" -ge 6144 ] && ok "root fs free ${AV} MB" || bad "root fs free ${AV} MB < 6144"
  echo; [ $F = 0 ] && echo "R6 POST RESULT PASS ($K)" || { echo "R6 POST RESULT FAIL ($F): see the FAIL lines; runbook section 8 decides (application rollback vs kernel rollback)"; exit 1; }
  ;;
*) echo "STOP usage: full ... | grub <GRUB_BASELINE>"; exit 2;;
esac
}
main "$@" < /dev/null
