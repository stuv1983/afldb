#!/usr/bin/env bash
# Release 17822b29, gate G0 (production half): identify Tuesday's scheduled 02:2x dump. PRODUCTION, as arm, READ-ONLY: no write,
# no sudo, no database, no temp file. Command inventory: hostname id date systemctl(show) journalctl (afldb-backup.service, one
# bounded window, JSON output) node -e (the pinned /home/arm/.nvm/versions/node/v22.23.2/bin/node, only to parse that JSON from
# stdin; it opens no file) sha256sum sed awk cut wc tr stat ls printf echo test; redirections only 2>&1, 2>/dev/null, here-strings.
# PASS requires (r4, 27 Nov 2026: a successful start inside the window is NOT enough, a start by hand gives the same):
#   the backup TIMER's run: afldb-backup.timer LastTriggerUSec today 02:20-02:31; the service's last start at or after it and
#   within 5 s; exit by 02:46; Result=success, ExecMainStatus=0; the service's InvocationID (one validated read) is the
#   _SYSTEMD_INVOCATION_ID of exactly one "backup ok" line of the service's own process, logged during that run; no other
#   invocation of the unit in the journal 02:20-02:46 (see backup_journal for the links and the residual limit);
#   exactly ONE afldb_prod-<today>-02[23]*.dump; its re-hash equals its one-line sidecar; that journal line names it:
#   "backup ok: <that name> ... sha256 <first 16 hex>" (ISSUE-352, pick_overnight_dump verbatim from r6-20261125/r6-pre-verify.sh;
#   ts, read_invocation, backup_journal, match_backup and scheduled_backup_run are byte-identical to that script's too);
#   no FAILED marker.
# Prints "BACKUP-EVIDENCE <invocation> <timer> <start> <exit> <ok-line> <dump> <16 hex>" (epochs) and "OFFHOST-COMPARE <dump>
# <sha256>" for the streamanator half: r6-offhost-verify.sh <YYYY-MM-DD> <dump> <sha256>, which must exit 0
# (SCHEDULED-COPY-VERIFIED). Without an attributed timer run the dump is not examined and no OFFHOST-COMPARE line is printed.
# Any other result: G0 FAIL.
# Run (workstation Git Bash; never at minute :16-:18):
#   tr -d '\r' < r1-g0-dump.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- 2026-11-24
# Test seam: R1_LIB_ONLY=1 when sourced.
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

ts() {
  local value
  value=$(TZ=UTC systemctl show --timestamp=unix -p "$2" --value "$1" 2>/dev/null)
  # LastTriggerUSec ignores --timestamp on the host's systemd. Render it in
  # UTC to keep GNU date independent of the host's AEDT/AEST abbreviation.
  date -u -d "${value:-invalid}" +%s 2>/dev/null || echo 0
}

# R6 r4 (review finding 3, 27 Nov 2026): ONE read of a unit's InvocationID, validated before anything uses or prints it. Sets
# RI_ID to the value only when `systemctl show` exited 0 and printed exactly one lower-case 32-hex ID (otherwise RI_ID is empty)
# and RI_WHY to the reason; returns 0 only for a valid ID. Callers print and compare RI_ID, never a second read.
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

