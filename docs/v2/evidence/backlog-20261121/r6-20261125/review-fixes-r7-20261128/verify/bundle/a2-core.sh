#!/usr/bin/bash
# a2-core.sh (R6 r7, MED-2): R6 A-2 PRE-REBOOT verification run by the VERIFIER (uid afldb-verify), never by arm. ROOT-OWNED, pinned
# by SHA256SUMS; started only by afldb-verify-dispatch (`a2 <seven arguments> <nonce>`). Port of the WHOLE
# docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh (589 lines, 28 Nov): every check is kept, in the same order, with the
# same PASS/FAIL/INFO wording where the fact is the same. READ-ONLY: no file is created, changed or removed; one read-only database
# transaction (peer role afldb_verify); loopback GETs to the application (as release.mjs status made them).
# Substitutions (DESIGN 5.3; README "A-2 substitutions" lists what each trusts):
#   S1 node deploy/release.mjs status        -> serving_release: the same facts, computed here: `current`/`previous` links and their
#                                              release.json (arm data, root facts reader), the MainPID's cwd (kernel, root facts
#                                              reader, CAP_SYS_PTRACE), loopback GETs /api/health and both _buildManifest.js
#                                              (afldb-verify-py, python3.12 -I -S), events.log's last status-pass (arm data)
#   S2 grep .env (AFLDB_REVALIDATE_*)        -> counts from the root facts reader (never the values; arm data)
#   S3 sh deploy/afldb-settle-failure-status.sh -> the pinned bundle copy (byte-identical to the 17822b29 deploy/ file), run by dash
#   S4 cmp /etc/... deploy/host-policy/...   -> sha256 of the /etc files against digests PINNED below (the repo files at 2d772fe4)
#   S5 git rev-parse HEAD                    -> .git/HEAD and the ref read as files by the root facts reader (no git binary; INFO)
#   S6 scheduled_backup_run + pick_overnight_dump (journal via ~/.nvm node, /home/arm/backups) -> sealed_origin (DESIGN 3.5)
#   S7 restore_journal through ~/.nvm node   -> afldb-verify-py journal-restore (journald's trusted fields; group systemd-journal)
#   S8 last-verify.json, last-backup.json, FAILED-*, the restored dump's sha256 in /home/arm/backups/afldb-scheduled (0700 arm)
#                                            -> the root facts reader (arm-produced evidence: the weekly restore runs as arm)
#   S9 bash tools/maintenance/scheduled-backup.sh status -> backup_status below: the same rules; nightly freshness from the SEALED
#                                              state (root), restore freshness and markers from arm's .state (arm-produced)
#   S10 psql with .env's AFLDB_BACKUP_DATABASE_URL -> psql (/usr/lib/postgresql/16/bin/psql) as peer-mapped role afldb_verify
#   S11 `cd $CHK` / readlink / [ -s a1 baseline ] -> the root facts reader (arm paths are not traversable by afldb-verify)
#   R6_DRYRUN is gone: the verifier passes no environment through; the rehearsal runs it in a disposable afldb-prod container.
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin
VB=/usr/local/lib/afldb-verify
. "$VB/lib.sh"; . "$VB/sealed-origin.sh"
PSQL=/usr/lib/postgresql/16/bin/psql
# S4 pins: sha256 of deploy/host-policy/needrestart-afldb-hold.conf and deploy/host-policy/apt-52-afldb-unattended.conf at 2d772fe4.
PIN_NEEDRESTART=183691d90ff3777ce199b8d3d154c812532aad6be4c195f324cc3141b506350e
PIN_APT52=4a277b8b6e7c7c8b8d2cb347f8949260941327cd24dbd5f3664b317611648810

