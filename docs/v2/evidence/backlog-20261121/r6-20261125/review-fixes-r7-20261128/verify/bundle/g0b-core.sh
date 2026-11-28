#!/usr/bin/bash
# g0b-core.sh (R6 r7, MED-2): release gate G0, off-host half, run by the VERIFIER (uid afldb-verify) on streamanator, never by arm.
# ROOT-OWNED, pinned by SHA256SUMS; started only by afldb-verify-dispatch (`g0b <YYYY-MM-DD> <dump> <sha256> <nonce>`), which the
# workstation wrapper sends with the dump and sha256 taken ONLY from the authenticated G0a RESULT line. Read-only.
# Port of docs/v2/evidence/backlog-20261121/r6-20261125/r6-offhost-verify.sh plus the installed verifier it called,
# docs/v2/evidence/backlog-20261121/kits/scheduled-pull-evidence.sh (d7574254...), every check kept, same exits:
#   0 SCHEDULED-COPY-VERIFIED (the only PASS), 10 COPY-VERIFIED-ORIGIN-UNPROVEN, 1 COPY-FAILED, 2 usage.
# Substitutions: the copy, its sidecar and markers (/mnt/ssd/afldb-offhost-prod, 0700 arm), arm's crontab (the spool file, root
# only) and the wrapper's invocation log (/home/arm/afldb-ops/state, 0750 home) come from the ROOT facts reader (`g0b <date> <dump>`),
# hashed and read by root with O_NOFOLLOW on every component (arm-produced data, except the hash, which is of the bytes);
# `crontab -l` -> the spool file (the header comment lines crontab -l strips change neither count tested below);
# `journalctl -t CRON -o short-iso` -> afldb-verify-py journal-cron: STRENGTHENED, a dispatch line counts only when journald's
# trusted fields say a root process wrote it via syslog (_UID=0 kernel-attested, SYSLOG_IDENTIFIER=CRON, _TRANSPORT=syslog, SYSLOG_PID=_PID;
# not _COMM/_EXE: journald reads them from /proc after receipt and the cron child has exec'd /bin/sh by then), so a
# `logger -t CRON` line from any non-root user no longer counts; CRON_LOG_FILE (a retained export) is not supported (no environment passes).
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin
VB=/usr/local/lib/afldb-verify
. "$VB/lib.sh"
RC=0
finish() { # exit-code
  case $1 in
    0)  echo 'R6 OFFHOST RESULT PASS' ;;
    10) echo 'R6 OFFHOST RESULT COPY-VERIFIED-ORIGIN-UNPROVEN (not a PASS: record the gap; a retry cannot supply the missing scheduled evidence)' ;;
    *)  echo "R6 OFFHOST RESULT FAIL (verifier exit $1)" ;;
  esac
  exit "$1"
}
usage() { echo "FAIL scheduled pull: $*"; finish 2; }
DAY=${1:-}; D=${2:-}; S=${3:-}
[[ $DAY =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ && $S =~ ^[0-9a-f]{64}$ ]] || usage 'invalid date or checksum'
[[ $(TZ=Australia/Melbourne date -d "$DAY" +%F 2>/dev/null) = "$DAY" ]] || usage 'unparseable date'
[[ $D =~ ^afldb_prod-${DAY//-/}-02(2[0-9]|30)[0-5][0-9]\.dump$ ]] || usage 'wrong overnight dump/date (expected 02:20-02:30; the verification-service dump is never the overnight dump)'
[ "$(id -un)" = afldb-verify ] || usage 'not afldb-verify'
echo "== R7 G0B (verifier) $(date -u +%FT%TZ) host=$(host_name) day $DAY dump $D sha256 $S"
failed() { echo "FAIL scheduled pull: $*"; echo 'RESULT COPY-FAILED'; finish 1; }
unproven() {
  echo "UNPROVEN scheduled origin: $*"
  echo "OFFHOST-COMPARE $D $S"
  echo 'RESULT COPY-VERIFIED-ORIGIN-UNPROVEN'
  finish 10
}
rootfacts g0b "$DAY" "$D" || failed "the root facts reader failed: $RF_WHY"

# ---- A. The copy itself (independent of cron)
[[ ${RF[dump_size]:-0} =~ ^[1-9][0-9]*$ && ${RF[verified_marker]:-} = yes ]] || failed 'dump or verified marker missing'
[ "${RF[retention_hold]:-}" = no ] || failed 'active retention hold'
[ "${RF[sidecar_lines]:-}" = 1 ] || failed 'sidecar missing or multiline'
awk -v h="$S" -v n="$D" 'NF==2 && $1==h {sub(/^\*/, "", $2); if ($2==n) good=1} END {exit !good}' <<< "${RF[sidecar_line]:-}" || failed 'sidecar dump/checksum differs from production'
[[ ${RF[dump_sha256]:-} = "$S" ]] || failed 'recomputed off-host checksum differs from production'
echo "COPY VERIFIED $D sha256=$S (bytes re-hashed by the root facts reader, named sidecar, verified marker, no hold) [the bytes: root re-hash; sidecar, marker and hold: ARM-PRODUCED]"

# ---- B. The scheduled origin
SCHED='10 3 * * *'
CMD='AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh'
LINE="$SCHED $CMD"
[ "${RF[crontab_readable]:-}" = yes ] || unproven 'crontab unreadable: schedule not verified'
CT=${RF[crontab_line]:-}
[[ $(grep -cxF "$LINE" <<< "$CT") = 1 ]] &&
  grep -A1 '^# AFLDB-A2-r3' <<< "$CT" | grep -qxF "$LINE" || unproven 'cron r3 marker+job pair missing or ambiguous in the crontab'
echo "SCHEDULE crontab pair present: $SCHED [ARM-PRODUCED: read from the root-only spool, but arm edits its crontab]"
W0=$(TZ=Australia/Melbourne date -d "$DAY 03:10" +%s); W1=$((W0+60)); DEADLINE=$((W0+2100))
J=$(timeout -k 5 120 "$PY" -I -S "$VPY" journal-cron "$W0" "$W1") || unproven 'cron journal unreadable'
dpid=(); dtime=()
while read -r e rest; do
  # e = journald's receipt time (epoch s); rest = "CRON[<_PID>]: <MESSAGE>", emitted only for entries the cron daemon wrote.
  [[ $rest == *"(arm) CMD ($CMD)" ]] || continue
  [[ $e =~ ^[0-9]{10}$ ]] || continue
  (( e >= W0 && e < W1 )) || continue
  [[ $rest =~ ^CRON\[([0-9]+)\]: ]] || continue
  dpid+=("${BASH_REMATCH[1]}"); dtime+=("$e")
done <<< "$J"
[[ ${#dpid[@]} -ge 1 ]] || unproven "no 03:10 cron dispatch of the r3 command in the journal for $DAY"
[[ ${#dpid[@]} = 1 ]] || unproven "ambiguous 03:10 cron dispatch for $DAY (count=${#dpid[@]})"
echo "DISPATCH journal: pid=${dpid[0]} at $(TZ=Australia/Melbourne date -d "@${dtime[0]}" +'%F %T %Z') (a root syslog entry: _UID=0, SYSLOG_PID=_PID)"
[ "${RF[pull_log_readable]:-}" = yes ] || unproven 'invocation log missing'
LOGL=${RF[pull_log]:-}
matches=()
while read -r bst tag run cp lin; do
  [[ $tag == BEGIN && $run == run=* && $cp == cron_pid=* && $lin == lineage=* ]] || continue
  b=$(date -d "$bst" +%s 2>/dev/null) || continue
  (( b >= dtime[0] - 5 && b < W1 )) || continue
  IFS=, read -ra ents <<< "${lin#lineage=}"
  hit=0; croncomm=0
  for ent in "${ents[@]}"; do
    IFS=: read -r ep ec es <<< "$ent"
    if (( hit == 0 )) && [[ $ep == "${dpid[0]}" && $es =~ ^[0-9]+$ ]] && (( es >= dtime[0] - 5 && es <= dtime[0] + 5 )); then hit=1; fi
    if (( hit == 1 )) && [[ ${ec,,} == cron ]]; then croncomm=1; fi
  done
  (( hit == 1 && croncomm == 1 )) && matches+=("$run $b")
done < <(awk '$2=="BEGIN" && NF==5' <<< "$LOGL")
[[ ${#matches[@]} -ge 1 ]] || unproven 'no wrapper invocation links to this dispatch (a manual run, an invocation logged before lineage recording, or a recycled PID)'
[[ ${#matches[@]} = 1 ]] || unproven 'more than one wrapper invocation links to this dispatch'
read -r run start <<< "${matches[0]}"
echo "INVOCATION linked to dispatch: $(san "$run" 80) (lineage contains pid ${dpid[0]}, started within 5 s of the journal record) [ARM-PRODUCED: the pull log is arm's; the dispatch is root cron's journald record]"
mapfile -t E < <(awk -v r="$run" '$2=="END" && $3==r && NF==4' <<< "$LOGL")
[[ ${#E[@]} = 1 ]] || failed "scheduled invocation $(san "$run" 80) has no unique completion record (not finished, or crashed); a retry cannot replace it"
read -r et tag er rc <<< "${E[0]}"
fin=$(date -d "$et" +%s 2>/dev/null) || failed 'invalid completion timestamp'
(( fin >= start && fin <= DEADLINE && fin <= $(date +%s) )) || failed 'stale, late or future completion'
[[ $rc = rc=0 ]] || failed "scheduled invocation failed ($(san "$rc" 20)); a later retry cannot replace it"
mapfile -t V < <(awk -v r="$run" -v d="dump=$D" -v s="sha256=$S" '$2=="VERIFIED" && $3==r && $4==d && $5==s && NF==5' <<< "$LOGL")
[[ ${#V[@]} = 1 ]] || unproven "the scheduled invocation succeeded but did not itself verify $D with this checksum"
vtime=$(date -d "${V[0]%% *}" +%s 2>/dev/null) || unproven 'invalid verification time'
(( vtime >= start && vtime <= fin )) || unproven 'verification record lies outside the invocation'
echo "PASS scheduled pull date=$DAY dispatch_pid=${dpid[0]} $(san "$run" 80) completion=$(san "$et" 40) rc=0 [ARM-PRODUCED: invocation, completion and VERIFIED lines are arm's pull log]"
echo "OFFHOST-COMPARE $D $S"
echo 'RESULT SCHEDULED-COPY-VERIFIED'
finish 0