# R6 r4 (review finding 2, 27 Nov 2026): "afldb-backup.service started in the 02:20 window and succeeded" is also true of a manual
# `systemctl start` in that window. The scheduled run is now attributed in three links, all read-only and unprivileged:
#   timer -> invocation: afldb-backup.timer LastTriggerUSec lies in the window and the service's last ExecMainStartTimestamp is at
#     or after it and within 5 s; that run exited (ExecMainExitTimestamp) by window end + 15 min with Result=success, status 0;
#   invocation -> journal: the service's InvocationID (one validated read) is the _SYSTEMD_INVOCATION_ID that journald itself
#     attached to exactly one "backup ok" line logged by the service's own process between that start and exit (+5 s for
#     journald's receipt time), and NO other invocation of the unit appears in the journal from the window start to window end
#     + 15 min (a timer run that failed or was replaced, then a start by hand, is two invocations: ambiguous, STOP);
#   journal -> dump: that line's dump name and 16 hex are what pick_overnight_dump requires of the unique 02:2x file and sidecar.
# Only trusted journal fields are used (_SYSTEMD_UNIT, _SYSTEMD_INVOCATION_ID, _PID, __REALTIME_TIMESTAMP). Lines PID 1 logs
# about the unit (UNIT=, INVOCATION_ID=) count as invocation evidence when arm can read them; nothing depends on their presence.
# ActivationDetails is not used (unprintable through systemctl, and its trigger time was observed stale).
# Residual limit: a timer-started run that ends within 5 s having logged nothing readable by arm (scheduled-backup.sh logs its
# "target:" line first, so this needs an exec or unit-level failure), followed inside those 5 s by a start by hand, is not
# distinguishable with unprivileged reads; PID 1's journal lines (owner, sudo journalctl) would show both invocations.
#
# backup_journal prints one line per journal entry that carries invocation evidence, "<invocation> <epoch> own <MESSAGE>" for
# the service's own process and "<invocation> <epoch> pid1 -" for PID 1, nothing on any failure. Returns 0; 10 journalctl failed;
# 3 an entry is not a JSON object; 4 an entry of the service's own process lacks a 32-hex invocation ID or a timestamp; any other
# value is node's own failure. Non-printable bytes in MESSAGE become "?" (a line cannot be forged by an embedded newline).
backup_journal() { # since-epoch until-epoch node
  local -a st
  journalctl -u afldb-backup.service --since "@$1" --until "@$2" -o json --no-pager |
    "$3" -e '
      const unit = "afldb-backup.service", hex = /^[0-9a-f]{32}$/, usec = /^[0-9]{16}$/;
      let text = "";
      process.stdin.setEncoding("utf8").on("data", (chunk) => { text += chunk; }).on("end", () => {
        const out = [];
        for (const line of text.split("\n")) {
          if (line === "") continue;
          let entry;
          try { entry = JSON.parse(line); } catch { process.exit(3); }
          if (entry === null || typeof entry !== "object" || Array.isArray(entry)) process.exit(3);
          const at = entry.__REALTIME_TIMESTAMP;
          if (entry._SYSTEMD_UNIT === unit) {
            const id = entry._SYSTEMD_INVOCATION_ID;
            if (typeof id !== "string" || !hex.test(id) || typeof at !== "string" || !usec.test(at)) process.exit(4);
            const message = typeof entry.MESSAGE === "string" ? entry.MESSAGE.replace(/[^\x20-\x7e]/g, "?") : "?";
            out.push(`${id} ${at.slice(0, 10)} own ${message}\n`);
          } else if (entry._PID === "1" && entry.UNIT === unit && typeof entry.INVOCATION_ID === "string" &&
              hex.test(entry.INVOCATION_ID) && typeof at === "string" && usec.test(at)) {
            out.push(`${entry.INVOCATION_ID} ${at.slice(0, 10)} pid1 -\n`);
          }
        }
        process.stdout.write(out.join(""));
      });'
  st=("${PIPESTATUS[@]}")
  [ "${st[0]}" = 0 ] || return 10
  return "${st[1]}"
}