# Accept only the scheduled service's unique completion, and reject a last-verify record subsequently replaced by a manual restore.
# r7: the restored dump's sha256 is the root facts reader's (argument 10: "<file> <sha256>"), not a read of arm's directory.
match_restore() { # day start exit journal state-epoch state-file state-sha attempts root-facts-hash
  local day=$1 start=$2 end=$3 journal=$4 epoch=$5 file=$6 digest=$7 attempts=$8 actual=$9
  local invocation timestamp restored count
  [[ $journal != *$'\n'* ]] || return 1
  read -r invocation timestamp restored count <<< "$journal"
  [[ $invocation =~ ^[0-9a-f]{32}$ && $timestamp =~ ^[0-9]{10}$ && $epoch =~ ^[0-9]{10}$ &&
     $file =~ ^afldb_prod-${day}-03[0-5][0-9][0-5][0-9]\.dump$ && $digest =~ ^[0-9a-f]{64}$ &&
     $attempts =~ ^[12]$ && $file = "$restored" && $attempts = "$count" ]] || return 1
  (( start <= epoch && epoch <= timestamp && timestamp <= end && timestamp - epoch <= 10 )) || return 1
  [[ $actual = "$file $digest" ]] || return 1
  printf '%s %s %s %s\n' "$invocation" "$timestamp" "$file" "$digest"
}

# R6 r4: ONE read of a unit's InvocationID, validated before anything uses or prints it (verbatim).
read_invocation() { # unit
  local v rc
  RI_ID=; RI_WHY=
  v=$(systemctl show "$1" -p InvocationID --value 2>&1); rc=$?
  if [ "$rc" != 0 ]; then RI_WHY="systemctl show $1 failed (exit $rc)"
  elif [ -z "$v" ]; then RI_WHY="the live InvocationID is empty"
  elif ! [[ $v =~ ^[0-9a-f]{32}$ ]]; then RI_WHY="the live InvocationID '$(printf '%s' "$v" | tr -c '[:alnum:]' '?' | cut -c1-80)' is malformed"
  else RI_ID=$v; fi
  [ -n "$RI_ID" ]
}

# R6 r3/r4: the live InvocationID against the owner-attested one (verbatim).
attested_invocation() { # attested-id
  AI_ID=; AI_WHY=
  if ! read_invocation afldb; then AI_WHY=$RI_WHY
  elif [ "$RI_ID" != "$1" ]; then AI_WHY="live InvocationID $RI_ID != owner-attested $1 (a restart nobody attested, or the wrong record)"
  else AI_ID=$RI_ID; fi
  [ -n "$AI_ID" ]
}

