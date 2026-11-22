#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), runbook step (a): PRE-REBOOT verification. PRODUCTION (afldb-prod), as arm, ONE connection.
# READ-ONLY by construction: no sudo, no write of any kind (no temp file, no redirection into a file), no restart, no apt; one
# read-only database transaction through the backup role (ledger count and the afldb_restore_test catalog comment; no row data).
# Every check prints PASS / FAIL / INFO / NOTE; any FAIL = R6 PRE RESULT STOP = do not reboot (runbook section 7, GO/NO-GO).
# Command inventory (closure allowlist): hostname id date cat uname uptime dpkg-query stat ls sed grep awk sort cut head tail tr wc basename
#   sha256sum cmp findmnt sysctl apt-config systemctl(show|is-active|is-enabled|list-timers|list-unit-files) pgrep readlink git(rev-parse)
#   node deploy/release.mjs status | sh deploy/afldb-settle-failure-status.sh | bash tools/maintenance/scheduled-backup.sh status
#   psql (read-only shape of a2-p0-entry.sh) df free printf echo test; redirections only 2>&1, 2>/dev/null, here-strings, here-docs.
# Run (workstation Git Bash; never at minute :16-:18, when streamanator's r2 check connects):
#   tr -d '\r' < r6-pre-verify.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- \
#      <accepted|stopped|rolledback> <CURRENT_ID> <r3:yes|no> <r4:yes|no> [10:00|14:00]
#   arguments come from the Tue 24 Nov sitting record (runbook section 2, fill-in table); 14:00 = the fallback window.
# Prints, for later steps: BOOT_ID, INVOCATION_ID, GRUB-BASELINE <sha256>, OFFHOST-COMPARE <dump> <sha256>, RESTORE-SHA <sha256>.
# Dry run (streamanator only): R6_DRYRUN=1 skips the host check (refused on afldb-prod); production-only facts then FAIL, which is the
# expected dry-run outcome (it proves the script runs to its end and writes nothing).
main() {
set -uo pipefail; export LC_ALL=C
OUTC=${1:-}; CUR=${2:-}; R3=${3:-}; R4=${4:-}; WIN=${5:-10:00}
[[ $OUTC =~ ^(accepted|stopped|rolledback)$ ]] && [[ $R3 =~ ^r3:(yes|no)$ ]] && [[ $R4 =~ ^r4:(yes|no)$ ]] && [[ $WIN =~ ^(10:00|14:00)$ ]] \
  || { echo "STOP usage: <accepted|stopped|rolledback> <CURRENT_ID> <r3:yes|no> <r4:yes|no> [10:00|14:00]"; exit 2; }
case $OUTC in accepted) [[ $CUR =~ ^7d92042fd110-[A-Za-z0-9_-]{1,64}$ ]];; *) [ "$CUR" = c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC ];; esac \
  || { echo "STOP CURRENT_ID does not fit outcome $OUTC"; exit 2; }
