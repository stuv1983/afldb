#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r4, 27 Nov 2026). Suite f2: review finding 2, scheduled backup attribution, at BOTH gates:
#   G0   <FIX>/docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh          (main, run as arm; day 2026-11-25)
#   A-2  <STAGE>/docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh section 5 (main, run as arm, all 7 arguments)
# Where: as ROOT inside a disposable container (pinned Ubuntu 24.04 image, --network none, --rm, --hostname afldb-prod, the
# pinned node mounted read-only at /home/arm/.nvm/versions/node/v22.23.2). It needs root to create the user arm, the shims in
# /usr/local/bin and the fixture files at the absolute paths the gates read (cases/lib-f23-fixture.sh); the container is the
# sandbox, so those live outside the suite's own mktemp directory (which holds only its scratch output and is removed on exit).
# The REAL script bytes under <FIX>/<STAGE> are executed, never a copy: main through the shims, and the shared functions through
# the R1_LIB_ONLY seam of r1-g0-dump.sh (they are asserted byte-identical to r6-pre-verify.sh's, which has no such seam).
# Contrast: the aa33f0fc scripts (default <FIX>/<this round>/orig-aa33f0fc/; F2_ORIG_G0 / F2_ORIG_PRE override) PASS the three
# start-by-hand fixtures at both gates: the defect.
# A-2 here uses the Tuesday outcome `released` with a stub release.mjs (finding 2 is about section 5 only); every other A-2
# check passes on the fixture, so an A-2 STOP below has exactly ONE FAIL line and it must carry the expected reason.
# R6 r5 (27 Nov 2026, Astra's re-review of f92d6e29): the timing and journal links also hold for a start by hand 3 s after a timer
# dispatch whose own run failed where arm cannot read it (PID 1 alone logs a failed dependency or an exec failure). The gates now
# also require the ORIGIN: exactly one "trigger:" line of the SAME invocation naming unit=afldb-backup.timer with a realtime_usec equal
# to the timer's LastTriggerUSec in microseconds (busctl). This suite adds, to every case above: Astra's case through both mains
# (STOP "scheduled origin unproven", no OFFHOST-COMPARE; the f92d6e29 gates PASS it: contrast, F2_F92_G0 / F2_F92_PRE, default
# <FIX>/<r5 dir>/orig-f92d6e29/), the same case with a later off-host copy present (never read: atime), today's production script
# (no trigger line: STOP), a genuine run with the line (PASS), hostile and malformed trigger lines, busctl failures, a hand run in a
# session scope, and direct match_backup / timer_usec boundary cases. The real-systemd proofs are in review-fixes-r5-20261127/.
# R6 r6 (28 Nov 2026, review-fixes-r6-20261128/DESIGN.md): the r5 trigger line came from the arm-owned scheduled-backup.sh, so arm
# could forge it (r5 challenger, MED). It is WITHDRAWN: the gates no longer read it and it counts toward nothing; origin comes from
# the ROOT writer's record, checked by attested_origin. The fixture (lib-f23-fixture.sh) installs the REAL reviewed writer and drop-in
# and the real unit files as root-owned files at their real paths, and the gates run as arm, so trust is never shimmed. Changes here:
#   * the genuine state is production's script (no trigger line) plus the root record; the trigger-* states that STOPped under r5
#     (stale, off by 1 us, whole seconds, two lines, timer and none, another invocation field, another unit, malformed, note only)
#     and genuine-current-script now PASS: a trigger line, right or wrong, changes nothing (expected outcome changed, by design);
#   * the astra* states STOP on the hand start's ROOT record (trigger_unit=none): expected text gained "record <path>: ";
#   * F23_ATTEST_STOP_SCENARIOS: no install, a forged trigger line with no record, every refusal of DESIGN.md 4 items 1-5, malformed
#     records; F23_PASS_SCENARIOS adds the measured real ordering (inactive-exit after the main start), the 5 s edge, a first run since
#     boot, other records and a leftover temporary file, and a re-armed timer (item 6 is information only);
#   * contrasts: the 624bf721 (r5) gates PASS the forged-trigger states (F2_R5_G0 / F2_R5_PRE, default <FIX>/<r6 dir>/orig-624bf721/);
#   * match_backup no longer requires or counts a trigger line: the mb-origin-* cases built on trigger-line content now expect rc 0
#     (named at the mbc block), the LastTriggerUSec-in-microseconds checks it keeps are unchanged; bj-genuine has 2 lines (no trigger line).
# Usage: bash cases/f2-backup-attribution.sh <FIX> [<STAGE>]
set -uo pipefail; export LC_ALL=C
FIX=${1:?usage: f2-backup-attribution.sh <FIX> [<STAGE>]}; STAGE=${2:-$FIX}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
. "$HERE/lib-f23-fixture.sh"
B=docs/v2/evidence/backlog-20261121; H4=$B/r6-20261125/review-fixes-r4-20261127
PRE=$STAGE/$B/r6-20261125/r6-pre-verify.sh; G0=$FIX/docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh
OPRE=${F2_ORIG_PRE:-$FIX/$H4/orig-aa33f0fc/r6-pre-verify.sh}; OG0=${F2_ORIG_G0:-$FIX/$H4/orig-aa33f0fc/r1-g0-dump.sh}
H5=$B/r6-20261125/review-fixes-r5-20261127
FPRE=${F2_F92_PRE:-$FIX/$H5/orig-f92d6e29/r6-pre-verify.sh}; FG0=${F2_F92_G0:-$FIX/$H5/orig-f92d6e29/r1-g0-dump.sh}
H6=$B/r6-20261125/review-fixes-r6-20261128
RPRE=${F2_R5_PRE:-$FIX/$H6/orig-624bf721/r6-pre-verify.sh}; RG0=${F2_R5_G0:-$FIX/$H6/orig-624bf721/r1-g0-dump.sh}
N=0; U=0
okc() { echo "CASE-RESULT f2-$1 OK ($2 ; got $3)"; N=$((N+1)); }
unx() { echo "CASE-RESULT f2-$1 UNEXPECTED ($2 ; got $3)"; U=$((U+1)); }
finish() { if [ "$U" = 0 ]; then echo "SUITE f2 RESULT PASS ($N cases)"; exit 0; else echo "SUITE f2 RESULT FAIL ($U unexpected)"; exit 1; fi; }
TMP=$(mktemp -d) || { echo "CASE-RESULT f2-setup UNEXPECTED (mktemp ; got failure)"; U=1; finish; }
trap 'f23_service_stop; rm -rf "$TMP"' EXIT
for f in "$PRE" "$G0" "$OPRE" "$OG0" "$FPRE" "$FG0" "$RPRE" "$RG0"; do [ -f "$f" ] || { unx setup "script present" "missing $f"; finish; }; done
f23_setup "$FIX" > "$TMP/setup.out" 2>&1 || { unx setup "fixture built" "$(tail -n 1 "$TMP/setup.out")"; finish; }
echo "== f2 $(/usr/bin/date -u +%FT%TZ) host=$(hostname) G0 $(sha256sum < "$G0" | cut -c1-16) A-2 $(sha256sum < "$PRE" | cut -c1-16) orig G0 $(sha256sum < "$OG0" | cut -c1-16) orig A-2 $(sha256sum < "$OPRE" | cut -c1-16) f92d6e29 G0 $(sha256sum < "$FG0" | cut -c1-16) A-2 $(sha256sum < "$FPRE" | cut -c1-16) 624bf721 G0 $(sha256sum < "$RG0" | cut -c1-16) A-2 $(sha256sum < "$RPRE" | cut -c1-16); installed writer $(sha256sum < "$F23_ATT_W" | cut -c1-16) drop-in $(sha256sum < "$F23_ATT_D" | cut -c1-16)"