# Prints "<invocation> <timer-epoch> <start-epoch> <exit-epoch> <ok-line-epoch> <dump> <16 hex>" and returns 0 only when every
# link above holds; otherwise prints "REASON ..." and returns 1. Pure: every fact is an argument.
match_backup() { # B0 B1 timer start exit Result ExecMainStatus invocation journal-rc journal-lines
  local b0=$1 b1=$2 bt=$3 bs=$4 be=$5 res=$6 xs=$7 inv=$8 jrc=$9 jl=${10} limit=$(($2 + 900)) id at kind msg n=0 hit=
  local re='^[^ ]+ scheduled-backup: backup ok: ([^ ]+) [0-9]+ bytes sha256 ([0-9a-f]{16})( offhost=[^ ]+)?$'
  [[ $b0 =~ ^[0-9]{10}$ && $b1 =~ ^[0-9]{10}$ && $bt =~ ^[0-9]{1,10}$ && $bs =~ ^[0-9]{1,10}$ && $be =~ ^[0-9]{1,10}$ ]] \
    || { echo "REASON a timestamp is not a number (timer '$bt' start '$bs' exit '$be')"; return 1; }
  [ "$bt" -gt 0 ] || { echo "REASON afldb-backup.timer LastTriggerUSec is missing or unreadable: no timer dispatch is recorded"; return 1; }
  (( b0 <= bt && bt <= b1 )) || { echo "REASON no timer dispatch in the window: afldb-backup.timer last triggered at epoch $bt, outside $b0..$b1"; return 1; }
  [ "$bs" -gt 0 ] || { echo "REASON afldb-backup.service ExecMainStartTimestamp is missing or unreadable"; return 1; }
  (( bt <= bs && bs - bt <= 5 && bs <= b1 )) \
    || { echo "REASON the service's last start (epoch $bs) is not within 5 s after the timer dispatch (epoch $bt): that start is not the timer's"; return 1; }
  [ "$be" -gt 0 ] && (( bs <= be && be <= limit )) \
    || { echo "REASON the service's last run has no completion between its start and the window end + 15 min (exit epoch $be, start $bs, limit $limit)"; return 1; }
  [ "$res" = success ] && [ "$xs" = 0 ] || { echo "REASON the timer's run did not succeed: Result=$res ExecMainStatus=$xs (expected success, 0)"; return 1; }
  [[ $inv =~ ^[0-9a-f]{32}$ ]] || { echo "REASON the service InvocationID is not one 32-hex value"; return 1; }
  case $jrc in
    0) ;;
    10) echo "REASON journalctl failed: the afldb-backup.service journal could not be read"; return 1;;
    3) echo "REASON a journal entry is not valid JSON: the afldb-backup.service journal could not be parsed"; return 1;;
    4) echo "REASON a journal entry of afldb-backup.service carries no valid invocation ID or timestamp"; return 1;;
    *) echo "REASON the journal JSON reader failed (exit $jrc)"; return 1;;
  esac
  while read -r id at kind msg; do
    [ -n "$id" ] || continue
    [[ $id =~ ^[0-9a-f]{32}$ && $at =~ ^[0-9]{10}$ && $kind =~ ^(own|pid1)$ ]] || { echo "REASON unparsable journal evidence line"; return 1; }
    [ "$id" = "$inv" ] || { echo "REASON ambiguous: another invocation of afldb-backup.service ($id, epoch $at) is in the window journal; the service's last invocation is $inv"; return 1; }
    [ "$kind" = own ] || continue
    (( bs <= at && at <= be + 5 )) || { echo "REASON invocation $inv logged at epoch $at, outside its own run $bs..$be"; return 1; }
    if [[ $msg =~ $re ]]; then n=$((n + 1)); hit="$at ${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"; fi
  done <<< "$jl"
  [ "$n" = 1 ] || { echo "REASON invocation $inv logged $n 'backup ok' lines in the window (need exactly 1): the timer's run is not tied to a dump"; return 1; }
  echo "$inv $bt $bs $be $hit"
}

