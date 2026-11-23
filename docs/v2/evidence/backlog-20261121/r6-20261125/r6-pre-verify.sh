#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), runbook step (a): PRE-REBOOT verification. PRODUCTION (afldb-prod), as arm, ONE connection.
# READ-ONLY by construction: no sudo, no write of any kind (no temp file, no redirection into a file), no restart, no apt; one
# read-only database transaction through the backup role (ledger count and the afldb_restore_test catalog comment; no row data).
# Every check prints PASS / FAIL / INFO / NOTE; any FAIL = R6 PRE RESULT STOP = do not reboot (runbook section 7, GO/NO-GO).
# Command inventory (closure allowlist): hostname id date cat uname uptime dpkg-query stat ls sed grep awk sort cut head tail tr wc basename
#   sha256sum cmp findmnt sysctl apt-config systemctl(show|is-active|is-enabled|list-timers|list-unit-files) pgrep readlink git(rev-parse)
#   journalctl (backup and verification units, bounded time windows, cat/JSON output; read-only)
#   node deploy/release.mjs status | sh deploy/afldb-settle-failure-status.sh | bash tools/maintenance/scheduled-backup.sh status
#   psql (read-only shape of a2-p0-entry.sh) df free printf echo test; redirections only 2>&1, 2>/dev/null, here-strings, here-docs.
# Run (workstation Git Bash; never at minute :16-:18, when streamanator's r2 check connects):
#   tr -d '\r' < r6-pre-verify.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- \
#      <accepted|stopped|rolledback> <CURRENT_ID> <r3:yes|no> <r4:yes|no> [10:00|14:00]
#   arguments come from the Tue 24 Nov sitting record (runbook section 2, fill-in table); 14:00 = the fallback window.
# Prints, for later steps: BOOT_ID, INVOCATION_ID, GRUB-BASELINE <sha256>, OFFHOST-COMPARE <dump> <sha256>, RESTORE-SHA <sha256>.
# Dry run (streamanator only): R6_DRYRUN=1 skips the host check (refused on afldb-prod); production-only facts then FAIL, which is the
# expected dry-run outcome (it proves the script runs to its end and writes nothing).
# ISSUE-352 (independent review, 22 Nov 2026): the scheduled overnight dump is chosen WITHOUT first-match guessing. Prints
# "<basename> <full sidecar sha256>" and returns 0 only when exactly ONE 02:2x/02:3x dump of that day exists, its re-hash equals its
# one-line sidecar, and the afldb-backup.service journal text (3rd argument) reports exactly one "backup ok: <that basename> ...
# sha256 <the first 16 hex of the sidecar>". Anything else prints "REASON ..." and returns 1. Read-only: glob, sha256sum, sed.
pick_overnight_dump() { # backup-dir yyyymmdd service-journal-text
  local bk=$1 day=$2 jl=$3 f sd name ss a; local -a sds jb
  shopt -s nullglob; sds=("$bk"/afldb_prod-"$day"-02[23]*.dump); shopt -u nullglob
  [ "${#sds[@]}" -ge 1 ] || { echo "REASON no afldb_prod-$day-02[23]*.dump in $bk"; return 1; }
  [ "${#sds[@]}" -eq 1 ] || { echo "REASON ambiguous: ${#sds[@]} dumps in the 02:2x/02:3x window ($(printf '%s ' "${sds[@]##*/}")): refusing to choose one"; return 1; }
  sd=${sds[0]}; name=${sd##*/}
  [ -f "$sd.sha256" ] && [ "$(wc -l < "$sd.sha256")" = 1 ] || { echo "REASON $name has no one-line sidecar"; return 1; }
  ss=$(cut -d' ' -f1 "$sd.sha256"); a=$(sha256sum < "$sd" | cut -d' ' -f1)
  [[ $ss =~ ^[0-9a-f]{64}$ ]] && [ "$a" = "$ss" ] || { echo "REASON $name re-hash $a != sidecar '$ss'"; return 1; }
  awk -v h="$ss" -v n="$name" 'NF==2 && $1==h {sub(/^\*/, "", $2); if ($2==n) good=1} END {exit !(NR==1 && good)}' "$sd.sha256" \
    || { echo "REASON checksum sidecar does not name $name"; return 1; }
  mapfile -t jb < <(sed -n 's/.*scheduled-backup: backup ok: \([^ ]*\) [0-9]* bytes sha256 \([0-9a-f]*\).*/\1 \2/p' <<< "$jl")
  [ "${#jb[@]}" -eq 1 ] || { echo "REASON the afldb-backup.service journal reports ${#jb[@]} 'backup ok' lines (need exactly 1): dump attribution unproven"; return 1; }
  [ "${jb[0]%% *}" = "$name" ] && [ "${jb[0]#* }" = "${ss:0:16}" ] || { echo "REASON the service reported '${jb[0]}', not $name sha256 ${ss:0:16}: the same-window file is not the service's dump"; return 1; }
  echo "$name $ss"
}

# Accept only the scheduled service's unique completion, and reject a
# last-verify record subsequently replaced by a manual restore.
match_restore() { # backup-dir YYYYMMDD start exit journal state-epoch state-file state-sha attempts
  local bk=$1 day=$2 start=$3 end=$4 journal=$5 epoch=$6 file=$7 digest=$8 attempts=$9
  local invocation timestamp restored count actual
  [[ $journal != *$'\n'* ]] || return 1
  read -r invocation timestamp restored count <<< "$journal"
  [[ $invocation =~ ^[0-9a-f]{32}$ && $timestamp =~ ^[0-9]{10}$ && $epoch =~ ^[0-9]{10}$ &&
     $file =~ ^afldb_prod-${day}-03[0-5][0-9][0-5][0-9]\.dump$ && $digest =~ ^[0-9a-f]{64}$ &&
     $attempts =~ ^[12]$ && $file = "$restored" && $attempts = "$count" ]] || return 1
  (( start <= epoch && epoch <= timestamp && timestamp <= end && timestamp - epoch <= 10 )) || return 1
  actual=$(sha256sum < "$bk/$file") || return 1
  [[ ${actual%% *} = "$digest" ]] || return 1
  printf '%s %s %s %s\n' "$invocation" "$timestamp" "$file" "$digest"
}

restore_journal() {
  journalctl -u afldb-backup-verify.service --since "@$1" --until "@$(($2 + 1))" -o json --no-pager |
    "$3" -e '
      const readline = require("node:readline");
      readline.createInterface({ input: process.stdin }).on("line", (line) => {
        const entry = JSON.parse(line);
        const ok = /^\S+ scheduled-backup: verify ok: (\S+) restored and proven \(attempt ([12])\)$/.exec(entry.MESSAGE);
        if (ok && entry._SYSTEMD_UNIT === "afldb-backup-verify.service") {
          console.log(entry._SYSTEMD_INVOCATION_ID, Math.floor(Number(entry.__REALTIME_TIMESTAMP) / 1e6), ok[1], ok[2]);
        }
      });'
}

ts() {
  local value
  value=$(TZ=UTC systemctl show --timestamp=unix -p "$2" --value "$1" 2>/dev/null)
  # LastTriggerUSec ignores --timestamp on the host's systemd. Render it in
  # UTC to keep GNU date independent of the host's AEDT/AEST abbreviation.
  date -u -d "${value:-invalid}" +%s 2>/dev/null || echo 0
}

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
[ "$DAY" = 2026-11-25 ] && ok "today is Wednesday ($DAY)" || bad "today is not the scheduled Wednesday (2026-11-25); re-plan"
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
  bad "r3:no: Wednesday requires its own scheduled backup, off-host copy and restore verification"
else
  B0=$(ep "$DAY 02:20"); B1=$(ep "$DAY 02:31"); V0=$(ep "$DAY 03:30"); V1=$(ep "$DAY 03:41")
  bs=$(ts afldb-backup.service ExecMainStartTimestamp); br=$(systemctl show afldb-backup.service -p Result --value 2>/dev/null); bx=$(systemctl show afldb-backup.service -p ExecMainStatus --value 2>/dev/null)
  [ "$bs" -ge "$B0" ] && [ "$bs" -le "$B1" ] && [ "$br" = success ] && [ "$bx" = 0 ] && ok "afldb-backup.service scheduled run $(mel "$bs") Result=$br status=$bx" \
    || bad "afldb-backup.service last start $([ "$bs" -gt 0 ] && mel "$bs" || echo never) Result=$br status=$bx (expected today 02:20-02:31, success, 0)"
  vs=$(ts afldb-backup-verify.service ExecMainStartTimestamp); vr=$(systemctl show afldb-backup-verify.service -p Result --value 2>/dev/null); vx=$(systemctl show afldb-backup-verify.service -p ExecMainStatus --value 2>/dev/null)
  vf_end=$(ts afldb-backup-verify.service ExecMainExitTimestamp)
  vt=$(ts afldb-backup-verify.timer LastTriggerUSec)
  vf_window=$((V1 + 3600))
  restore_service_ok=0
  if (( V0 <= vt && vt <= vs && vs <= V1 && vs - vt <= 5 && vs <= vf_end && vf_end <= vf_window )) &&
      [ "$vr" = success ] && [ "$vx" = 0 ]; then
    ok "afldb-backup-verify.service scheduled run $(mel "$vs") Result=$vr status=$vx"
    restore_service_ok=1
  else bad "restore service lacks a matching timer dispatch, start and successful completion in the Wednesday window"; fi
  jf() { sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}[,}].*/\1/p" "$1" 2>/dev/null | head -1; }
  LV=$BK/.state/last-verify.json; ve=$(jf "$LV" epoch); vf=$(jf "$LV" file); vsha=$(jf "$LV" sha256); va=$(jf "$LV" attempts)
  info "last-verify.json: file=$vf sha256=$vsha attempts=$va"; info "last-backup.json: $(cat "$BK/.state/last-backup.json" 2>/dev/null)"
  # The 03:30 verify run takes its own fresh dump and rewrites last-backup.json, so the 02:20 dump is found by its name.
  SJ=$(journalctl -u afldb-backup.service --since "@$B0" --until "@$((B1 + 900))" -o cat --no-pager 2>/dev/null)
  if PICK=$(pick_overnight_dump "$BK" "$TODAYC" "$SJ"); then
    SDN=${PICK%% *}; SS=${PICK#* }
    ok "scheduled 02:2x dump is unique, equals the afldb-backup.service journal's own dump, re-hash = its sidecar: $SDN $(stat -c %s "$BK/$SDN") B"
    echo "OFFHOST-COMPARE $SDN $SS"
  else bad "scheduled 02:2x dump not attributable: ${PICK#REASON }"; fi
  RESTORE=
  if [ "$restore_service_ok" = 1 ] && VJ=$(restore_journal "$vs" "$vf_end" "$N") &&
      RESTORE=$(match_restore "$BK" "$TODAYC" "$vs" "$vf_end" "$VJ" "$ve" "$vf" "$vsha" "$va"); then
    ok "restore journal invocation, completion, dump, state and rehash agree (attempts $va)"
  else bad "last-verify.json and restored dump do not match the scheduled service invocation"; fi
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
  if [ -n "$RESTORE" ] && grep -Fxq "rt|afldb_restore_test|afldb.restore_test.v1 sha256=$vsha|0" <<< "$RO"; then
    ok "afldb_restore_test comment matches the scheduled restore dump, numbackends 0"
    echo "RESTORE-EVIDENCE $RESTORE"
    echo "RESTORE-SHA $vsha"
  else bad "afldb_restore_test lacks the scheduled restore digest or has active connections"; fi
fi

echo "-- 6. capacity"
df -h / /boot 2>/dev/null | sed 's/^/     /'; free -m | sed 's/^/     /'
AV=$(df -Pm / | awk 'NR==2{print $4}'); [ "${AV:-0}" -ge 6144 ] && ok "root fs free ${AV} MB >= 6144" || bad "root fs free ${AV} MB < 6144"
echo; [ $F = 0 ] && echo "R6 PRE RESULT PASS" || { echo "R6 PRE RESULT STOP ($F FAIL line(s)): do not reboot; take them to the owner"; exit 1; }
}
main "$@" < /dev/null