OUT=; RC=
gate() { # g0|a2 script
  case $1 in
    g0) OUT=$(f23_as_arm bash "$2" "$F23_DAY" 2>&1); RC=$?;;
    a2) OUT=$(f23_as_arm bash "$2" accepted "$F23_CUR" r3:yes "$F23_R4" 10:00 tue:released "inv:$F23_INV_TUE" 2>&1); RC=$?;;
  esac
}
verdict() { grep -E '^(G0 PROD RESULT|R6 PRE RESULT) ' <<< "$OUT" | cut -c1-24 | head -1; }
got() { local f; f=$(grep -m1 -E -- "${1:-^FAIL}" <<< "$OUT" | cut -c1-230); [ -n "$f" ] || f=$(grep -m1 '^FAIL' <<< "$OUT" | cut -c1-230)
  echo "exit $RC, $(grep -c '^FAIL' <<< "$OUT") FAIL line(s), '$(verdict)', $(grep -c '^OFFHOST-COMPARE ' <<< "$OUT") OFFHOST-COMPARE line(s)${f:+, $f}"; }
want_pass() { # case gate script inv
  local v; case $2 in g0) v='G0 PROD RESULT PASS:';; a2) v='R6 PRE RESULT PASS';; esac
  gate "$2" "$3"
  if [ "$RC" = 0 ] && [ "$(grep -c '^FAIL' <<< "$OUT")" = 0 ] && [[ "$(verdict)" == "$v"* ]] \
     && grep -q "^PASS afldb-backup\.service scheduled run: timer dispatch .* invocation $4 alone in the window journal" <<< "$OUT" \
     && grep -q "^BACKUP-EVIDENCE $4 [0-9]* [0-9]* [0-9]* [0-9]* $F23_SD ${F23_SS:0:16}\$" <<< "$OUT" \
     && grep -q "its start job was dispatched by afldb-backup\.timer at $F23_TRIG_US us = LastTriggerUSec (job [0-9]*, JobType start; root record /var/lib/afldb-backup-attest/$4\.attest, writer [0-9a-f]*; main start [0-9]* us after the dispatch, no stop or failure between); INFO, not a criterion: the dispatch came [0-9.]* s after afldb-backup\.timer's last (re)activation" <<< "$OUT" \
     && [ "$(grep '^OFFHOST-COMPARE ' <<< "$OUT")" = "OFFHOST-COMPARE $F23_SD $F23_SS" ]; then
    okc "$1" "exit 0, no FAIL, $v, timer run attributed to $4 by its root record, OFFHOST-COMPARE of the fixture dump" "$(got)"
  else unx "$1" "exit 0, no FAIL, $v, timer run attributed by its root record, OFFHOST-COMPARE" "$(got)"; fi
}
want_stop() { # case gate script reason-regex
  local v; case $2 in g0) v='G0 PROD RESULT FAIL';; a2) v='R6 PRE RESULT STOP';; esac
  gate "$2" "$3"
  if [ "$RC" = 1 ] && [ "$(grep -c '^FAIL' <<< "$OUT")" = 1 ] && [[ "$(verdict)" == "$v"* ]] && grep -Eq -- "^FAIL .*$4" <<< "$OUT" \
     && ! grep -q '^OFFHOST-COMPARE' <<< "$OUT"; then
    okc "$1" "exit 1, $v, exactly 1 FAIL line matching /$4/, no OFFHOST-COMPARE" "$(got "^FAIL .*$4")"
  else unx "$1" "exit 1, $v, exactly 1 FAIL line matching /$4/, no OFFHOST-COMPARE" "$(got "^FAIL .*$4")"; fi
}
want_false_pass() { # case gate orig-script: an ORIGINAL gate (aa33f0fc, or f92d6e29 for the r5 cases) accepts a start by hand
  local v; case $2 in g0) v='G0 PROD RESULT PASS:';; a2) v='R6 PRE RESULT PASS';; esac
  gate "$2" "$3"
  if [ "$RC" = 0 ] && [[ "$(verdict)" == "$v"* ]] && grep -Eq '^PASS afldb-backup\.service scheduled run[: ]' <<< "$OUT" \
     && [ "$(grep '^OFFHOST-COMPARE ' <<< "$OUT")" = "OFFHOST-COMPARE $F23_SD $F23_SS" ]; then
    okc "$1" "the original script exits 0 with PASS and prints OFFHOST-COMPARE for the hand-started dump (the false PASS)" "$(got)"
  else unx "$1" "the original script exits 0 with PASS (defect reproduced)" "$(got)"; fi
}