# The live reads for match_backup. Sets BR_EVID (match_backup's line), BR_JOURNAL (the MESSAGE text of the service's own lines,
# for pick_overnight_dump) and BR_WHY; returns 0 only when the run is attributed. Uses ts, read_invocation, backup_journal.
scheduled_backup_run() { # B0 B1 node
  local bt bs be res xs jl jrc
  BR_EVID=; BR_JOURNAL=; BR_WHY=
  bt=$(ts afldb-backup.timer LastTriggerUSec); bs=$(ts afldb-backup.service ExecMainStartTimestamp); be=$(ts afldb-backup.service ExecMainExitTimestamp)
  res=$(systemctl show afldb-backup.service -p Result --value 2>/dev/null); xs=$(systemctl show afldb-backup.service -p ExecMainStatus --value 2>/dev/null)
  read_invocation afldb-backup.service || { BR_WHY="afldb-backup.service InvocationID: $RI_WHY"; return 1; }
  [ -x "$3" ] || { BR_WHY="node is not executable at $3: the journal cannot be read"; return 1; }
  jl=$(backup_journal "$1" "$(($2 + 906))" "$3"); jrc=$?
  BR_EVID=$(match_backup "$1" "$2" "$bt" "$bs" "$be" "$res" "$xs" "$RI_ID" "$jrc" "$jl") || { BR_WHY=${BR_EVID#REASON }; BR_EVID=; return 1; }
  BR_JOURNAL=$(sed -n 's/^[0-9a-f]\{32\} [0-9]\{10\} own //p' <<< "$jl")
}

main() {
set -uo pipefail; export LC_ALL=C
DAY=${1:?YYYY-MM-DD}; [[ $DAY =~ ^2026-11-2[4-9]$ ]] || { echo "STOP usage: <YYYY-MM-DD Melbourne date of the run>"; exit 2; }
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP not afldb-prod as arm"; exit 2; }
BK=/home/arm/backups/afldb-scheduled; DC=${DAY//-/}; F=0
ep() { TZ=Australia/Melbourne date -d "$1" +%s; }
mel() { TZ=Australia/Melbourne date -d "@$1" '+%a %F %H:%M:%S %Z'; }
[ "$(TZ=Australia/Melbourne date +%F)" = "$DAY" ] || { echo "STOP today (Melbourne) is $(TZ=Australia/Melbourne date +%F), not $DAY"; exit 2; }
echo "== R1 G0 $(date -u +%FT%TZ) local $(mel "$(date +%s)") day $DAY"
B0=$(ep "$DAY 02:20"); B1=$(ep "$DAY 02:31")
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
if scheduled_backup_run "$B0" "$B1" "$N"; then
  read -r bi bt bs be bj bn bh <<< "$BR_EVID"
  echo "PASS afldb-backup.service scheduled run: timer dispatch $(mel "$bt"), its start $(mel "$bs"), exit $(mel "$be"), Result=success status=0; invocation $bi alone in the window journal, 'backup ok' at $(mel "$bj")"
  echo "BACKUP-EVIDENCE $BR_EVID"
  if PICK=$(pick_overnight_dump "$BK" "$DC" "$BR_JOURNAL"); then
    SDN=${PICK%% *}; SS=${PICK#* }
    if [ "$SDN ${SS:0:16}" = "$bn $bh" ]; then
      echo "PASS scheduled dump unique, is the dump the timer's invocation $bi reported, re-hash = sidecar: $SDN $(stat -c %s "$BK/$SDN") B"
      echo "OFFHOST-COMPARE $PICK"
    else echo "FAIL scheduled dump $SDN ${SS:0:16} is not the dump the timer's invocation reported ($bn $bh)"; F=1; fi
  else echo "FAIL dump not attributable: ${PICK#REASON }"; F=1; fi
else
  echo "FAIL afldb-backup.service scheduled run is not attributed to the backup timer: $BR_WHY"; F=1
  echo "INFO the 02:2x dump is not examined and no OFFHOST-COMPARE line is printed: without an attributed timer run no dump is the scheduled one"
fi
M=$(ls -1 "$BK"/.state/FAILED-* 2>/dev/null | tr '\n' ' '); [ -z "$M" ] && echo "PASS no FAILED marker" || { echo "FAIL FAILED marker(s): $M"; F=1; }
echo "INFO afldb-backup-verify.service last: $(systemctl show afldb-backup-verify.service -p Result -p ExecMainStatus -p ExecMainStartTimestamp --value | tr '\n' ' ')(record; not a G0 criterion)"
[ $F = 0 ] && echo "G0 PROD RESULT PASS: now on streamanator: r6-offhost-verify.sh $DAY <dump> <sha256> must exit 0" || { echo "G0 PROD RESULT FAIL: STOP, the release is deferred, production unchanged"; exit 1; }
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
