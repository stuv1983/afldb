#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r5, 27 Nov 2026). Astra's case against any pair of gate scripts, through each gate's REAL main, as arm.
#   The backup timer dispatched at 02:20:00. Its invocation failed and left nothing arm can read (a failed dependency or an exec
#   failure is logged by PID 1 only). A start by hand at 02:20:03 then succeeded: valid dump, sidecar, digest, one visible
#   invocation with its own "target:" and "backup ok" lines. Nothing is deleted to make the case easy.
# Where: as ROOT inside a disposable container (pinned image, --network none, --hostname afldb-prod, pinned node mounted at
# /home/arm/.nvm/versions/node/v22.23.2), exactly as cases/f2-backup-attribution.sh runs. It uses that suite's fixture library
# (cases/lib-f23-fixture.sh): the f23 shims for systemctl, journalctl, busctl and date; the gates themselves are the REAL files.
# Usage: bash astra-case.sh <FIX> <G0-script> <A2-script> <label> [r5-script]
#   r5-script: the hand-started invocation logs the r5 trigger line (its start job has no timer details: unit=none), as the prospective
#   scheduled-backup.sh would write it; without it the journal is what today's production script writes (no trigger line at all).
# Prints, per gate: the exit code, every PASS/FAIL line about the backup, BACKUP-EVIDENCE, OFFHOST-COMPARE and the result line.
set -uo pipefail; export LC_ALL=C
FIX=${1:?FIX}; G0=${2:?G0 script}; PRE=${3:?A-2 script}; LABEL=${4:?label}; MODE=${5:-}   # r5-script | (empty = today's production script)
H4=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r4-20261127
. "$FIX/$H4/cases/lib-f23-fixture.sh"
TMP=$(mktemp -d); trap 'f23_service_stop; rm -rf "$TMP"' EXIT
f23_setup "$FIX" > "$TMP/setup.out" 2>&1 || { echo "STOP fixture: $(tail -n 1 "$TMP/setup.out")"; exit 1; }
[ "$MODE" = r5-script ] || F23_SCRIPT=current   # current = today's production script: it logs no trigger line at all
f23_scenario astra || exit 1
chmod 644 /fx/journal-backup.json /fx/journal-backup.txt
echo "== astra-case $LABEL $(/usr/bin/date -u +%FT%TZ) host=$(hostname) mode=${MODE:-current-production-script} (F23_SCRIPT=${F23_SCRIPT:-r5})"
echo "   G0 $(sha256sum < "$G0" | cut -c1-64)"; echo "   A-2 $(sha256sum < "$PRE" | cut -c1-64)"
echo "   fixture: timer LastTriggerUSec 02:20:00; the only visible invocation $F23_BINV2 started 02:20:03 (+3 s), exit 02:20:25, success, status 0"
echo "   fixture journal (what arm reads):"; sed 's/"__REALTIME_TIMESTAMP"/\n"__REALTIME_TIMESTAMP"/;' /fx/journal-backup.txt | sed 's/^/     /'
echo "   dump $F23_SD sidecar ok; PID 1's lines about the timer's own failed invocation are not readable by arm"
for g in g0 a2; do
  case $g in
    g0) OUT=$(f23_as_arm bash "$G0" "$F23_DAY" 2>&1); RC=$?;;
    a2) OUT=$(f23_as_arm bash "$PRE" accepted "$F23_CUR" r3:yes "$F23_R4" 10:00 tue:released "inv:$F23_INV_TUE" 2>&1); RC=$?;;
  esac
  echo "-- $g: exit $RC"
  grep -E '^(PASS afldb-backup\.service scheduled run|FAIL afldb-backup\.service|FAIL scheduled|FAIL dump|BACKUP-EVIDENCE|OFFHOST-COMPARE|INFO the 02:2x dump|G0 PROD RESULT|R6 PRE RESULT)' <<< "$OUT" | cut -c1-330 | sed 's/^/   /'
  echo "   (OFFHOST-COMPARE lines: $(grep -c '^OFFHOST-COMPARE ' <<< "$OUT"); FAIL lines in all: $(grep -c '^FAIL' <<< "$OUT"))"
done