echo "-- shared functions: byte-identical in both gates; pick_overnight_dump unchanged from aa33f0fc"
same=1; list=
for fn in pick_overnight_dump ts timer_usec read_invocation backup_journal match_backup trusted_path attested_origin scheduled_backup_run; do
  a=$(f23_fn "$G0" "$fn" | sha256sum | cut -c1-16); b=$(f23_fn "$PRE" "$fn" | sha256sum | cut -c1-16)
  [ -n "$(f23_fn "$G0" "$fn")" ] && [ "$a" = "$b" ] || same=0; list="$list $fn=$a/$b"
done
[ "$same" = 1 ] && okc fn-identical "nine shared function bodies hash the same in r1-g0-dump.sh and r6-pre-verify.sh" "${list# }" \
  || unx fn-identical "nine shared function bodies hash the same" "${list# }"
same=1; list=
for fn in pick_overnight_dump ts timer_usec read_invocation backup_journal; do   # r6 changed only match_backup and scheduled_backup_run
  a=$(f23_fn "$G0" "$fn" | sha256sum | cut -c1-16); b=$(f23_fn "$RG0" "$fn" | sha256sum | cut -c1-16); [ "$a" = "$b" ] || same=0; list="$list $fn=$a/$b"
done
[ "$same" = 1 ] && okc fn-unchanged-624bf721 "five shared functions are byte-identical to the 624bf721 (r5) bodies" "${list# }" \
  || unx fn-unchanged-624bf721 "five shared functions unchanged from 624bf721" "${list# }"
