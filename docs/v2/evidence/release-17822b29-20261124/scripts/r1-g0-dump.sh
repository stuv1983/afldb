#!/usr/bin/env bash
# Release 17822b29, gate G0 (production half): identify Tuesday's scheduled 02:2x dump. PRODUCTION, as arm, READ-ONLY: no write,
# no sudo, no database, no temp file. Command inventory: hostname id date systemctl(show: the backup timer and service, incl. their
# FragmentPath, DropInPaths, EnvironmentFiles and ExecStartPostEx) journalctl (afldb-backup.service, one bounded window, JSON output)
# busctl(get-property: afldb-backup.timer LastTriggerUSec, in microseconds, nothing else) node -e (the pinned /home/arm/.nvm/versions/node/v22.23.2/bin/node, only to parse that JSON from
# stdin; it opens no file) sha256sum sed awk cut wc tr stat ls printf echo test; redirections only 2>&1, 2>/dev/null, here-strings.
# R6 r6 (28 Nov 2026): stat, sha256sum and awk also read (never write) the root-owned attestation: the writer
# /usr/local/libexec/afldb/afldb-backup-attest, its drop-in, both unit files, every component of their paths, and the records in
# /var/lib/afldb-backup-attest (attested_origin).
# PASS requires (r4, 27 Nov 2026: a successful start inside the window is NOT enough, a start by hand gives the same):
#   the backup TIMER's run: afldb-backup.timer LastTriggerUSec today 02:20-02:31; the service's last start at or after it and
#   within 5 s; exit by 02:46; Result=success, ExecMainStatus=0; the service's InvocationID (one validated read) is the
#   _SYSTEMD_INVOCATION_ID of exactly one "backup ok" line of the service's own process, logged during that run; no other
#   invocation of the unit in the journal 02:20-02:46; AND (r6, 28 Nov 2026: the origin, replacing r5's arm-written trigger line,
#   which no longer counts) a ROOT record /var/lib/afldb-backup-attest/<that invocation>.attest, written by the pinned root writer
#   while the run's start job was live, proves the job was created by afldb-backup.timer at its LastTriggerUSec to the microsecond,
#   with no stop or failure of the unit in between (see backup_journal for the links, attested_origin for the rule, and the residual
#   limits); without the installed writer (production until the owner installs review-fixes-r6-20261128/attest/) the result is
#   "scheduled origin unproven", G0 FAIL; and (record format 2, 28 Nov 2026, independent review MED-1) the record BINDS THE DUMP: the
#   name and full sha256 of the single dump the run left, found and hashed by the writer as uid arm; its name and 16 hex must equal
#   the "backup ok" line's, and the picked dump's full re-hash must equal the record's sha256 before OFFHOST-COMPARE is printed;
#   exactly ONE afldb_prod-<today>-02[23]*.dump; its re-hash equals its one-line sidecar; that journal line names it:
#   "backup ok: <that name> ... sha256 <first 16 hex>" (ISSUE-352, pick_overnight_dump verbatim from r6-20261125/r6-pre-verify.sh;
#   ts, timer_usec, read_invocation, backup_journal, match_backup, trusted_path, attested_origin and scheduled_backup_run are
#   byte-identical to that script's too);
#   no FAILED marker.
# Prints "BACKUP-EVIDENCE <invocation> <timer> <start> <exit> <ok-line> <dump> <16 hex>" (epochs) and "OFFHOST-COMPARE <dump>
# <sha256>" for the streamanator half: r6-offhost-verify.sh <YYYY-MM-DD> <dump> <sha256>, which must exit 0
# (SCHEDULED-COPY-VERIFIED). Without an attributed timer run (origin included) the dump is not examined, no OFFHOST-COMPARE line is
# printed, and nothing here reads the off-host copy or the pull stamp.
# Any other result: G0 FAIL.
# Not independent of arm (independent review MED-2, recorded as an owner decision): this gate runs in arm's login, so a gate run as
# arm cannot be independent of arm's login environment (~/.bashrc, PATH, functions); the verdict needs a non-arm verifier (Stu's
# decision). The root record is out of arm's reach; this script's output is not.
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