F=0
ok()   { echo "PASS $*"; }
bad()  { echo "FAIL $*"; F=$((F+1)); }
info() { echo "INFO $*"; }
mel()  { TZ=Australia/Melbourne date -d "@$1" '+%a %F %H:%M:%S %Z'; }
ep()   { TZ=Australia/Melbourne date -d "$1" +%s; }
ts()   { local v; v=$(systemctl show --timestamp=unix -p "$2" --value "$1" 2>/dev/null); v=${v#@}; [[ $v =~ ^[0-9]+$ ]] && echo "$v" || echo 0; }
# Timer next elapse in epoch seconds (0 = none). `--timestamp=unix` does not apply to NextElapseUSecRealtime (dry run, run e),
# so it is read from `systemctl list-timers --all -o json` ("next" in microseconds; null for an inactive timer).
nxt()  { systemctl list-timers --all -o json --no-pager 2>/dev/null | tr '{' '\n' \
           | sed -n 's/.*"next":\([0-9][0-9]*\).*"unit":"\([^"]*\)".*/\2 \1/p' \
           | awk -v u="$1" '$1 == u { print int($2 / 1000000); f = 1 } END { if (!f) print 0 }'; }
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases
BK=/home/arm/backups/afldb-scheduled
DAY=$(TZ=Australia/Melbourne date +%F); TODAYC=$(TZ=Australia/Melbourne date +%Y%m%d)
echo "== R6 PRE $(date -u +%FT%TZ) local $(mel "$(date +%s)") host=$(hostname) user=$(id -un) outcome=$OUTC current=$CUR $R3 $R4 window=$DAY $WIN"
if [ "${R6_DRYRUN:-0}" = 1 ]; then [ "$(hostname)" != afldb-prod ] || { echo "STOP R6_DRYRUN is refused on afldb-prod"; exit 2; }; info "DRY RUN (not production)"
else [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP not arm@afldb-prod"; exit 2; }; fi
[ "$(TZ=Australia/Melbourne date +%a)" = Wed ] && ok "today is Wednesday ($DAY)" || bad "today is not Wednesday: the first-scheduled-run expectations do not apply; re-plan"
echo "BOOT_ID $(cat /proc/sys/kernel/random/boot_id)"

echo "-- 1. kernels and reboot state"
R=$(uname -r); [ "$R" = 6.8.0-137-generic ] && ok "running $R" || bad "running $R (expected 6.8.0-137-generic)"
info "up since $(uptime -s)"
IMG=$(dpkg-query -W -f '${db:Status-Abbrev}|${Package}|${Version}\n' 'linux-image-*' 2>/dev/null | awk -F'|' '$1 ~ /^ii/ {print $2"|"$3}' | sort)
printf '%s\n' "$IMG" | sed 's/^/     /'
GEN=$(printf '%s\n' "$IMG" | grep -E '^linux-image-[0-9]' | cut -d'|' -f1 | tr '\n' ' ')
[ "$GEN" = "linux-image-6.8.0-137-generic linux-image-6.8.0-149-generic " ] && ok "installed kernel images are exactly {137, 149}" \
  || bad "installed kernel images are '$GEN' (expected exactly 137 and 149): another kernel would change what boots; STOP, owner decision"
for f in /boot/vmlinuz-6.8.0-149-generic /boot/initrd.img-6.8.0-149-generic /boot/vmlinuz-6.8.0-137-generic /boot/initrd.img-6.8.0-137-generic; do
  [ -e "$f" ] && ok "present $f ($(stat -c '%s B, %y' "$f" | cut -c1-40))" || bad "missing $f"; done
[ -d /lib/modules/6.8.0-149-generic ] && [ -d /lib/modules/6.8.0-137-generic ] && ok "modules 149 and 137 present" || bad "a modules directory is missing"
[ -e /var/run/reboot-required ] && ok "reboot-required present (expected before the reboot)" || info "reboot-required absent"

echo "-- 2. boot facts for the GRUB decision (arm-readable part; grub.cfg itself is root-only: owner step C1)"
[ -d /sys/firmware/efi ] && info "firmware UEFI (/sys/firmware/efi present)" || info "firmware BIOS (no /sys/firmware/efi)"
dpkg-query -W -f '${db:Status-Abbrev} ${Package} ${Version}\n' 'grub-pc' 'grub-efi-amd64*' 'grub-common' 2>/dev/null | awk '$1 ~ /^ii/' | sed 's/^/     /'
info "root fs type $(findmnt -no FSTYPE /); /boot: $(findmnt -no FSTYPE /boot 2>/dev/null || echo 'on /'); root source kind $(findmnt -no SOURCE / | sed -E 's#^/dev/(mapper|md)/.*#LVM-or-MD#; s#^/dev/[a-z]+[0-9]*$#plain-partition#')"
ls -l /etc/default/grub /etc/default/grub.d/ /boot/grub/grubenv 2>&1 | sed 's/^/     /'
grep -hE '^[[:space:]]*GRUB_' /etc/default/grub /etc/default/grub.d/*.cfg 2>/dev/null | sed -E 's/(UUID=)[0-9a-fA-F-]+/\1<redacted>/g; s/^/     /'
GE=$(grep -v '^#' /boot/grub/grubenv 2>/dev/null | tr '\n' ' '); info "grubenv variables (non-padding lines): '${GE}'"
GB=$( { for f in /etc/default/grub /etc/default/grub.d/*.cfg; do [ -f "$f" ] && printf '%s %s\n' "$f" "$(sha256sum < "$f" | cut -d' ' -f1)"; done; } | sha256sum | cut -d' ' -f1)
{ for f in /etc/default/grub /etc/default/grub.d/*.cfg; do [ -f "$f" ] && printf '     %s %s\n' "$(sha256sum < "$f" | cut -c1-16)" "$f"; done; }
echo "GRUB-BASELINE $GB"
info "kernel.panic=$(sysctl -n kernel.panic 2>/dev/null) kernel.panic_on_oops=$(sysctl -n kernel.panic_on_oops 2>/dev/null)"
grep -v '^#' /etc/apt/apt.conf.d/01autoremove-kernels 2>/dev/null | sed 's/^/     autoremove-kernels: /'
apt-config dump 2>/dev/null | grep -iE 'Remove-Unused-Kernel-Packages|Automatic-Reboot' | sed 's/^/     /'

echo "-- 3. apt/dpkg idle and every timer (the owner re-runs the apt gate immediately before the reboot)"
for u in apt-daily.service apt-daily-upgrade.service; do s=$(systemctl is-active "$u" 2>/dev/null); [ "$s" != active ] && [ "$s" != activating ] && ok "$u $s" || bad "$u $s (wait; never reboot during apt)"; done
P=$( { pgrep -a -x 'dpkg|apt|apt-get' 2>/dev/null; pgrep -af '^/usr/bin/python3 /usr/bin/unattended-upgrade( |$)' 2>/dev/null; } | tr '\n' ';')
[ -z "$P" ] && ok "no apt/dpkg/unattended-upgrade process" || bad "package process running: $P"
systemctl list-unit-files 'afldb*' --no-pager --no-legend 2>/dev/null | sed 's/^/     unit-file: /'
W0=$(ep "$DAY $WIN"); WS=$((W0-900)); WE=$((W0+5400))
for t in $(systemctl list-timers --all --no-legend --plain 2>/dev/null | grep -oE '[A-Za-z0-9@_.-]+\.timer' | sort -u); do
  b=${t%.timer}; st=$(systemctl is-active "$t" 2>/dev/null); en=$(systemctl is-enabled "$t" 2>/dev/null)
  nx=$(nxt "$t"); act=$(systemctl show "$t" -p Triggers --value 2>/dev/null); sv=$(systemctl is-active "$act" 2>/dev/null)
  line="$t active=$st enabled=${en:-?} triggers=$act ($sv) next=$([ "$nx" -gt 0 ] && mel "$nx" || echo none)"
  case $b in afldb*|apt-daily*) w=writer;; *) w=system;; esac
  if [ "$w" = writer ] && { [ "$sv" = active ] || [ "$sv" = activating ]; }; then bad "$line (its service is running now)"
  elif [ "$w" = writer ] && [ "$nx" -ge "$WS" ] && [ "$nx" -le "$WE" ]; then bad "$line DUE INSIDE THE WINDOW (stop it in step D2 or reschedule)"
  elif [ "$nx" -ge "$WS" ] && [ "$nx" -le "$WE" ]; then info "$line (system timer due inside the window; harmless unless it holds dpkg)"
  else ok "$line"; fi
done

echo "-- 4. services and the release (outcome $OUTC)"
for u in postgresql@16-main afldb caddy; do [ "$(systemctl is-active "$u")" = active ] && ok "$u active" || bad "$u $(systemctl is-active "$u")"; done
echo "INVOCATION_ID $(systemctl show afldb -p InvocationID --value)"
systemctl show afldb -p NRestarts -p MainPID -p ActiveEnterTimestamp --no-pager | sed 's/^/     /'
MAIN=$(systemctl show afldb -p MainPID --value); NW=0; [[ $MAIN =~ ^[1-9][0-9]*$ ]] && NW=$(pgrep -P "$MAIN" | wc -l)
[ "$NW" = 2 ] && ok "exactly 2 worker processes" || bad "worker processes $NW (expected 2)"
if cd "$CHK" 2>/dev/null; then
  [ "$(readlink "$ROOT/current")" = "releases/$CUR" ] && ok "current = $CUR" || bad "current = $(readlink "$ROOT/current") (expected $CUR)"
  info "previous = $(readlink "$ROOT/previous"); checkout HEAD $(git rev-parse HEAD 2>/dev/null)"
  "$N" deploy/release.mjs status 2>&1 | sed 's/^/     /'; info "release.mjs status exit ${PIPESTATUS[0]}"
  U=$(grep -c '^AFLDB_REVALIDATE_URL=' .env 2>/dev/null); S=$(grep -c '^AFLDB_REVALIDATE_SECRET=' .env 2>/dev/null)
  if [ "$OUTC" = accepted ]; then [ "$U/$S" = 1/1 ] && ok "env counts 1/1" || bad "env counts $U/$S (accepted A1 left 1/1)"; else info "env counts $U/$S (outcome $OUTC: record)"; fi
  sh deploy/afldb-settle-failure-status.sh 2>&1 | sed 's/^/     /'; info "settle-failure-status rc ${PIPESTATUS[0]} (packet R6 prerequisite 5: recorded before the reboot)"
  CS=$(sha256sum < /etc/caddy/Caddyfile | cut -d' ' -f1)
  if [ "$R4" = r4:yes ]; then [ "$CS" = f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d ] && ok "Caddyfile = R4 f00859d5" || bad "Caddyfile $CS (r4:yes expects f00859d5)"
  else [ "$CS" = 4f6972ec119f5d33fff4c16cbbce15c50a36b883654dcffcabdb01776d7af036 ] && ok "Caddyfile = pre-R4 4f6972ec" || bad "Caddyfile $CS (r4:no expects 4f6972ec)"; fi
  cmp -s /etc/needrestart/conf.d/50-afldb-hold.conf deploy/host-policy/needrestart-afldb-hold.conf && cmp -s /etc/apt/apt.conf.d/52-afldb-unattended deploy/host-policy/apt-52-afldb-unattended.conf \
    && ok "R1 host policy installed (both files equal the repo)" || bad "R1 host policy not installed (packet R6 prerequisite 4)"
  [ -s /home/arm/a1-rawhead-baseline.json ] && ok "A1 raw-head baseline present (post-reboot raw-head check runs)" || info "no A1 raw-head baseline: the post-reboot raw-head check is skipped"
else bad "no checkout $CHK"; fi
[ -d /var/log/afldb-r5-prefix-retained-20261124 ] && info "R5 directory $(stat -c '%U:%G %a' /var/log/afldb-r5-prefix-retained-20261124)" || info "R5 directory absent"

echo "-- 5. first scheduled backup (Wed 02:20 unit) and restore check (Wed 03:30 unit)"
if [ "$R3" = r3:no ]; then
  echo "NOTE r3:no: no scheduled backup exists by design; NG-FALLBACK can then only be met by a completed snapshot"
else
  B0=$(ep "$DAY 02:20"); B1=$(ep "$DAY 02:31"); V0=$(ep "$DAY 03:30"); V1=$(ep "$DAY 03:41")
  bs=$(ts afldb-backup.service ExecMainStartTimestamp); br=$(systemctl show afldb-backup.service -p Result --value 2>/dev/null); bx=$(systemctl show afldb-backup.service -p ExecMainStatus --value 2>/dev/null)
  [ "$bs" -ge "$B0" ] && [ "$bs" -le "$B1" ] && [ "$br" = success ] && [ "$bx" = 0 ] && ok "afldb-backup.service scheduled run $(mel "$bs") Result=$br status=$bx" \
    || bad "afldb-backup.service last start $([ "$bs" -gt 0 ] && mel "$bs" || echo never) Result=$br status=$bx (expected today 02:20-02:31, success, 0)"
  vs=$(ts afldb-backup-verify.service ExecMainStartTimestamp); vr=$(systemctl show afldb-backup-verify.service -p Result --value 2>/dev/null); vx=$(systemctl show afldb-backup-verify.service -p ExecMainStatus --value 2>/dev/null)
  [ "$vs" -ge "$V0" ] && [ "$vs" -le "$V1" ] && [ "$vr" = success ] && [ "$vx" = 0 ] && ok "afldb-backup-verify.service scheduled run $(mel "$vs") Result=$vr status=$vx" \
    || bad "afldb-backup-verify.service last start $([ "$vs" -gt 0 ] && mel "$vs" || echo never) Result=$vr status=$vx (expected today 03:30-03:41, success, 0)"
  jf() { sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}[,}].*/\1/p" "$1" 2>/dev/null | head -1; }
  LV=$BK/.state/last-verify.json; ve=$(jf "$LV" epoch); vf=$(jf "$LV" file); vsha=$(jf "$LV" sha256); va=$(jf "$LV" attempts)
  info "last-verify.json: file=$vf sha256=$vsha attempts=$va"; info "last-backup.json: $(cat "$BK/.state/last-backup.json" 2>/dev/null)"
  # The 03:30 verify run takes its own fresh dump and rewrites last-backup.json, so the 02:20 dump is found by its name.
  SD=$(ls -1 "$BK"/afldb_prod-"$TODAYC"-02[23]*.dump 2>/dev/null | head -n 1)
  if [ -n "$SD" ]; then
    ok "scheduled 02:2x dump present: $(basename "$SD") $(stat -c %s "$SD") B"
    SS=$(cut -d' ' -f1 "$SD.sha256" 2>/dev/null); A=$(sha256sum < "$SD" | cut -d' ' -f1)
    [ -n "$SS" ] && [ "$A" = "$SS" ] && ok "02:2x dump re-hashed = its sidecar" || bad "02:2x dump hash $A != sidecar '$SS'"
    echo "OFFHOST-COMPARE $(basename "$SD") $SS"
  else bad "no afldb_prod-$TODAYC-02[23]*.dump in $BK"; fi
  [ -n "$ve" ] && [ "$ve" -ge "$V0" ] && ok "last-verify.json written by today's 03:30 run ($(mel "$ve"), attempts $va)" || bad "last-verify.json not from today's 03:30 run"
  [ "$va" = 1 ] || info "verify attempts=$va (2 = one benign retry; record it)"
  M=$(ls -1 "$BK"/.state/FAILED-* 2>/dev/null | tr '\n' ' '); [ -z "$M" ] && ok "no FAILED marker" || bad "FAILED marker(s): $M"
  (cd "$CHK" && AFLDB_BACKUP_DIR=$BK bash tools/maintenance/scheduled-backup.sh status) 2>&1 | sed 's/^/     /'; [ "${PIPESTATUS[0]}" = 0 ] && ok "scheduled-backup.sh status rc 0" || bad "scheduled-backup.sh status not 0"
  info "dumps held: $(ls -1 "$BK"/*.dump 2>/dev/null | wc -l)"
  RO=$( ( cd "$CHK" 2>/dev/null && set -a && . ./.env && set +a
    re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=${AFLDB_BACKUP_DATABASE_URL:-}; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
    printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
    PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=20000' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'ledger|'||count(*)||'|'||max(name) FROM afldb_meta.schema_migrations;
SELECT 'rt|'||d.datname||'|'||coalesce(shobj_description(d.oid,'pg_database'),'-')||'|'||coalesce(s.numbackends,0) FROM pg_database d LEFT JOIN pg_stat_database s ON s.datid = d.oid WHERE d.datname = 'afldb_restore_test';
ROLLBACK;
SQL
  ) 2>&1 )
  printf '%s\n' "$RO" | sed 's/^/     /'
  grep -qx 'ledger|118|118_fixtures_unconfirmed_participants.sql' <<< "$RO" && ok "ledger 118" || bad "ledger differs"
  [ -n "$vsha" ] && grep -qx "rt|afldb_restore_test|afldb.restore_test.v1 sha256=$vsha|0" <<< "$RO" && ok "afldb_restore_test proven by today's verify (comment sha = last-verify sha), numbackends 0" \
    || bad "afldb_restore_test comment or numbackends not as expected"
  echo "RESTORE-SHA ${vsha:-none}"
fi

echo "-- 6. capacity"
df -h / /boot 2>/dev/null | sed 's/^/     /'; free -m | sed 's/^/     /'
AV=$(df -Pm / | awk 'NR==2{print $4}'); [ "${AV:-0}" -ge 6144 ] && ok "root fs free ${AV} MB >= 6144" || bad "root fs free ${AV} MB < 6144"
echo; [ $F = 0 ] && echo "R6 PRE RESULT PASS" || { echo "R6 PRE RESULT STOP ($F FAIL line(s)): do not reboot; take them to the owner"; exit 1; }
}
main "$@" < /dev/null
