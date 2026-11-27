#!/usr/bin/bash
# g0-core.sh (R6 r7, MED-2): release gate G0, production half, run by the VERIFIER (uid afldb-verify), never by arm. ROOT-OWNED,
# pinned by SHA256SUMS; started only by afldb-verify-dispatch (`g0 <YYYY-MM-DD> <nonce>`). Read-only: no write, no database.
# Port of docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh (r6, 28 Nov) under DESIGN.md (r7) 3.5 and 5:
#   * origin AND dump come only from sealed_origin (the backup implementer's library, sourced from this bundle): the timer's start
#     job, the root seal, the root-published dump re-hashed in full and its root sidecar. r6's journal links (match_backup,
#     backup_journal through arm's ~/.nvm node, the "backup ok" line) and pick_overnight_dump over /home/arm/backups are NOT ported:
#     DESIGN 3.5 forbids reading any journal line or arm-owned path for origin or the dump, and the seal supersedes them;
#   * kept: the date and host checks, "no FAILED marker" (now two places: PID 1's Result= of afldb-backup.service, root, and arm's old
#     /home/arm/backups/afldb-scheduled/.state, where the weekly verify (arm) still writes; read through the root facts reader because
#     that directory is 0700 arm), the afldb-backup-verify.service INFO line;
#   * printed: PASS/FAIL/INFO lines, "DISPATCH <kind> <delay> s after timer activation", "BACKUP-EVIDENCE r7 ...", and
#     "OFFHOST-COMPARE <dump> <sha256>" only when sealed_origin holds; the dispatcher builds the RESULT line from the FIELD lines.
# Exit: 0 PASS, 1 STOP (a check failed), 2 usage/host/date.
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin
VB=/usr/local/lib/afldb-verify
. "$VB/lib.sh"; . "$VB/sealed-origin.sh"
DAY=${1:-}; [[ $DAY =~ ^2026-11-2[4-9]$ ]] || { echo "STOP usage: <YYYY-MM-DD Melbourne date of the run, 2026-11-24..29>"; exit 2; }
[ "$(host_name)" = afldb-prod ] && [ "$(id -un)" = afldb-verify ] || { echo "STOP not afldb-prod as afldb-verify"; exit 2; }
mel() { TZ=Australia/Melbourne date -d "@$1" '+%a %F %H:%M:%S %Z'; }
[ "$(TZ=Australia/Melbourne date +%F)" = "$DAY" ] || { echo "STOP today (Melbourne) is $(TZ=Australia/Melbourne date +%F), not $DAY"; exit 2; }
echo "== R7 G0 (verifier) $(date -u +%FT%TZ) local $(mel "$(date +%s)") day $DAY"
F=0
if sealed_origin "$DAY"; then
  echo "PASS afldb-backup.service scheduled run SEALED: timer dispatch $(mel "${SO_TIMER_USEC:0:${#SO_TIMER_USEC}-6}") ($SO_TIMER_USEC us), invocation $SO_INVOCATION, root seal $SO_SEAL; published dump $SO_DUMP $SO_BYTES B, full re-hash = seal = root sidecar"
  echo "DISPATCH $SO_DISPATCH_KIND $SO_DISPATCH_DELAY_S s after timer activation"
  echo "BACKUP-EVIDENCE r7 $SO_INVOCATION $SO_TIMER_USEC $SO_DUMP $SO_SHA $SO_DISPATCH_KIND $SO_SEAL"
  echo "OFFHOST-COMPARE $SO_DUMP $SO_SHA"
  field invocation "$SO_INVOCATION"; field dispatch "$SO_DISPATCH_KIND"
else
  echo "FAIL scheduled origin unproven: $SO_REASON"; F=1
  echo "INFO no dump is examined and no OFFHOST-COMPARE line is printed: without a sealed timer run no dump is the scheduled one"
fi
# FAILED markers. (1) the sealed run's failure record is PID 1's Result= of afldb-backup.service (R7/backup README item 6: the sealed
# install writes no root marker file; the root fact is the unit's result).
R=$(systemctl show afldb-backup.service -p Result --value 2>/dev/null)
if [ "$R" = success ]; then echo "PASS afldb-backup.service Result=success (PID 1: the last run did not fail)"
else echo "FAIL afldb-backup.service Result='$(san "$R" 40)' (PID 1): the last run failed"; F=1; fi
# (2) arm's old directory (ARM-PRODUCED evidence: the weekly verify runs as arm and writes its markers there).
if rootfacts g0; then
  if [ -z "${RF[failed_marker]:-}" ]; then echo "PASS no FAILED marker in /home/arm/backups/afldb-scheduled/.state (arm-produced evidence)"
  else echo "FAIL FAILED marker(s) in /home/arm/backups/afldb-scheduled/.state (arm-produced): $(san "$(tr '\n' ' ' <<< "${RF[failed_marker]}")" 300)"; F=1; fi
else echo "FAIL arm's backup state cannot be read: $RF_WHY"; F=1; fi
echo "INFO afldb-backup-verify.service last: $(systemctl show afldb-backup-verify.service -p Result -p ExecMainStatus -p ExecMainStartTimestamp --value 2>/dev/null | tr '\n' ' ')(record; not a G0 criterion)"
if [ "$F" = 0 ]; then
  field dump "$SO_DUMP"; field sha256 "$SO_SHA"
  echo "G0 PROD RESULT PASS: the wrapper now runs g0b on streamanator with the dump and sha256 of this RESULT line"
  exit 0
fi
echo "G0 PROD RESULT FAIL: STOP, the release is deferred, production unchanged"; exit 1
