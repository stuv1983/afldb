#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), runbook step (a): PRE-REBOOT verification. PRODUCTION (afldb-prod), as arm, ONE connection.
# READ-ONLY by construction: no sudo, no restart, no apt, and this script itself creates, changes or removes no file (no temp file,
# no redirection into a file; events.log is never written: `release.mjs status` runs WITHOUT --expect). One read-only database
# transaction through the backup role (ledger count and the afldb_restore_test catalog comment; no row data). What the services it
# queries may record is theirs, not A-2's: `release.mjs status` makes loopback GETs (/api/health, which asks the database, and the
# current and previous _buildManifest.js), so the application may write its ordinary request/health log lines to the afldb
# journal; PostgreSQL may log the read-only session if connection logging is on; sshd/PAM record the login itself.
# Every check prints PASS / FAIL / INFO / NOTE; any FAIL = R6 PRE RESULT STOP = do not reboot (runbook section 7, GO/NO-GO).
# Command inventory (closure allowlist): hostname id date cat uname uptime dpkg-query stat ls sed grep awk sort cut head tail tr wc basename
#   sha256sum cmp findmnt sysctl apt-config systemctl(show|is-active|is-enabled|list-timers|list-unit-files) pgrep readlink git(rev-parse)
#   journalctl (backup and verification units, bounded time windows, JSON output piped to node -e; read-only)
#   busctl (get-property only: afldb-backup.timer LastTriggerUSec in microseconds, read-only; R6 r5)
#   R6 r6: systemctl show also reads the backup unit's FragmentPath, DropInPaths, EnvironmentFiles and ExecStartPostEx and the timer's
#   FragmentPath and DropInPaths; stat, sha256sum and awk read (never write) the root-owned attestation: the writer
#   /usr/local/libexec/afldb/afldb-backup-attest, its drop-in, both unit files, every component of their paths, and the records in
#   /var/lib/afldb-backup-attest (attested_origin)
#   node deploy/release.mjs status (never --expect: that form writes events.log) | sh deploy/afldb-settle-failure-status.sh | bash tools/maintenance/scheduled-backup.sh status
#   psql (read-only shape of a2-p0-entry.sh) df free printf echo test; redirections only 2>&1, 2>/dev/null, here-strings, here-docs.
# Run (workstation Git Bash; never at minute :16-:18, when streamanator's r2 check connects):
#   bash "$STAGE/$B/r6-20261125/r6-pre-verify.sh" accepted <CURRENT_ID> r3:yes <r4:yes|no> <10:00|14:00> \
#      <tue:released|tue:rolledback|tue:deferred> <inv:ATTESTED_INVOCATION_ID>
#   All seven arguments are required (R6 r3 amendment). OUTCOME is always `accepted` for Tuesday's outcomes. CURRENT_ID, tue: and
#   inv: come from the Tuesday sitting record through r6-tuesday-handoff.sh, never from the live service or events.log:
#     tue:released    CURRENT_ID 17822b29e6de-<BUILD_ID from P3b>, inv: the owner-attested Tuesday restart (not Sunday's);
#     tue:rolledback  CURRENT_ID 7d92042fd110-XWruOm_9nLCSMY8nGPqYU, inv: the owner-attested rollback restart (not Sunday's);
#     tue:deferred    CURRENT_ID 7d92042fd110-XWruOm_9nLCSMY8nGPqYU, inv: Sunday's attested 342040625f6d4012a35d598dfbf9afe6.
#   Any other combination, a missing or extra argument, or a malformed ID is a usage STOP (exit 2). 14:00 = the fallback window.
#   The live `systemctl show afldb -p InvocationID` must equal inv: exactly; a failed read, an empty or malformed value or a
#   mismatch is a FAIL line, so R6 PRE RESULT STOP (exit 1). It is a separate read: the status gate below is unchanged by it.
#   R6 r4 (27 Nov 2026): that value is captured ONCE; the INVOCATION_ID line prints that same validated capture, and only when it
#   is valid and equals inv: (otherwise "INVOCATION_ID none ...", which r6-post-verify.sh refuses as PRE_INVOCATION_ID).
#   R6 r4: the 02:20 backup must be the backup TIMER's run (timer dispatch -> service invocation -> journal line -> dump; see
#   backup_journal below); a successful start in the window alone is a FAIL, and then no OFFHOST-COMPARE line is printed.
#   R6 r6 (28 Nov 2026): and that run must prove its ORIGIN from a ROOT record, not from anything arm writes: r5's "trigger:" journal
#   line came from the arm-owned scheduled-backup.sh and is no longer read. The pinned root writer (review-fixes-r6-20261128/attest/,
#   a full-privilege ExecStartPost of the unit) records, while the run's start job is live, that the job was created by
#   afldb-backup.timer at its LastTriggerUSec to the microsecond with no stop or failure of the unit in between; attested_origin
#   checks that record, the writer, the drop-in and every path they depend on (see backup_journal and attested_origin, with the
#   residual limits). Without the installed writer (production until the owner installs it) the FAIL reads "scheduled origin
#   unproven"; no dump is examined, no OFFHOST-COMPARE.
# Prints, for later steps: BOOT_ID, INVOCATION_ID, GRUB-BASELINE <sha256>, BACKUP-EVIDENCE <invocation> <timer> <start> <exit>
# <ok-line> <dump> <16 hex> (epochs), OFFHOST-COMPARE <dump> <sha256>, RESTORE-EVIDENCE, RESTORE-SHA <sha256>.
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