grep -q 'trigger:' <<< "$(f23_fn "$G0" match_backup; f23_fn "$G0" scheduled_backup_run; f23_fn "$G0" attested_origin)" \
  && unx no-trigger-rule "no shared origin function mentions a trigger: line" "found" || okc no-trigger-rule "no shared origin function mentions a trigger: line" "none"
n=$(grep -cE "^  local WS=[0-9a-f]{64} DS=[0-9a-f]{64}\$" "$G0"); m=$(grep -c "@@" "$G0" "$PRE" | awk -F: '{s+=$2} END {print s}')
w=$(sha256sum < "$F23_ATT_W" | cut -c1-64); d=$(sha256sum < "$F23_ATT_D" | cut -c1-64)
[ "$n" = 1 ] && [ "$m" = 0 ] && grep -q "^  local WS=$w DS=$d\$" "$G0" && grep -q "^  local WS=$w DS=$d\$" "$PRE" \
  && okc pins-real "both gates pin the installed (reviewed) writer $w and drop-in $d; no placeholder" "WS ${w:0:16} DS ${d:0:16}" \
  || unx pins-real "both gates pin the reviewed writer and drop-in" "pin lines $n, placeholders $m"
a=$(f23_fn "$G0" pick_overnight_dump | sha256sum | cut -c1-16); b=$(f23_fn "$OG0" pick_overnight_dump | sha256sum | cut -c1-16)
[ "$a" = "$b" ] && okc pick-unchanged "pick_overnight_dump body = the aa33f0fc body" "$a = $b" || unx pick-unchanged "pick_overnight_dump body = the aa33f0fc body" "$a != $b"
b=$(f23_fn "$FG0" pick_overnight_dump | sha256sum | cut -c1-16)
[ "$a" = "$b" ] && okc pick-unchanged-f92d6e29 "pick_overnight_dump body = the f92d6e29 body" "$a = $b" || unx pick-unchanged-f92d6e29 "pick_overnight_dump body = the f92d6e29 body" "$a != $b"