# S1: the facts `release.mjs status` (no --expect) establishes, computed by the verifier. Prints a transcript in release.mjs's shape
# ("release: ..." lines), then applies r6's predicate to THAT transcript: exactly one result line, "release: STATUS PASS <CURRENT_ID>",
# no carriage return, no "restarted since the last attested PASS" note. RF must hold the `rootfacts a2` answer. Sets SR_WHY.
serving_release() { # current-id
  local want=$1 cur= prev= t p=() out=() rc n j pid cwd base
  SR_WHY=
  t=${RF[current_link]:-}; [[ $t =~ ^releases/([0-9a-f]{12}-[A-Za-z0-9_-]{1,64})$ ]] && cur=${BASH_REMATCH[1]}
  t=${RF[previous_link]:-}; [[ $t =~ ^releases/([0-9a-f]{12}-[A-Za-z0-9_-]{1,64})$ ]] && prev=${BASH_REMATCH[1]}
  [ -n "$cur" ] || p+=("no current release (current -> '$(san "${RF[current_link]:-}${RF[current_link_error]:-}" 120)')")
  [ -z "$cur" ] || [ "${RF[cur_json_id]:-}" = "$cur" ] || p+=("releases/$cur/release.json names '$(san "${RF[cur_json_id]:-unreadable}" 80)'")
  [ -z "$prev" ] || [ "${RF[prev_json_id]:-}" = "$prev" ] || p+=("releases/$prev/release.json names '$(san "${RF[prev_json_id]:-unreadable}" 80)'")
  out+=("release: current  ${cur:-(none)}${cur:+ revision $(san "${RF[cur_revision]:-?}" 64) BUILD_ID $(san "${RF[cur_buildid]:-?}" 80) $(san "${RF[cur_env]:-?}" 40)}")
  out+=("release: previous ${prev:-(none)}${prev:+ revision $(san "${RF[prev_revision]:-?}" 64) BUILD_ID $(san "${RF[prev_buildid]:-?}" 80)}")
  if [ -n "$cur" ]; then
    pid=$(systemctl show -p MainPID --value afldb 2>/dev/null)
    if ! [[ $pid =~ ^[1-9][0-9]*$ ]]; then p+=("afldb has no MainPID (not running)")
    elif [ "$pid" != "${RF[afldb_mainpid]:-}" ]; then p+=("MainPID $pid changed while it was read (root facts: ${RF[afldb_mainpid]:-?})")
    else
      cwd=${RF[afldb_main_cwd]:-}
      out+=("release: process  $pid runs in $(san "${cwd:-?}" 200)")
      [ -n "$cwd" ] && [ "$cwd" = "${RF[current_realpath]:-}" ] || p+=("process $pid runs in $(san "${cwd:-?}" 200), not $(san "${RF[current_realpath]:-?}" 200) (restart pending?)")
    fi
    base=http://127.0.0.1:3100
    j=$(timeout -k 5 40 "$PY" -I -S "$VPY" http "$base/api/health" 2>&1); rc=$?
    out+=("release: health   $(san "$j" 200)")
    [ "$rc" = 0 ] && [[ $j =~ ^200\ status=ok\ database=ok( |$) ]] || p+=("health not ok")
    if [[ ${RF[cur_buildid]:-} =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
      j=$(timeout -k 5 40 "$PY" -I -S "$VPY" http "$base/_next/static/${RF[cur_buildid]}/_buildManifest.js" 2>&1)
      out+=("release: build    /_next/static/${RF[cur_buildid]}/_buildManifest.js $(san "$j" 60)"); [[ $j == "200 "* ]] || p+=("current BUILD_ID manifest answered $(san "$j" 40)")
    else p+=("current BUILD_ID unreadable"); fi
    if [ -n "$prev" ] && [ "${RF[prev_buildid]:-}" != "${RF[cur_buildid]:-}" ]; then
      if [[ ${RF[prev_buildid]:-} =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
        j=$(timeout -k 5 40 "$PY" -I -S "$VPY" http "$base/_next/static/${RF[prev_buildid]}/_buildManifest.js" 2>&1)
        out+=("release: build    /_next/static/${RF[prev_buildid]}/_buildManifest.js $(san "$j" 60) (previous; expect 404)"); [[ $j == "404 "* ]] || p+=("previous BUILD_ID manifest answered $(san "$j" 40)")
      else p+=("previous BUILD_ID unreadable"); fi
    fi
    out+=("release: activation service InvocationID $(systemctl show afldb -p InvocationID --value 2>/dev/null) NRestarts $(systemctl show afldb -p NRestarts --value 2>/dev/null)")
    j=${RF[events_last_pass_invocation]:-none}; n=$(systemctl show afldb -p InvocationID --value 2>/dev/null)
    [[ $j =~ ^[0-9a-f]{32}$ ]] && [ "$j" != "$n" ] && out+=("release: note: the service restarted since the last attested PASS (InvocationID $j -> $n); compare with your maintenance log: this was not a restart you attested")
  fi
  for t in "${p[@]}"; do out+=("release: FAIL $(san "$t" 300)"); done
  [ "${#p[@]}" = 0 ] && out+=("release: STATUS PASS $cur") || out+=("release: STATUS FAIL")
  printf '%s\n' "${out[@]}" | sed 's/^/     /'
  t=$(printf '%s\n' "${out[@]}")
  [[ $t != *$'\r'* ]] || SR_WHY="$SR_WHY; the output contains a carriage return"
  n=$(grep -cE 'STATUS (PASS|FAIL)' <<< "$t"); [ "$n" = 1 ] || SR_WHY="$SR_WHY; $n result lines (need exactly 1)"
  grep -Fxq "release: STATUS PASS $want" <<< "$t" || SR_WHY="$SR_WHY; no line 'release: STATUS PASS $want'"
  ! grep -Fq 'restarted since the last attested PASS' <<< "$t" || SR_WHY="$SR_WHY; the service restarted since the last attested PASS"
  SR_WHY=${SR_WHY#; }
  [ -z "$SR_WHY" ]
}

ts() {
  local value
  value=$(TZ=UTC systemctl show --timestamp=unix -p "$2" --value "$1" 2>/dev/null)
  date -u -d "${value:-invalid}" +%s 2>/dev/null || echo 0
}

# S9: the rules of `scheduled-backup.sh status` (AFLDB_BACKUP_MAX_AGE_HOURS 30, AFLDB_VERIFY_MAX_AGE_HOURS 216): last backup and
# last verification recent, no FAILED-backup/-verify/-unit marker, last off-host copy not failed. Prints "STATUS ..." lines; rc 0/1.
backup_status() { # sealed-last-backup-json arm-last-verify-json
  local now rc=0 e age f
  now=$(date +%s)
  fieldof() { sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}[,}].*/\1/p" <<< "$1" | head -1; }
  for f in "backup|$1|30|sealed state /var/lib/afldb-backup/state/last-backup.json (root)" "restore verification|$2|216|/home/arm/backups/afldb-scheduled/.state/last-verify.json (arm-produced)"; do
    IFS='|' read -r label json max where <<< "$f"
    if [ -z "$json" ]; then echo "STATUS FAIL $label: never recorded ($where absent)"; rc=1; continue; fi
    e=$(fieldof "$json" epoch); [[ $e =~ ^[0-9]{1,12}$ ]] || e=0; age=$(( (now - e) / 3600 ))
    if [ "$e" = 0 ] || [ "$age" -gt "$max" ]; then echo "STATUS FAIL $label: last success ${age}h ago (limit ${max}h; $where)"; rc=1
    else echo "STATUS ok   $label: $(san "$(fieldof "$json" file)" 80) ${age}h ago ($where)"; fi
  done
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case ${f%% *} in FAILED-backup|FAILED-verify) echo "STATUS FAIL a run failed: $(san "$f" 200) (arm .state)"; rc=1;;
      FAILED-unit) echo "STATUS FAIL the failure unit fired at $(san "${f#* }" 120) (arm .state)"; rc=1;; esac
  done <<< "${RF[failed_marker]:-}"
  for f in "$1" "${RF[state_last_backup]:-}"; do [[ $f == *'"offhost":"failed"'* ]] && { echo "STATUS FAIL the last off-host copy failed"; rc=1; }; done
  return "$rc"
}

main() {
set -uo pipefail; export LC_ALL=C
OUTC=${1:-}; CUR=${2:-}; R3=${3:-}; R4=${4:-}; WIN=${5:-}; TUE=${6:-}; INVA=${7:-}
[ "$#" = 7 ] && [ "$OUTC" = accepted ] && [[ $R3 =~ ^r3:(yes|no)$ ]] && [[ $R4 =~ ^r4:(yes|no)$ ]] && [[ $WIN =~ ^(10:00|14:00)$ ]] \
  && [[ $TUE =~ ^tue:(released|rolledback|deferred)$ ]] && [[ $INVA =~ ^inv:[0-9a-f]{32}$ ]] \
  || { echo "STOP usage: accepted <CURRENT_ID> <r3:yes|no> <r4:yes|no> <10:00|14:00> <tue:released|tue:rolledback|tue:deferred> <inv:32-hex>"; exit 2; }
ATT=${INVA#inv:}; OLD_ID=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; SUNDAY_INV=342040625f6d4012a35d598dfbf9afe6
case $TUE in
  tue:released)   [[ $CUR =~ ^17822b29e6de-[A-Za-z0-9_-]{1,64}$ ]] && [ "$ATT" != "$SUNDAY_INV" ];;
  tue:rolledback) [ "$CUR" = "$OLD_ID" ] && [ "$ATT" != "$SUNDAY_INV" ];;
  tue:deferred)   [ "$CUR" = "$OLD_ID" ] && [ "$ATT" = "$SUNDAY_INV" ];;
esac || { echo "STOP CURRENT_ID $CUR and attested InvocationID $ATT do not fit Tuesday outcome ${TUE#tue:} (see the usage header)"; exit 2; }
F=0; BO=refused
ok()   { echo "PASS $*"; }
bad()  { echo "FAIL $*"; F=$((F+1)); }
info() { echo "INFO $*"; }
mel()  { TZ=Australia/Melbourne date -d "@$1" '+%a %F %H:%M:%S %Z'; }
ep()   { TZ=Australia/Melbourne date -d "$1" +%s; }
nxt()  { systemctl list-timers --all -o json --no-pager 2>/dev/null | tr '{' '\n' \
           | sed -n 's/.*"next":\([0-9][0-9]*\).*"unit":"\([^"]*\)".*/\2 \1/p' \
           | awk -v u="$1" '$1 == u { print int($2 / 1000000); f = 1 } END { if (!f) print 0 }'; }
DAY=$(TZ=Australia/Melbourne date +%F); TODAYC=$(TZ=Australia/Melbourne date +%Y%m%d)
field day "$DAY"
echo "== R6 PRE (r7 verifier) $(date -u +%FT%TZ) local $(mel "$(date +%s)") host=$(host_name) user=$(id -un) outcome=$OUTC current=$CUR $R3 $R4 window=$DAY $WIN $TUE attested=$ATT"
[ "$(host_name)" = afldb-prod ] && [ "$(id -un)" = afldb-verify ] || { echo "STOP not afldb-verify@afldb-prod"; exit 2; }
[ "$DAY" = 2026-11-25 ] && ok "today is Wednesday ($DAY)" || bad "today is not the scheduled Wednesday (2026-11-25); re-plan"
echo "BOOT_ID $(cat /proc/sys/kernel/random/boot_id)"
RFOK=0; if rootfacts a2; then RFOK=1; else bad "root facts (arm-owned state, the service's cwd) unavailable: $RF_WHY"; fi

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

echo "-- 2. boot facts for the GRUB decision (grub.cfg itself is root-only: owner step C1)"
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
[ -z "$P" ] && ok "no apt/dpkg/unattended-upgrade process" || bad "package process running: $(san "$P" 300)"
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
if attested_invocation "$ATT"; then echo "INVOCATION_ID $AI_ID"; ok "live InvocationID = the owner-attested $ATT (Tuesday ${TUE#tue:}; from the sitting record)"
else echo "INVOCATION_ID none (the live InvocationID was not validated: nothing to carry to F-2)"; bad "InvocationID: $AI_WHY"; fi
systemctl show afldb -p NRestarts -p MainPID -p ActiveEnterTimestamp --no-pager | sed 's/^/     /'
MAIN=$(systemctl show afldb -p MainPID --value); NW=0; [[ $MAIN =~ ^[1-9][0-9]*$ ]] && NW=$(pgrep -P "$MAIN" | wc -l)
[ "$NW" = 2 ] && ok "exactly 2 worker processes" || bad "worker processes $NW (expected 2)"
if [ "$RFOK" = 1 ] && [ "${RF[checkout_present]:-}" = yes ]; then
  [ "${RF[current_link]:-}" = "releases/$CUR" ] && ok "current = $CUR" || bad "current = $(san "${RF[current_link]:-${RF[current_link_error]:-?}}" 120) (expected $CUR)"
  info "previous = $(san "${RF[previous_link]:-${RF[previous_link_error]:-?}}" 120); checkout HEAD $(san "${RF[checkout_head]:-${RF[checkout_head_error]:-?}}" 80) (read as files: arm data)"
  if serving_release "$CUR"; then ok "release status (r7 verifier port of release.mjs status, read-only): one result line 'STATUS PASS $CUR', process cwd = the release, health and BUILD_ID manifests, no unattested restart"
  else bad "the release status port does not prove $CUR is serving: $SR_WHY"; fi
  U=${RF[env_url_count]:-}; S=${RF[env_secret_count]:-}
  if [ "$OUTC" = accepted ]; then [ "$U/$S" = 1/1 ] && ok "env counts 1/1 (arm-owned .env, counted by the root facts reader)" || bad "env counts $(san "$U/$S" 40) (accepted A1 left 1/1)"; else info "env counts $U/$S (outcome $OUTC: record)"; fi
  dash "$VB/afldb-settle-failure-status.sh" 2>&1 | sed 's/^/     /'; info "settle-failure-status rc ${PIPESTATUS[0]} (packet R6 prerequisite 5: recorded before the reboot; pinned bundle copy)"
  CS=$(sha256sum < /etc/caddy/Caddyfile | cut -d' ' -f1)
  if [ "$R4" = r4:yes ]; then [ "$CS" = f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d ] && ok "Caddyfile = R4 f00859d5" || bad "Caddyfile $CS (r4:yes expects f00859d5)"
  else [ "$CS" = 4f6972ec119f5d33fff4c16cbbce15c50a36b883654dcffcabdb01776d7af036 ] && ok "Caddyfile = pre-R4 4f6972ec" || bad "Caddyfile $CS (r4:no expects 4f6972ec)"; fi
  a=$(sha256sum < /etc/needrestart/conf.d/50-afldb-hold.conf 2>/dev/null); b=$(sha256sum < /etc/apt/apt.conf.d/52-afldb-unattended 2>/dev/null)
  [ "${a%% *}" = "$PIN_NEEDRESTART" ] && [ "${b%% *}" = "$PIN_APT52" ] \
    && ok "R1 host policy installed (both files equal the pinned repo digests)" || bad "R1 host policy not installed (packet R6 prerequisite 4)"
  [ "${RF[a1_baseline]:-}" = nonempty ] && ok "A1 raw-head baseline present (post-reboot raw-head check runs)" || info "no A1 raw-head baseline: the post-reboot raw-head check is skipped"
else bad "no checkout /home/arm/projects/afldb (root facts: $(san "${RF[checkout_present]:-unavailable}" 60))"; fi
[ -d /var/log/afldb-r5-prefix-retained-20261124 ] && info "R5 directory $(stat -c '%U:%G %a' /var/log/afldb-r5-prefix-retained-20261124)" || info "R5 directory absent"

echo "-- 5. first scheduled backup (Wed 02:20 unit) and restore check (Wed 03:30 unit)"
if [ "$R3" = r3:no ]; then
  bad "r3:no: Wednesday requires its own scheduled backup, off-host copy and restore verification"
else
  V0=$(ep "$DAY 03:30"); V1=$(ep "$DAY 03:41")
  if sealed_origin "$DAY"; then
    BO=attributed
    ok "afldb-backup.service scheduled run SEALED: timer dispatch $(mel "${SO_TIMER_USEC:0:${#SO_TIMER_USEC}-6}") ($SO_TIMER_USEC us), invocation $SO_INVOCATION, root seal $SO_SEAL; published dump $SO_DUMP $SO_BYTES B, full re-hash = seal = root sidecar"
    echo "DISPATCH $SO_DISPATCH_KIND $SO_DISPATCH_DELAY_S s after timer activation"
    echo "BACKUP-EVIDENCE r7 $SO_INVOCATION $SO_TIMER_USEC $SO_DUMP $SO_SHA $SO_DISPATCH_KIND $SO_SEAL"
    echo "OFFHOST-COMPARE $SO_DUMP $SO_SHA"
  else bad "afldb-backup.service scheduled run: scheduled origin unproven: $SO_REASON"
    info "no dump is examined and no OFFHOST-COMPARE line is printed: without a sealed timer run no dump is the scheduled one"; fi
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
  jf() { sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}[,}].*/\1/p" <<< "$1" | head -1; }
  LVJ=${RF[state_last_verify]:-}; ve=$(jf "$LVJ" epoch); vf=$(jf "$LVJ" file); vsha=$(jf "$LVJ" sha256); va=$(jf "$LVJ" attempts)
  info "last-verify.json (arm-produced): file=$(san "$vf" 80) sha256=$(san "$vsha" 80) attempts=$(san "$va" 8)"
  info "last-backup.json (arm, weekly verify's): $(san "${RF[state_last_backup]:-absent}" 300)"
  SLB=; if trusted_path /var/lib/afldb-backup/state/last-backup.json file; then SLB=$(head -c 4096 /var/lib/afldb-backup/state/last-backup.json 2>/dev/null); fi
  info "sealed last-backup.json (root): $(san "${SLB:-absent or untrusted}" 300)"
  RESTORE=
  if [ "$restore_service_ok" = 1 ] && VJ=$(timeout -k 5 120 "$PY" -I -S "$VPY" journal-restore "$vs" "$((vf_end + 1))") &&
      RESTORE=$(match_restore "$TODAYC" "$vs" "$vf_end" "$VJ" "$ve" "$vf" "$vsha" "$va" "${RF[restore_dump]:-}"); then
    ok "restore journal invocation, completion, dump, state and rehash agree (attempts $va; ARM-PRODUCED evidence: the restore runs as arm)"
  else bad "last-verify.json and restored dump do not match the scheduled service invocation"; fi
  [ "$va" = 1 ] || info "verify attempts=$(san "$va" 8) (2 = one benign retry; record it)"
  BR=$(systemctl show afldb-backup.service -p Result --value 2>/dev/null)   # sealed install: the failure record is PID 1's Result=
  MA=$(tr '\n' ' ' <<< "${RF[failed_marker]:-}" | cut -d' ' -f1-40)
  [ "$RFOK" = 1 ] && [ -z "${RF[failed_marker]:-}" ] && [ "$BR" = success ] && ok "no FAILED marker (afldb-backup.service Result=success, PID 1; arm .state clean)" \
    || bad "FAILED marker(s): afldb-backup.service Result=$(san "$BR" 40) arm $(san "$MA" 200) $([ "$RFOK" = 1 ] || echo '(arm state unreadable)')"
  BS=$(backup_status "$SLB" "$LVJ"); rc=$?
  printf '%s\n' "$BS" | sed 's/^/     /'; [ "$rc" = 0 ] && [ "$RFOK" = 1 ] && ok "backup status rc 0 (r7 port of scheduled-backup.sh status)" || bad "backup status not 0 (r7 port of scheduled-backup.sh status)"
  shopt -s nullglob; PD=(/var/lib/afldb-backup/published/*.dump); shopt -u nullglob
  info "dumps held: published ${#PD[@]}, arm directory $(san "${RF[dumps_held]:-?}" 8)"
  if trusted_helper "$PSQL"; then
    RO=$(PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=20000' timeout -k 5 60 "$PSQL" -X -q -v ON_ERROR_STOP=1 -At \
         -d 'host=/var/run/postgresql dbname=afldb_prod user=afldb_verify' 2>&1 <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'ledger|'||count(*)||'|'||max(name) FROM afldb_meta.schema_migrations;
SELECT 'rt|'||d.datname||'|'||coalesce(shobj_description(d.oid,'pg_database'),'-')||'|'||coalesce(s.numbackends,0) FROM pg_database d LEFT JOIN pg_stat_database s ON s.datid = d.oid WHERE d.datname = 'afldb_restore_test';
ROLLBACK;
SQL
    )
  else RO="psql unavailable: $TP_WHY"; fi
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
field backup-origin "$BO"
echo "A2 BACKUP-ORIGIN $BO (reported separately from the whole A-2 status)"
echo; [ $F = 0 ] && echo "R6 PRE RESULT PASS" || { echo "R6 PRE RESULT STOP ($F FAIL line(s)): do not reboot; take them to the owner"; exit 1; }
}
main "$@" < /dev/null