# R6 r5 (27 Nov 2026): the timer's LastTriggerUSec in MICROSECONDS. `systemctl show` prints whole seconds; the system bus gives the
# exact value to any user (busctl get-property, read-only). Prints the integer; prints nothing and returns 1 on any failure.
timer_usec() {
  local out
  out=$(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec 2>/dev/null) || return 1
  [[ $out =~ ^t\ ([1-9][0-9]{6,19})$ ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
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
# `systemctl start` in that window. The scheduled run is attributed in four links, all read-only and unprivileged:
#   timer -> invocation: afldb-backup.timer LastTriggerUSec lies in the window and the service's last ExecMainStartTimestamp is at
#     or after it and within 5 s; that run exited (ExecMainExitTimestamp) by window end + 15 min with Result=success, status 0;
#   invocation -> journal: the service's InvocationID (one validated read) is the _SYSTEMD_INVOCATION_ID that journald itself
#     attached to exactly one "backup ok" line logged by the service's own process between that start and exit (+5 s for
#     journald's receipt time), and NO other invocation of the unit appears in the journal from the window start to window end
#     + 15 min (a timer run that failed or was replaced, then a start by hand, is two invocations: ambiguous, STOP);
#   journal -> dump: that line's dump name and 16 hex are what pick_overnight_dump requires of the unique 02:2x file and sidecar
#     (this link runs through arm's node, which arm can replace: since record format 2 the ROOT record binds the dump itself, below);
#   ORIGIN (r6, 28 Nov 2026; review-fixes-r6-20261128/DESIGN.md): the links above hold equally for a start by hand 3 s after a timer
#     dispatch whose own run failed where arm cannot see it (PID 1 alone logs a failed dependency or an exec failure), so the
#     invocation itself must carry the dispatch, and the carrier must be out of arm's reach. r5 read a "trigger:" journal line that
#     the arm-owned scheduled-backup.sh wrote; arm can edit that script, so the line proved nothing (r5 challenger, MED). It is
#     WITHDRAWN: no gate reads a trigger line, and one counts toward nothing. Instead a ROOT writer, a full-privilege ExecStartPost
#     of the unit (review-fixes-r6-20261128/attest/), reads PID 1's facts about the run's own START JOB while that job is live and
#     writes /var/lib/afldb-backup-attest/<invocation>.attest. attested_origin accepts the run only if every one of these holds:
#     every path it trusts (the writer, /usr/bin/env, /usr/bin/bash and the writer's helpers, the drop-in, both unit files and their
#     drop-ins, the record directory and the record) is root-owned and not group- or other-writable, with no symbolic link from /
#     down (and the record has one link); the writer and the drop-in hash to the digests pinned below; the loaded unit has no
#     EnvironmentFile= and exactly ONE ExecStartPost, the writer's command line with root privileges; the record (exact format) names
#     this invocation, a JobType=start job created by afldb-backup.timer at the timer's LastTriggerUSec (busctl, microseconds) exactly,
#     the unit in activating/start-post with ExecStart exited 0, no stop or failure of the unit between that dispatch and this
#     invocation (inactive-enter before the dispatch; inactive-exit and main start each at or after it and within 5 s, in either order: PID 1 stamps the main start at the fork and inactive-exit about 0.2 ms later), and no other record names the same dispatch.
#     DUMP BINDING (record format 2, 28 Nov 2026, independent review MED-1: a genuine run's record plus a planted dump and a node that
#     rewrote the "backup ok" line passed G0): the writer finds, AS UID ARM (setpriv, never root's credentials), the single dump the
#     run left in /home/arm/backups/afldb-scheduled (modified at or after the main start) and records its name and full sha256
#     (none if not exactly one). attested_origin requires that name and the first 16 hex to equal the "backup ok" line's dump, and
#     each caller requires the picked dump's FULL re-hash to equal the record's dump_sha256 before it prints OFFHOST-COMPARE.
#     Otherwise "scheduled origin unproven": exit nonzero, the dump is not examined, no OFFHOST-COMPARE line is printed. A start by
#     hand gets a record too (trigger_unit=none) and is refused; accepting one is the owner's decision, not a script's. Until the
#     writer is installed (production today) every run is "scheduled origin unproven", by design.
# Not used, and why (proved on real systemd 255.4 in review-fixes-r5-20261127/logs and review-fixes-r6-20261128/logs): $TRIGGER_UNIT
# and $TRIGGER_TIMER_REALTIME_USEC in the run's environment, and the unit's own ActivationDetails, keep the FIRST timer start since
# the unit was loaded, so every later run, a start by hand included, inherits an old dispatch; any line the run's own (arm) code logs;
# a shorter timing tolerance, a second timestamp comparison and a search for competing invocation IDs cannot show where a start came
# from; PID 1's own lines would, and arm cannot read them. The start job, which does carry the dispatch, exists only during the run.
# Only trusted journal fields are used (_SYSTEMD_UNIT, _SYSTEMD_INVOCATION_ID, _PID, __REALTIME_TIMESTAMP). Lines PID 1 logs
# about the unit (UNIT=, INVOCATION_ID=) count as invocation evidence when arm can read them; nothing depends on their presence.
# Residual limits (DESIGN.md 2 and 5): root (or sudo) can write any record, edit any trusted file or re-arm the timer; starting or
# restarting afldb-backup.timer dispatches the service only when Persistent= finds a missed elapse (or the calendar elapses while
# it is active), and such a dispatch is a genuine dispatch by the timer unit, not proof that the calendar elapsed unattended (the
# PASS line prints how long after the timer's last (re)activation the dispatch came, information only; the policy is Stu's);
# a gate run as arm cannot be independent of arm's login environment (a compromised ~/.bashrc or PATH controls what any arm
# process prints, this gate included), so the verdict needs a non-arm verifier (Stu's decision); the dump is written by the attested
# run's own (arm) code, and the record binds the file that run left, not what it should have written (MED-3, deterministic, not a
# race: an arm process outside the unit can SIGSTOP the same-uid workload after backup.sh, substitute the file and SIGCONT it before
# the writer hashes it; R6 r7 moves dump production to the separate afldb-backup account and the verdict to the owner verifier, so
# a verdict this script prints as arm is no longer GO evidence); the writer needs systemd's Job ActivationDetails (systemd
# 255.4-1ubuntu8.19); a start by hand that arrives while the timer's own start job is still queued joins that job (one job, one
# invocation: the timer's); a journal receipt later than 5 s after the exit is a false STOP.
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
# link above but the origin holds; otherwise prints "REASON ..." and returns 1. Pure: every fact is an argument. The 11th argument
# is the timer's LastTriggerUSec in microseconds (timer_usec), checked here for agreement with the seconds and handed by
# scheduled_backup_run to attested_origin. No journal line counts as origin evidence (r6).
match_backup() { # B0 B1 timer start exit Result ExecMainStatus invocation journal-rc journal-lines timer-usec
  local b0=$1 b1=$2 bt=$3 bs=$4 be=$5 res=$6 xs=$7 inv=$8 jrc=$9 jl=${10} btu=${11:-} limit=$(($2 + 900)) id at kind msg n=0 hit=
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
  [[ $btu =~ ^[1-9][0-9]{6,19}$ ]] || { echo "REASON scheduled origin unproven: afldb-backup.timer LastTriggerUSec could not be read in microseconds (busctl)"; return 1; }
  [ "${btu:0:${#btu}-6}" = "$bt" ] || { echo "REASON scheduled origin unproven: LastTriggerUSec in microseconds ($btu) and in seconds ($bt) disagree"; return 1; }
  echo "$inv $bt $bs $be $hit"
}

# R6 r6: TRUSTED PATH. Returns 0 only when no component of the absolute path from / to the leaf is a symbolic link, every component
# is owned by uid 0 and is not group- or other-writable, every component but the leaf is a directory, and the leaf is a directory
# (dir) or a regular file (file; record: also exactly one hard link). Sets TP_WHY. One stat call, no write, no symlink followed.
trusted_path() { # absolute-path dir|file|record
  local p=$1 want=$2 r c= i=0 u a n t out; local -a cs=(/)
  TP_WHY=
  [[ $p =~ ^(/[A-Za-z0-9_@.][A-Za-z0-9_@.-]{0,254}){1,32}$ && /$p/ != */./* && /$p/ != */../* ]] \
    || { TP_WHY="'${p//[^A-Za-z0-9\/._@-]/?}' is not a plain absolute path"; TP_WHY=${TP_WHY:0:200}; return 1; }
  r=${p#/}; while [ -n "$r" ]; do c=$c/${r%%/*}; cs+=("$c"); if [[ $r == */* ]]; then r=${r#*/}; else r=; fi; done
  out=$(stat -c '%u %a %h %F' -- "${cs[@]}" 2>/dev/null) || { TP_WHY="$p: missing, or a component cannot be read"; return 1; }
  while read -r u a n t; do
    c=${cs[i]}; i=$((i + 1))
    [[ $u =~ ^[0-9]+$ && $a =~ ^[0-7]{3,4}$ && $n =~ ^[0-9]+$ ]] || { TP_WHY="$c: unparsable stat output"; return 1; }
    [ "$t" != "symbolic link" ] || { TP_WHY="$c is a symbolic link"; return 1; }
    [ "$u" = 0 ] || { TP_WHY="$c is owned by uid $u, not root"; return 1; }
    if (( 8#$a & 8#022 )); then TP_WHY="$c has mode $a: group- or other-writable"; return 1; fi
    if [ "$i" -lt "${#cs[@]}" ] || [ "$want" = dir ]; then [ "$t" = directory ] || { TP_WHY="$c is a $t, not a directory"; return 1; }
    else [ "$t" = "regular file" ] || { TP_WHY="$c is a $t, not a regular file"; return 1; }; fi
    [ "$i" -lt "${#cs[@]}" ] || [ "$want" != record ] || [ "$n" = 1 ] || { TP_WHY="$c has $n hard links (need 1)"; return 1; }
  done <<< "$out"
  [ "$i" = "${#cs[@]}" ] || { TP_WHY="$p: stat printed $i lines for ${#cs[@]} components"; return 1; }
}

# R6 r6: ORIGIN from the root writer's record (DESIGN.md 4, items 1-6; see the ORIGIN paragraph above). Every path, digest and
# command line is a constant HERE: nothing comes from the environment or an argument but the invocation and the timer's
# LastTriggerUSec in microseconds, both validated reads of the caller, and the dump name and 16 hex of the run's "backup ok" line
# (match_backup's). Returns 0 and sets AO_INFO (record facts and the item-6 information for the PASS line), AO_DUMP and
# AO_DUMP_SHA (the record's dump binding, which the callers compare with the picked dump's full re-hash) only when every item holds;
# otherwise sets AO_WHY and returns 1. Read-only: systemctl show, stat, sha256sum, awk, and bash reads of the record; no write.
attested_origin() { # invocation timer-usec dump-name dump-16-hex
  local inv=$1 tu=$2 bn=$3 bh=$4 W=/usr/local/libexec/afldb/afldb-backup-attest D=/etc/systemd/system/afldb-backup.service.d/60-afldb-backup-attest.conf
  local WS=799e6691954e4d7562cbc6b7af82f307cde0c8af71e450cd5f66f2af9994b398 DS=2a3a067ef408377ccf6deae7c97c38366854c581a16e3f33ce2265787abc440e
  local RD=/var/lib/afldb-backup-attest X='/usr/bin/env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash --noprofile --norc /usr/local/libexec/afldb/afldb-backup-attest'
  local XF='ignore-failure privileged' N='(0|[1-9][0-9]{0,17})' out l p h rec i n=0 sz frag= drop= tfrag= tdrop= ef=0 ne=0 ex= argv= flags= ie tm ix xs ta d re
  local -a ps tps L recs K R; local -A F
  AO_WHY=; AO_INFO=; AO_DUMP=; AO_DUMP_SHA=
  [[ $inv =~ ^[0-9a-f]{32}$ && $tu =~ ^[1-9][0-9]{6,17}$ ]] || { AO_WHY="invalid invocation or LastTriggerUSec"; return 1; }
  [[ $bn =~ ^afldb_prod-[0-9]{8}-[0-9]{6}\.dump$ && $bh =~ ^[0-9a-f]{16}$ ]] || { AO_WHY="invalid dump name or 16 hex from the 'backup ok' line"; return 1; }
  # item 3: the unit as PID 1 has it loaded
  out=$(systemctl show afldb-backup.service -p FragmentPath -p DropInPaths -p EnvironmentFiles -p ExecStartPostEx 2>/dev/null) \
    || { AO_WHY="systemctl show afldb-backup.service failed"; return 1; }
  while IFS= read -r l; do case $l in
    FragmentPath=*) frag=${l#*=};; DropInPaths=*) drop=${l#*=};; EnvironmentFiles=?*) ef=$((ef + 1));;
    ExecStartPostEx=?*) ne=$((ne + 1)); ex=${l#*=};; esac; done <<< "$out"
  [ "$ef" = 0 ] || { AO_WHY="afldb-backup.service has $ef EnvironmentFile= entries: its environment is not root-controlled"; return 1; }
  [ "$ne" = 1 ] || { AO_WHY="afldb-backup.service has $ne ExecStartPost commands (need exactly 1, the attestation writer: is it installed?)"; return 1; }
  re='^\{ path=/usr/bin/env ; argv\[\]=(.*) ; flags=([a-z -]*) ; start_time='
  [[ $ex =~ $re ]] && argv=${BASH_REMATCH[1]} && flags=${BASH_REMATCH[2]}
  [ "$argv" = "$X" ] || { AO_WHY="afldb-backup.service ExecStartPost is not the attestation writer's command line"; return 1; }
  [ "$flags" = "$XF" ] || { AO_WHY="afldb-backup.service ExecStartPost flags are '$flags', not '$XF' (the drop-in's -+: root, ignore failure)"; return 1; }
  read -ra ps <<< "$drop"
  [[ " $drop " == *" $D "* ]] || { AO_WHY="afldb-backup.service DropInPaths lacks $D"; return 1; }
  out=$(systemctl show afldb-backup.timer -p FragmentPath -p DropInPaths 2>/dev/null) || { AO_WHY="systemctl show afldb-backup.timer failed"; return 1; }
  while IFS= read -r l; do case $l in FragmentPath=*) tfrag=${l#*=};; DropInPaths=*) tdrop=${l#*=};; esac; done <<< "$out"
  read -ra tps <<< "$tdrop"
  [ -n "$frag" ] && [ -n "$tfrag" ] || { AO_WHY="afldb-backup.service or afldb-backup.timer has no FragmentPath"; return 1; }
  # item 1: trusted paths; item 2: the writer's and the drop-in's identity at gate time
  for p in /usr/bin/env /usr/bin/bash /usr/bin/systemctl /usr/bin/busctl /usr/bin/sha256sum /usr/bin/timeout /usr/bin/mv /usr/bin/setpriv /usr/bin/stat "$W" "$D" \
      "$frag" "${ps[@]}" "$tfrag" "${tps[@]}"; do
    trusted_path "$p" file || { AO_WHY="untrusted path: $TP_WHY"; return 1; }
  done
  trusted_path "$RD" dir || { AO_WHY="untrusted record directory: $TP_WHY"; return 1; }
  h=$(sha256sum < "$W" 2>/dev/null); [ "${h%% *}" = "$WS" ] || { AO_WHY="the writer $W has sha256 ${h:0:16}..., not the pinned ${WS:0:16}..."; return 1; }
  h=$(sha256sum < "$D" 2>/dev/null); [ "${h%% *}" = "$DS" ] || { AO_WHY="the drop-in $D has sha256 ${h:0:16}..., not the pinned ${DS:0:16}..."; return 1; }
  # item 4: the record of THIS invocation, exact format, then its facts
  rec=$RD/$inv.attest
  [ -e "$rec" ] || [ -L "$rec" ] || { AO_WHY="no root record $rec: the writer did not attest invocation $inv"; return 1; }
  trusted_path "$rec" record || { AO_WHY="untrusted record: $TP_WHY"; return 1; }
  K=(writer_sha256 unit invocation job job_type active_state sub_state exec_main_code exec_main_status inactive_enter_mono
    inactive_exit_mono exec_main_start_mono trigger_unit trigger_timer_realtime_usec timer_last_trigger_usec timer_last_trigger_mono
    timer_active_enter_mono dump dump_sha256 boot_id written_realtime_usec)
  R=('[0-9a-f]{64}' 'afldb-backup\.service' '[0-9a-f]{32}' '[1-9][0-9]{0,9}' '[a-z-]{1,32}' '[a-z-]{1,32}' '[a-z-]{1,32}' '[0-9]{1,3}'
    '[0-9]{1,3}' "$N" "$N" "$N" 'none|[A-Za-z0-9_.@:-]{1,255}' 'none|[1-9][0-9]{0,17}' "$N" "$N" "$N"
    'none|afldb_prod-[0-9]{8}-[0-9]{6}\.dump' 'none|[0-9a-f]{64}' '[0-9a-f]{32}' '[1-9][0-9]{15,17}')
  mapfile -t L 2>/dev/null < "$rec"
  [ "${#L[@]}" = 22 ] && [ "${L[0]}" = afldb-backup-attest/2 ] || { AO_WHY="record $rec is malformed (${#L[@]} lines, need the 22-line afldb-backup-attest/2 format)"; return 1; }
  n=22
  for i in "${!K[@]}"; do
    re="^${K[i]}=(${R[i]})\$"
    [[ ${L[i + 1]} =~ $re ]] || { AO_WHY="record $rec line $((i + 2)) is not ${K[i]}=<value>"; return 1; }
    F[${K[i]}]=${BASH_REMATCH[1]}; n=$((n + ${#L[i + 1]} + 1))
  done
  sz=$(stat -c %s -- "$rec" 2>/dev/null); [ "$sz" = "$n" ] || { AO_WHY="record $rec has $sz bytes, not the $n of its 22 lines"; return 1; }
  [ "${F[writer_sha256]}" = "$WS" ] || { AO_WHY="record $rec was written by writer ${F[writer_sha256]:0:16}..., not the pinned ${WS:0:16}..."; return 1; }
  [ "${F[invocation]}" = "$inv" ] || { AO_WHY="record $rec names invocation ${F[invocation]}, not the run's $inv"; return 1; }
  [ "${F[job_type]}" = start ] || { AO_WHY="record $rec: the run's job is a ${F[job_type]} job, not a start job"; return 1; }
  [ "${F[active_state]}/${F[sub_state]}" = activating/start-post ] || { AO_WHY="record $rec: the unit was ${F[active_state]}/${F[sub_state]} when attested, not activating/start-post"; return 1; }
  [ "${F[exec_main_code]}/${F[exec_main_status]}" = 1/0 ] || { AO_WHY="record $rec: ExecStart ended with code ${F[exec_main_code]} status ${F[exec_main_status]}, not exited 0"; return 1; }
  [ "${F[trigger_unit]}" = afldb-backup.timer ] || { AO_WHY="record $rec: the run's start job names trigger unit '${F[trigger_unit]}', not afldb-backup.timer (a start by hand, or by a dependency, carries no timer dispatch)"; return 1; }
  [ "${F[trigger_timer_realtime_usec]}" = "$tu" ] || { AO_WHY="record $rec: the run's start job records the dispatch at ${F[trigger_timer_realtime_usec]} us, but the timer's LastTriggerUSec is $tu us (an earlier or another dispatch)"; return 1; }
  [ "${F[timer_last_trigger_usec]}" = "$tu" ] || { AO_WHY="record $rec: the timer's LastTriggerUSec was ${F[timer_last_trigger_usec]} us when attested, $tu us now"; return 1; }
  [ "${F[dump]}" != none ] && [ "${F[dump_sha256]}" != none ] \
    || { AO_WHY="record $rec: the writer found no single dump of this run (dump=${F[dump]} dump_sha256=${F[dump_sha256]:0:16})"; return 1; }
  [ "${F[dump]}" = "$bn" ] || { AO_WHY="record $rec binds the dump ${F[dump]}, but the run's 'backup ok' line (read through node) names $bn"; return 1; }
  [ "${F[dump_sha256]:0:16}" = "$bh" ] || { AO_WHY="record $rec binds ${F[dump]} with sha256 ${F[dump_sha256]:0:16}..., but the 'backup ok' line says $bh"; return 1; }
  ie=${F[inactive_enter_mono]}; tm=${F[timer_last_trigger_mono]}; ix=${F[inactive_exit_mono]}; xs=${F[exec_main_start_mono]}; ta=${F[timer_active_enter_mono]}
  (( ie < tm )) || { AO_WHY="record $rec: the unit entered inactive (monotonic $ie) after the dispatch ($tm): it stopped or failed between the dispatch and this invocation (a restart inside the timer's job)"; return 1; }
  (( tm <= ix && tm <= xs )) || { AO_WHY="record $rec: inactive-exit $ix or main start $xs (monotonic) precedes the dispatch $tm"; return 1; }
  (( ix - tm <= 5000000 && xs - tm <= 5000000 )) || { AO_WHY="record $rec: the unit left inactive $((ix - tm)) us and its main process started $((xs - tm)) us after the dispatch (more than 5 s)"; return 1; }
  # item 5: one record per dispatch
  shopt -s nullglob; recs=("$RD"/*.attest); shopt -u nullglob
  i=$(awk -v k="trigger_timer_realtime_usec=$tu" '$0 == k { c++ } END { print c + 0 }' "${recs[@]}" 2>/dev/null) \
    || { AO_WHY="the record directory $RD cannot be read in full"; return 1; }
  [ "$i" = 1 ] || { AO_WHY="$i records in $RD name the dispatch at $tu us (need exactly 1)"; return 1; }
  # item 6, information only (not a criterion)
  d=$((tm - ta)); if (( d >= 0 )); then d="$((d / 1000000)).$(( d % 1000000 / 100000 )) s"; else d="$d us"; fi
  AO_INFO="its start job was dispatched by afldb-backup.timer at $tu us = LastTriggerUSec (job ${F[job]}, JobType start; root record $rec, writer ${WS:0:16}, dump ${F[dump]} sha256 ${F[dump_sha256]:0:16}; main start $((xs - tm)) us after the dispatch, no stop or failure between); INFO, not a criterion: the dispatch came $d after afldb-backup.timer's last (re)activation"
  AO_DUMP=${F[dump]}; AO_DUMP_SHA=${F[dump_sha256]}
}

# The live reads for match_backup and attested_origin. Sets BR_EVID (match_backup's line), BR_JOURNAL (the MESSAGE text of the
# service's own lines, for pick_overnight_dump), BR_TUSEC, BR_ORIGIN (attested_origin's facts for the PASS line), BR_DUMP and
# BR_DUMP_SHA (the root record's dump binding: the callers require the picked dump's full re-hash to equal it) and BR_WHY; returns 0
# only when the run is attributed, origin included. Uses ts, timer_usec, read_invocation, backup_journal, match_backup, attested_origin.
scheduled_backup_run() { # B0 B1 node
  local bt btu bs be res xs jl jrc x bn bh
  BR_EVID=; BR_JOURNAL=; BR_WHY=; BR_TUSEC=; BR_ORIGIN=; BR_DUMP=; BR_DUMP_SHA=
  bt=$(ts afldb-backup.timer LastTriggerUSec); btu=$(timer_usec); BR_TUSEC=$btu; bs=$(ts afldb-backup.service ExecMainStartTimestamp); be=$(ts afldb-backup.service ExecMainExitTimestamp)
  res=$(systemctl show afldb-backup.service -p Result --value 2>/dev/null); xs=$(systemctl show afldb-backup.service -p ExecMainStatus --value 2>/dev/null)
  read_invocation afldb-backup.service || { BR_WHY="afldb-backup.service InvocationID: $RI_WHY"; return 1; }
  [ -x "$3" ] || { BR_WHY="node is not executable at $3: the journal cannot be read"; return 1; }
  jl=$(backup_journal "$1" "$(($2 + 906))" "$3"); jrc=$?
  BR_EVID=$(match_backup "$1" "$2" "$bt" "$bs" "$be" "$res" "$xs" "$RI_ID" "$jrc" "$jl" "$btu") || { BR_WHY=${BR_EVID#REASON }; BR_EVID=; return 1; }
  read -r x x x x x bn bh <<< "$BR_EVID"
  attested_origin "$RI_ID" "$btu" "$bn" "$bh" || { BR_WHY="scheduled origin unproven: $AO_WHY"; BR_EVID=; return 1; }
  BR_ORIGIN=$AO_INFO; BR_DUMP=$AO_DUMP; BR_DUMP_SHA=$AO_DUMP_SHA
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
  echo "PASS afldb-backup.service scheduled run: timer dispatch $(mel "$bt"), its start $(mel "$bs"), exit $(mel "$be"), Result=success status=0; invocation $bi alone in the window journal, 'backup ok' at $(mel "$bj"); $BR_ORIGIN"
  echo "BACKUP-EVIDENCE $BR_EVID"
  if PICK=$(pick_overnight_dump "$BK" "$DC" "$BR_JOURNAL"); then
    SDN=${PICK%% *}; SS=${PICK#* }
    if [ "$SDN ${SS:0:16}" != "$bn $bh" ]; then echo "FAIL scheduled dump $SDN ${SS:0:16} is not the dump the timer's invocation reported ($bn $bh)"; F=1
    elif [ "$SDN $SS" != "$BR_DUMP $BR_DUMP_SHA" ]; then
      echo "FAIL scheduled dump $SDN sha256 $SS is not the dump the root record bound ($BR_DUMP sha256 $BR_DUMP_SHA)"; F=1
    else
      echo "PASS scheduled dump unique, is the dump the timer's invocation $bi reported and its root record bound (full sha256), re-hash = sidecar: $SDN $(stat -c %s "$BK/$SDN") B"
      echo "OFFHOST-COMPARE $PICK"
    fi
  else echo "FAIL dump not attributable: ${PICK#REASON }"; F=1; fi
else
  echo "FAIL afldb-backup.service scheduled run is not attributed to the backup timer: $BR_WHY"; F=1
  echo "INFO the 02:2x dump is not examined and no OFFHOST-COMPARE line is printed: without an attributed timer run, origin included, no dump is the scheduled one"
fi
M=$(ls -1 "$BK"/.state/FAILED-* 2>/dev/null | tr '\n' ' '); [ -z "$M" ] && echo "PASS no FAILED marker" || { echo "FAIL FAILED marker(s): $M"; F=1; }
echo "INFO afldb-backup-verify.service last: $(systemctl show afldb-backup-verify.service -p Result -p ExecMainStatus -p ExecMainStartTimestamp --value | tr '\n' ' ')(record; not a G0 criterion)"
[ $F = 0 ] && echo "G0 PROD RESULT PASS: now on streamanator: r6-offhost-verify.sh $DAY <dump> <sha256> must exit 0" || { echo "G0 PROD RESULT FAIL: STOP, the release is deferred, production unchanged"; exit 1; }
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