echo "-- G0 and A-2 main on each fixture state"
for g in g0 a2; do
  case $g in g0) S=$G0; O=$OG0; FO=$FG0; RO=$RG0;; a2) S=$PRE; O=$OPRE; FO=$FPRE; RO=$RPRE;; esac
  for sc in "${F23_PASS_SCENARIOS[@]}"; do         # r6: includes the trigger-* states that STOPped under r5 (a trigger line counts toward nothing)
    f23_scenario "$sc" > /dev/null || { unx "$g-$sc" "scenario built" "unknown scenario"; continue; }
    want_pass "$g-$sc" "$g" "$S" "$F23_BINV"
  done
  for sc in manual-no-timer timer-failed-then-manual manual-within-5s ok-line-other-invocation two-invocations pid1-other-invocation \
      binv-fail binv-empty binv-malformed binv-multi journal-fail journal-malformed journal-no-invocation no-timer-property \
      timer-run-failed no-completion no-ok-line two-ok-lines ok-line-after-run no-dump two-dumps bad-sidecar journal-other-name journal-other-hash \
      astra astra-current-script astra-with-hand-run-lines timer-trigger-then-fail-manual-3s trigger-after-run busctl-fail busctl-garbage busctl-empty \
      "${F23_ATTEST_STOP_SCENARIOS[@]}"; do
    f23_scenario "$sc" > /dev/null || { unx "$g-$sc" "scenario built" "unknown scenario"; continue; }
    want_stop "$g-$sc" "$g" "$S" "$(f23_reason "$sc")"
    case $sc in manual-no-timer|timer-failed-then-manual|manual-within-5s) want_false_pass "$g-$sc-aa33f0fc" "$g" "$O";; esac
    case $sc in astra|astra-current-script|astra-with-hand-run-lines) want_false_pass "$g-$sc-f92d6e29" "$g" "$FO";; esac   # the f92d6e29 gates PASS Astra's case
    case $sc in attest-forged-trigger-no-record|attest-astra-forged-trigger) want_false_pass "$g-$sc-624bf721" "$g" "$RO";; esac   # the r5 gates PASS a forged line
  done
  # Astra's case with the 03:10 off-host pull already holding the hand-started dump: STOP, and no gate read the copy (atime)
  f23_scenario astra-offhost-later > /dev/null
  oa=(); for f in "$F23_OFF/$F23_SD" "$F23_OFF/$F23_SD.sha256" "$F23_OFF/.last-pull"; do oa+=("$(stat -c %X "$f")"); done
  want_stop "$g-astra-offhost-later" "$g" "$S" "$(f23_reason astra-offhost-later)"
  na=(); for f in "$F23_OFF/$F23_SD" "$F23_OFF/$F23_SD.sha256" "$F23_OFF/.last-pull"; do na+=("$(stat -c %X "$f")"); done
  if [ "${oa[*]}" = "${na[*]}" ]; then
    cat "$F23_OFF/$F23_SD" > /dev/null; bump=$(stat -c %X "$F23_OFF/$F23_SD")        # instrument self-test: a read DOES change the atime here
    if [ "$bump" != "${oa[0]}" ]; then okc "$g-astra-offhost-not-read" "no gate read the off-host copy or the pull stamp (atimes unchanged; a read bumps them)" "atimes ${oa[*]}"
    else unx "$g-astra-offhost-not-read" "atime instrument works (a read changes it)" "atime did not change on a deliberate read"; fi
  else unx "$g-astra-offhost-not-read" "no gate read the off-host copy" "atimes before ${oa[*]} after ${na[*]}"; fi
  rm -rf "$F23_OFF"
  # the f92d6e29 gates against Astra's case with the copy present too
  f23_scenario astra-offhost-later > /dev/null; want_false_pass "$g-astra-offhost-later-f92d6e29" "$g" "$FO"; rm -rf "$F23_OFF"
done