# R6 review finding 1 (23 Nov 2026): the serving-release check decides the A-2 verdict. `release.mjs status --expect` is NOT
# read-only (a live PASS appends a status-pass line to events.log, deploy/release.mjs:1539-1545), so A-2 runs `status` WITHOUT
# --expect, which writes nothing, and applies the expectation itself to the output and exit code of that ONE invocation: exit 0;
# exactly one result line ("release: STATUS PASS|FAIL ..."), and it is exactly "release: STATUS PASS <CURRENT_ID>"; and no
# "restarted since the last attested PASS" note (a restart after Tuesday's attested acceptance that nobody attested). Prints the
# output indented; sets SR_WHY to the reasons; returns 0 only when every condition holds. Run with cwd = the checkout.
# R6 r3 (Astra, 24 Nov 2026): a carriage return anywhere in the output STOPs, and every line that contains "STATUS PASS" or
# "STATUS FAIL" anywhere counts as a result line: "release: STATUS FAIL\r" followed by "release: STATUS PASS <id>" was one
# result line under the earlier "( |$)" pattern, so a CRLF FAIL beside an LF PASS passed.
serving_release() { # node current-id
  local out rc n
  SR_WHY=
  out=$("$1" deploy/release.mjs status 2>&1); rc=$?
  printf '%s\n' "$out" | sed 's/^/     /'
  [ "$rc" = 0 ] || SR_WHY="$SR_WHY; exit $rc"
  [[ $out != *$'\r'* ]] || SR_WHY="$SR_WHY; the output contains a carriage return"
  n=$(grep -cE 'STATUS (PASS|FAIL)' <<< "$out")
  [ "$n" = 1 ] || SR_WHY="$SR_WHY; $n result lines (need exactly 1)"
  grep -Fxq "release: STATUS PASS $2" <<< "$out" || SR_WHY="$SR_WHY; no line 'release: STATUS PASS $2'"
  ! grep -Fq 'restarted since the last attested PASS' <<< "$out" || SR_WHY="$SR_WHY; the service restarted since the last attested PASS"
  SR_WHY=${SR_WHY#; }
  [ -z "$SR_WHY" ]
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

# R6 r3 (Astra, 24 Nov 2026): plain `status` cannot see a restart after the attested PASS when events.log is unreadable or
# malformed, or when a later unconfirmed status-pass names the new InvocationID; it then reports PASS. So A-2 also compares the
# live InvocationID with the owner-attested ID passed in from the sitting record. R6 r4: the comparison uses read_invocation's
# single validated capture. Sets AI_WHY, and AI_ID to the live ID only when it is valid AND equals the attested one (the only
# value A-2 prints as INVOCATION_ID); returns 0 only then.
attested_invocation() { # attested-id
  AI_ID=; AI_WHY=
  if ! read_invocation afldb; then AI_WHY=$RI_WHY
  elif [ "$RI_ID" != "$1" ]; then AI_WHY="live InvocationID $RI_ID != owner-attested $1 (a restart nobody attested, or the wrong record)"
  else AI_ID=$RI_ID; fi
  [ -n "$AI_ID" ]
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

# R6 r5 (27 Nov 2026): the timer's LastTriggerUSec in MICROSECONDS. `systemctl show` prints whole seconds; the system bus gives the
# exact value to any user (busctl get-property, read-only). Prints the integer; prints nothing and returns 1 on any failure.
timer_usec() {
  local out
  out=$(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec 2>/dev/null) || return 1
  [[ $out =~ ^t\ ([1-9][0-9]{6,19})$ ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

# R6 r4 (review finding 2, 27 Nov 2026): "afldb-backup.service started in the 02:20 window and succeeded" is also true of a manual
# `systemctl start` in that window. The scheduled run is attributed in four links, all read-only and unprivileged:
#   timer -> invocation: afldb-backup.timer LastTriggerUSec lies in the window and the service's last ExecMainStartTimestamp is at
#     or after it and within 5 s; that run exited (ExecMainExitTimestamp) by window end + 15 min with Result=success, status 0;
#   invocation -> journal: the service's InvocationID (one validated read) is the _SYSTEMD_INVOCATION_ID that journald itself
#     attached to exactly one "backup ok" line logged by the service's own process between that start and exit (+5 s for
#     journald's receipt time), and NO other invocation of the unit appears in the journal from the window start to window end
#     + 15 min (a timer run that failed or was replaced, then a start by hand, is two invocations: ambiguous, STOP);
#   journal -> dump: that line's dump name and 16 hex are what pick_overnight_dump requires of the unique 02:2x file and sidecar;
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
# Residual limits (DESIGN.md 2 and 5): root (or sudo) can write any record, edit any trusted file or re-arm the timer; a manual
# re-arm of afldb-backup.timer or a Persistent= catch-up at boot IS a timer dispatch (the PASS line prints how long after the
# timer's last (re)activation the dispatch came, information only, for the owner to judge); this gate runs as arm, so a compromised
# arm login environment controls what it prints; the "backup ok" line and the dump are written by the attested run's own (arm) code,
# so the record proves which run it was, not what that run wrote; the writer needs systemd's Job ActivationDetails (systemd
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
# LastTriggerUSec in microseconds, both validated reads of the caller. Returns 0 and sets AO_INFO (record facts and the item-6
# information for the PASS line) only when every item holds; otherwise sets AO_WHY and returns 1. Read-only: systemctl show, stat,
# sha256sum, awk, and bash reads of the record; no write.
attested_origin() { # invocation timer-usec
  local inv=$1 tu=$2 W=/usr/local/libexec/afldb/afldb-backup-attest D=/etc/systemd/system/afldb-backup.service.d/60-afldb-backup-attest.conf
  local WS=35a0f3ac5de278784d39207cdf95173190627d5511343f2042a1a731f3d23c2d DS=2a3a067ef408377ccf6deae7c97c38366854c581a16e3f33ce2265787abc440e
  local RD=/var/lib/afldb-backup-attest X='/usr/bin/env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash --noprofile --norc /usr/local/libexec/afldb/afldb-backup-attest'
  local XF='ignore-failure privileged' N='(0|[1-9][0-9]{0,17})' out l p h rec i n=0 sz frag= drop= tfrag= tdrop= ef=0 ne=0 ex= argv= flags= ie tm ix xs ta d re
  local -a ps tps L recs K R; local -A F
  AO_WHY=; AO_INFO=
  [[ $inv =~ ^[0-9a-f]{32}$ && $tu =~ ^[1-9][0-9]{6,17}$ ]] || { AO_WHY="invalid invocation or LastTriggerUSec"; return 1; }
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
  for p in /usr/bin/env /usr/bin/bash /usr/bin/systemctl /usr/bin/busctl /usr/bin/sha256sum /usr/bin/timeout /usr/bin/mv "$W" "$D" \
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
    timer_active_enter_mono boot_id written_realtime_usec)
  R=('[0-9a-f]{64}' 'afldb-backup\.service' '[0-9a-f]{32}' '[1-9][0-9]{0,9}' '[a-z-]{1,32}' '[a-z-]{1,32}' '[a-z-]{1,32}' '[0-9]{1,3}'
    '[0-9]{1,3}' "$N" "$N" "$N" 'none|[A-Za-z0-9_.@:-]{1,255}' 'none|[1-9][0-9]{0,17}' "$N" "$N" "$N" '[0-9a-f]{32}' '[1-9][0-9]{15,17}')
  mapfile -t L 2>/dev/null < "$rec"
  [ "${#L[@]}" = 20 ] && [ "${L[0]}" = afldb-backup-attest/1 ] || { AO_WHY="record $rec is malformed (${#L[@]} lines, need the 20-line afldb-backup-attest/1 format)"; return 1; }
  n=22
  for i in "${!K[@]}"; do
    re="^${K[i]}=(${R[i]})\$"
    [[ ${L[i + 1]} =~ $re ]] || { AO_WHY="record $rec line $((i + 2)) is not ${K[i]}=<value>"; return 1; }
    F[${K[i]}]=${BASH_REMATCH[1]}; n=$((n + ${#L[i + 1]} + 1))
  done
  sz=$(stat -c %s -- "$rec" 2>/dev/null); [ "$sz" = "$n" ] || { AO_WHY="record $rec has $sz bytes, not the $n of its 20 lines"; return 1; }
  [ "${F[writer_sha256]}" = "$WS" ] || { AO_WHY="record $rec was written by writer ${F[writer_sha256]:0:16}..., not the pinned ${WS:0:16}..."; return 1; }
  [ "${F[invocation]}" = "$inv" ] || { AO_WHY="record $rec names invocation ${F[invocation]}, not the run's $inv"; return 1; }
  [ "${F[job_type]}" = start ] || { AO_WHY="record $rec: the run's job is a ${F[job_type]} job, not a start job"; return 1; }
  [ "${F[active_state]}/${F[sub_state]}" = activating/start-post ] || { AO_WHY="record $rec: the unit was ${F[active_state]}/${F[sub_state]} when attested, not activating/start-post"; return 1; }
  [ "${F[exec_main_code]}/${F[exec_main_status]}" = 1/0 ] || { AO_WHY="record $rec: ExecStart ended with code ${F[exec_main_code]} status ${F[exec_main_status]}, not exited 0"; return 1; }
  [ "${F[trigger_unit]}" = afldb-backup.timer ] || { AO_WHY="record $rec: the run's start job names trigger unit '${F[trigger_unit]}', not afldb-backup.timer (a start by hand, or by a dependency, carries no timer dispatch)"; return 1; }
  [ "${F[trigger_timer_realtime_usec]}" = "$tu" ] || { AO_WHY="record $rec: the run's start job records the dispatch at ${F[trigger_timer_realtime_usec]} us, but the timer's LastTriggerUSec is $tu us (an earlier or another dispatch)"; return 1; }
  [ "${F[timer_last_trigger_usec]}" = "$tu" ] || { AO_WHY="record $rec: the timer's LastTriggerUSec was ${F[timer_last_trigger_usec]} us when attested, $tu us now"; return 1; }
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
  AO_INFO="its start job was dispatched by afldb-backup.timer at $tu us = LastTriggerUSec (job ${F[job]}, JobType start; root record $rec, writer ${WS:0:16}; main start $((xs - tm)) us after the dispatch, no stop or failure between); INFO, not a criterion: the dispatch came $d after afldb-backup.timer's last (re)activation"
}

# The live reads for match_backup and attested_origin. Sets BR_EVID (match_backup's line), BR_JOURNAL (the MESSAGE text of the
# service's own lines, for pick_overnight_dump), BR_TUSEC, BR_ORIGIN (attested_origin's facts for the PASS line) and BR_WHY; returns 0
# only when the run is attributed, origin included. Uses ts, timer_usec, read_invocation, backup_journal, match_backup, attested_origin.
scheduled_backup_run() { # B0 B1 node
  local bt btu bs be res xs jl jrc
  BR_EVID=; BR_JOURNAL=; BR_WHY=; BR_TUSEC=; BR_ORIGIN=
  bt=$(ts afldb-backup.timer LastTriggerUSec); btu=$(timer_usec); BR_TUSEC=$btu; bs=$(ts afldb-backup.service ExecMainStartTimestamp); be=$(ts afldb-backup.service ExecMainExitTimestamp)
  res=$(systemctl show afldb-backup.service -p Result --value 2>/dev/null); xs=$(systemctl show afldb-backup.service -p ExecMainStatus --value 2>/dev/null)
  read_invocation afldb-backup.service || { BR_WHY="afldb-backup.service InvocationID: $RI_WHY"; return 1; }
  [ -x "$3" ] || { BR_WHY="node is not executable at $3: the journal cannot be read"; return 1; }
  jl=$(backup_journal "$1" "$(($2 + 906))" "$3"); jrc=$?
  BR_EVID=$(match_backup "$1" "$2" "$bt" "$bs" "$be" "$res" "$xs" "$RI_ID" "$jrc" "$jl" "$btu") || { BR_WHY=${BR_EVID#REASON }; BR_EVID=; return 1; }
  attested_origin "$RI_ID" "$btu" || { BR_WHY="scheduled origin unproven: $AO_WHY"; BR_EVID=; return 1; }
  BR_ORIGIN=$AO_INFO
  BR_JOURNAL=$(sed -n 's/^[0-9a-f]\{32\} [0-9]\{10\} own //p' <<< "$jl")
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
echo "== R6 PRE $(date -u +%FT%TZ) local $(mel "$(date +%s)") host=$(hostname) user=$(id -un) outcome=$OUTC current=$CUR $R3 $R4 window=$DAY $WIN $TUE attested=$ATT"
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
if attested_invocation "$ATT"; then echo "INVOCATION_ID $AI_ID"; ok "live InvocationID = the owner-attested $ATT (Tuesday ${TUE#tue:}; from the sitting record)"
else echo "INVOCATION_ID none (the live InvocationID was not validated: nothing to carry to F-2)"; bad "InvocationID: $AI_WHY"; fi
systemctl show afldb -p NRestarts -p MainPID -p ActiveEnterTimestamp --no-pager | sed 's/^/     /'
MAIN=$(systemctl show afldb -p MainPID --value); NW=0; [[ $MAIN =~ ^[1-9][0-9]*$ ]] && NW=$(pgrep -P "$MAIN" | wc -l)
[ "$NW" = 2 ] && ok "exactly 2 worker processes" || bad "worker processes $NW (expected 2)"
if cd "$CHK" 2>/dev/null; then
  [ "$(readlink "$ROOT/current")" = "releases/$CUR" ] && ok "current = $CUR" || bad "current = $(readlink "$ROOT/current") (expected $CUR)"
  info "previous = $(readlink "$ROOT/previous"); checkout HEAD $(git rev-parse HEAD 2>/dev/null)"
  if serving_release "$N" "$CUR"; then ok "release.mjs status (read-only): exit 0, one result line 'STATUS PASS $CUR', no unattested restart"
  else bad "release.mjs status does not prove $CUR is serving: $SR_WHY"; fi
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
  if scheduled_backup_run "$B0" "$B1" "$N"; then
    read -r bi bt bs be bj bn bh <<< "$BR_EVID"
    ok "afldb-backup.service scheduled run: timer dispatch $(mel "$bt"), its start $(mel "$bs"), exit $(mel "$be"), Result=success status=0; invocation $bi alone in the window journal, 'backup ok' at $(mel "$bj"); $BR_ORIGIN"
    echo "BACKUP-EVIDENCE $BR_EVID"
  else bad "afldb-backup.service scheduled run is not attributed to the backup timer: $BR_WHY"; fi
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
  if [ -z "$BR_EVID" ]; then info "the 02:2x dump is not examined and no OFFHOST-COMPARE line is printed: without an attributed timer run, origin included, no dump is the scheduled one"
  elif PICK=$(pick_overnight_dump "$BK" "$TODAYC" "$BR_JOURNAL"); then
    SDN=${PICK%% *}; SS=${PICK#* }
    if [ "$SDN ${SS:0:16}" = "$bn $bh" ]; then
      ok "scheduled 02:2x dump is unique, is the dump the timer's invocation $bi reported, re-hash = its sidecar: $SDN $(stat -c %s "$BK/$SDN") B"
      echo "OFFHOST-COMPARE $SDN $SS"
    else bad "scheduled 02:2x dump $SDN ${SS:0:16} is not the dump the timer's invocation reported ($bn $bh)"; fi
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