echo "-- match_backup directly (R1_LIB_ONLY seam of r1-g0-dump.sh, as arm): the boundaries"
B0=$(f23_ep "$F23_DAY 02:20:00"); B1=$(f23_ep "$F23_DAY 02:31:00"); I=$F23_BINV; D=afldb_prod-$F23_DAYC-022001.dump
TU=$((B0 * 1000000 + 123456))
jl() { # ok-epoch [usec [unit [trigger-epoch]]]: the run's trigger line (default: unit=afldb-backup.timer, the dispatch at TU, logged at B0+1)
  # and its "backup ok" line at <ok-epoch>, as backup_journal prints them
  printf '%s %s own 2026-11-24T15:20:01Z scheduled-backup: trigger: invocation=%s job=4242 unit=%s realtime_usec=%s\n' "$I" "${4:-$((B0 + 1))}" "$I" "${3:-afldb-backup.timer}" "${2:-$TU}"
  printf '%s %s own 2026-11-24T15:20:19Z scheduled-backup: backup ok: %s 4096 bytes sha256 0123456789abcdef offhost=skipped\n' "$I" "$1" "$D"; }
mb() { f23_as_arm env R1_LIB_ONLY=1 bash -c '. "$1"; shift; match_backup "$@"' _ "$G0" "$@" 2>&1; }
mbc() { # case want-rc regex args...   (the 11th argument is the timer's LastTriggerUSec in microseconds)
  local c=$1 w=$2 rx=$3 o rc; shift 3; o=$(mb "$@"); rc=$?
  if [ "$rc" = "$w" ] && grep -Eq -- "$rx" <<< "$o"; then okc "$c" "match_backup returns $w and prints /$rx/" "rc $rc: $(head -1 <<< "$o" | cut -c1-200)"
  else unx "$c" "match_backup returns $w and prints /$rx/" "rc $rc: $(head -1 <<< "$o" | cut -c1-200)"; fi
}
mbc mb-valid 0 "^$I $B0 $((B0+1)) $((B0+19)) $((B0+19)) $D 0123456789abcdef\$" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))" "$TU"
mbc mb-start-5s-after-dispatch 0 "^$I " "$B0" "$B1" "$B0" $((B0+5)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$TU" afldb-backup.timer $((B0+5)))" "$TU"
mbc mb-start-6s-after-dispatch 1 '^REASON .*not within 5 s after the timer dispatch' "$B0" "$B1" "$B0" $((B0+6)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))" "$TU"
mbc mb-start-before-dispatch 1 '^REASON .*not within 5 s after the timer dispatch' "$B0" "$B1" $((B0+2)) $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))" "$TU"
mbc mb-dispatch-before-window 1 '^REASON no timer dispatch in the window' "$B0" "$B1" $((B0-1)) "$B0" $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))" "$TU"
mbc mb-dispatch-after-window 1 '^REASON no timer dispatch in the window' "$B0" "$B1" $((B1+1)) $((B1+2)) $((B1+19)) success 0 "$I" 0 "$(jl $((B1+19)))" "$TU"
mbc mb-exit-at-limit 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B1+900)) success 0 "$I" 0 "$(jl $((B1+900)))" "$TU"
mbc mb-exit-past-limit 1 '^REASON .*no completion between its start and the window end' "$B0" "$B1" "$B0" $((B0+1)) $((B1+901)) success 0 "$I" 0 "$(jl $((B1+900)))" "$TU"
mbc mb-ok-line-5s-after-exit 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+24)))" "$TU"
mbc mb-ok-line-6s-after-exit 1 '^REASON .*outside its own run' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+25)))" "$TU"
mbc mb-ok-line-before-start 1 '^REASON .*outside its own run' "$B0" "$B1" "$B0" $((B0+3)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+2)))" "$TU"
mbc mb-status-nonzero 1 '^REASON .*did not succeed: Result=success ExecMainStatus=1' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 1 "$I" 0 "$(jl $((B0+19)))" "$TU"
mbc mb-invocation-not-hex 1 '^REASON the service InvocationID is not one 32-hex value' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "${I:0:31}" 0 "$(jl $((B0+19)))" "$TU"
mbc mb-reader-other-failure 1 '^REASON the journal JSON reader failed \(exit 127\)' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 127 "" "$TU"
mbc mb-ok-line-not-anchored 1 "^REASON .*logged 0 'backup ok' lines" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 \
  "$I $((B0+19)) own echo of: x scheduled-backup: backup ok: $D 4096 bytes sha256 0123456789abcdef offhost=skipped trailing" "$TU"
# r5: the origin rule (match_backup's 11th argument is what busctl printed for LastTriggerUSec). r6: match_backup no longer reads a trigger
# line: the cases built on its content (1us-later .. job-not-a-number, unit-*, no-/two-trigger-lines) now expect rc 0 (r5 expected 1);
# a trigger line is still an own line, so its time must lie inside the run (after-exit-6s still STOPs); origin is attested_origin's.
OR='^REASON scheduled origin unproven: '
mbc mb-origin-valid 0 "^$I $B0 $((B0+1)) $((B0+19)) $((B0+19)) $D 0123456789abcdef\$" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))" "$TU"
mbc mb-origin-no-timer-usec 1 "${OR}afldb-backup\\.timer LastTriggerUSec could not be read in microseconds" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))"
mbc mb-origin-empty-timer-usec 1 "${OR}afldb-backup\\.timer LastTriggerUSec could not be read in microseconds" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))" ""
mbc mb-origin-timer-usec-not-a-number 1 "${OR}afldb-backup\\.timer LastTriggerUSec could not be read in microseconds" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))" "12x"
mbc mb-origin-timer-usec-leading-zero 1 "${OR}afldb-backup\\.timer LastTriggerUSec could not be read in microseconds" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "0$TU")" "0$TU"
mbc mb-origin-seconds-disagree 1 "${OR}LastTriggerUSec in microseconds \($((TU+1000000))\) and in seconds \($B0\) disagree" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$((TU+1000000))")" "$((TU+1000000))"
mbc mb-origin-line-1us-later 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$((TU+1))")" "$TU"
mbc mb-origin-line-1us-earlier 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$((TU-1))")" "$TU"
mbc mb-origin-line-whole-seconds 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$B0")" "$TU"
mbc mb-origin-line-yesterdays-dispatch 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$((TU-86400000000))")" "$TU"
mbc mb-origin-unit-none 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) none none)" "$TU"
mbc mb-origin-unit-other-timer 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$TU" afldb-backup-verify.timer)" "$TU"
mbc mb-origin-unit-a-path 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$TU" afldb-backup.path)" "$TU"
mbc mb-origin-no-trigger-line 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 \
  "$I $((B0+19)) own 2026-11-24T15:20:19Z scheduled-backup: backup ok: $D 4096 bytes sha256 0123456789abcdef offhost=skipped" "$TU"
mbc mb-origin-two-trigger-lines 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)); jl $((B0+19)) | head -1)" "$TU"
mbc mb-origin-line-names-another-invocation 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 \
  "$(jl $((B0+19)) | sed "s/invocation=$I/invocation=$F23_BINV2/")" "$TU"
mbc mb-origin-line-trailing-word 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) | sed 's/realtime_usec=\([0-9]*\)$/realtime_usec=\1 x/')" "$TU"
mbc mb-origin-line-job-not-a-number 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) | sed 's/job=4242/job=4x/')" "$TU"
mbc mb-origin-line-job-none-is-fine 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) | sed 's/job=4242/job=none/')" "$TU"
mbc mb-origin-trigger-line-after-exit-6s 1 '^REASON .*outside its own run' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$TU" afldb-backup.timer $((B0+25)))" "$TU"
mbc mb-origin-trigger-line-5s-after-exit 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)) "$TU" afldb-backup.timer $((B0+24)))" "$TU"
mbc mb-origin-old-ten-argument-call 1 "${OR}afldb-backup\\.timer LastTriggerUSec could not be read in microseconds" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))"

echo "-- timer_usec directly (same seam; the busctl shim as arm): what busctl may print"
tu() { f23_as_arm env R1_LIB_ONLY=1 bash -c '. "$1"; timer_usec' _ "$G0" 2>&1; }
tuc() { # case busctl-mode want-rc want-output
  local o rc; f23_scenario genuine > /dev/null; echo "$2" > /fx/busctl-mode; o=$(tu); rc=$?; echo > /fx/busctl-mode
  if [ "$rc" = "$3" ] && [ "$o" = "$4" ]; then okc "$1" "timer_usec returns $3 and prints '$4'" "rc $rc: '$o'"
  else unx "$1" "timer_usec returns $3 and prints '$4'" "rc $rc: '$o'"; fi
}
tuc tu-reads-microseconds "" 0 "$F23_TRIG_US"
tuc tu-bus-failure fail 1 ""
tuc tu-not-a-number garbage 1 ""
tuc tu-no-output empty 1 ""
f23_scenario genuine > /dev/null; f23_unset afldb-backup.timer LastTriggerUSecRaw
[ "$(tu)" = "$((B0 * 1000000))" ] && okc tu-derived-from-seconds "the fixture busctl falls back to seconds x 1e6 when no exact row exists" "$(tu)" || unx tu-derived-from-seconds "fallback" "$(tu)"
f23_scenario genuine > /dev/null
o=$(f23_as_arm env R1_LIB_ONLY=1 PATH=/nonexistent /usr/bin/bash -c '. "$1"; timer_usec' _ "$G0" 2>&1); rc=$?
[ "$rc" != 0 ] && [ -z "$o" ] && okc tu-no-busctl "timer_usec fails (non-zero) and prints nothing when busctl is not installed" "rc $rc" || unx tu-no-busctl "timer_usec fails and prints nothing without busctl" "rc $rc: '$o'"

echo "-- backup_journal directly (same seam; the journalctl shim and the pinned node)"
bj() { f23_as_arm env R1_LIB_ONLY=1 bash -c '. "$1"; backup_journal "$2" "$3" "$4"' _ "$G0" "$B0" "$((B1+906))" "$F23_NODE" 2> /dev/null; }
bjc() { # case scenario want-rc want-lines regex
  local o rc n; f23_scenario "$2" > /dev/null; o=$(bj); rc=$?; n=$(grep -c . <<< "$o")
  if [ "$rc" = "$3" ] && [ "$n" = "$4" ] && grep -Eq -- "$5" <<< "$o"; then okc "$1" "backup_journal returns $3 with $4 line(s) matching /$5/" "rc $rc, $n line(s)"
  else unx "$1" "backup_journal returns $3 with $4 line(s) matching /$5/" "rc $rc, $n line(s): $(head -1 <<< "$o" | cut -c1-160)"; fi
}
bjc bj-genuine genuine 0 2 "^$F23_BINV [0-9]{10} own [^ ]+ scheduled-backup: backup ok: "
bjc bj-genuine-trigger-line genuine-r5-script 0 3 "^$F23_BINV [0-9]{10} own [^ ]+ scheduled-backup: trigger: invocation=$F23_BINV job=4242 unit=afldb-backup\\.timer realtime_usec=$F23_TRIG_US\$"
bjc bj-pid1-lines genuine-pid1-lines 0 4 "^$F23_BINV [0-9]{10} pid1 -\$"
bjc bj-journalctl-fails journal-fail 10 0 '^$'
bjc bj-malformed-json journal-malformed 3 0 '^$'
bjc bj-own-entry-without-invocation journal-no-invocation 4 0 '^$'
f23_scenario genuine > /dev/null
o=$(f23_as_arm env R1_LIB_ONLY=1 bash -c '. "$1"; backup_journal "$2" "$3" /nonexistent/node' _ "$G0" "$B0" "$((B1+906))" 2> /dev/null); rc=$?
[ "$rc" != 0 ] && [ -z "$o" ] && okc bj-no-node "backup_journal fails (non-zero) and prints nothing without node" "rc $rc" \
  || unx bj-no-node "backup_journal fails and prints nothing without node" "rc $rc"
finish
