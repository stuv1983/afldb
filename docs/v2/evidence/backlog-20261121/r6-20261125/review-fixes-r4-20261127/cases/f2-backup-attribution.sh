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
# Usage: bash cases/f2-backup-attribution.sh <FIX> [<STAGE>]
set -uo pipefail; export LC_ALL=C
FIX=${1:?usage: f2-backup-attribution.sh <FIX> [<STAGE>]}; STAGE=${2:-$FIX}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
. "$HERE/lib-f23-fixture.sh"
B=docs/v2/evidence/backlog-20261121; H4=$B/r6-20261125/review-fixes-r4-20261127
PRE=$STAGE/$B/r6-20261125/r6-pre-verify.sh; G0=$FIX/docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh
OPRE=${F2_ORIG_PRE:-$FIX/$H4/orig-aa33f0fc/r6-pre-verify.sh}; OG0=${F2_ORIG_G0:-$FIX/$H4/orig-aa33f0fc/r1-g0-dump.sh}
N=0; U=0
okc() { echo "CASE-RESULT f2-$1 OK ($2 ; got $3)"; N=$((N+1)); }
unx() { echo "CASE-RESULT f2-$1 UNEXPECTED ($2 ; got $3)"; U=$((U+1)); }
finish() { if [ "$U" = 0 ]; then echo "SUITE f2 RESULT PASS ($N cases)"; exit 0; else echo "SUITE f2 RESULT FAIL ($U unexpected)"; exit 1; fi; }
TMP=$(mktemp -d) || { echo "CASE-RESULT f2-setup UNEXPECTED (mktemp ; got failure)"; U=1; finish; }
trap 'f23_service_stop; rm -rf "$TMP"' EXIT
for f in "$PRE" "$G0" "$OPRE" "$OG0"; do [ -f "$f" ] || { unx setup "script present" "missing $f"; finish; }; done
f23_setup "$FIX" > "$TMP/setup.out" 2>&1 || { unx setup "fixture built" "$(tail -n 1 "$TMP/setup.out")"; finish; }
echo "== f2 $(/usr/bin/date -u +%FT%TZ) host=$(hostname) G0 $(sha256sum < "$G0" | cut -c1-16) A-2 $(sha256sum < "$PRE" | cut -c1-16) orig G0 $(sha256sum < "$OG0" | cut -c1-16) orig A-2 $(sha256sum < "$OPRE" | cut -c1-16)"

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
     && [ "$(grep '^OFFHOST-COMPARE ' <<< "$OUT")" = "OFFHOST-COMPARE $F23_SD $F23_SS" ]; then
    okc "$1" "exit 0, no FAIL, $v, timer run attributed to $4, OFFHOST-COMPARE of the fixture dump" "$(got)"
  else unx "$1" "exit 0, no FAIL, $v, timer run attributed, OFFHOST-COMPARE" "$(got)"; fi
}
want_stop() { # case gate script reason-regex
  local v; case $2 in g0) v='G0 PROD RESULT FAIL';; a2) v='R6 PRE RESULT STOP';; esac
  gate "$2" "$3"
  if [ "$RC" = 1 ] && [ "$(grep -c '^FAIL' <<< "$OUT")" = 1 ] && [[ "$(verdict)" == "$v"* ]] && grep -Eq -- "^FAIL .*$4" <<< "$OUT" \
     && ! grep -q '^OFFHOST-COMPARE' <<< "$OUT"; then
    okc "$1" "exit 1, $v, exactly 1 FAIL line matching /$4/, no OFFHOST-COMPARE" "$(got "^FAIL .*$4")"
  else unx "$1" "exit 1, $v, exactly 1 FAIL line matching /$4/, no OFFHOST-COMPARE" "$(got "^FAIL .*$4")"; fi
}
want_false_pass() { # case gate orig-script: the aa33f0fc gate accepts a start by hand
  local v; case $2 in g0) v='G0 PROD RESULT PASS:';; a2) v='R6 PRE RESULT PASS';; esac
  gate "$2" "$3"
  if [ "$RC" = 0 ] && [[ "$(verdict)" == "$v"* ]] && grep -q '^PASS afldb-backup\.service scheduled run ' <<< "$OUT" \
     && [ "$(grep '^OFFHOST-COMPARE ' <<< "$OUT")" = "OFFHOST-COMPARE $F23_SD $F23_SS" ]; then
    okc "$1" "the aa33f0fc script exits 0 with PASS and prints OFFHOST-COMPARE for the hand-started dump (the false PASS)" "$(got)"
  else unx "$1" "the aa33f0fc script exits 0 with PASS (defect reproduced)" "$(got)"; fi
}

echo "-- shared functions: byte-identical in both gates; pick_overnight_dump unchanged from aa33f0fc"
same=1; list=
for fn in pick_overnight_dump ts read_invocation backup_journal match_backup scheduled_backup_run; do
  a=$(f23_fn "$G0" "$fn" | sha256sum | cut -c1-16); b=$(f23_fn "$PRE" "$fn" | sha256sum | cut -c1-16)
  [ -n "$(f23_fn "$G0" "$fn")" ] && [ "$a" = "$b" ] || same=0; list="$list $fn=$a/$b"
done
[ "$same" = 1 ] && okc fn-identical "six shared function bodies hash the same in r1-g0-dump.sh and r6-pre-verify.sh" "${list# }" \
  || unx fn-identical "six shared function bodies hash the same" "${list# }"
a=$(f23_fn "$G0" pick_overnight_dump | sha256sum | cut -c1-16); b=$(f23_fn "$OG0" pick_overnight_dump | sha256sum | cut -c1-16)
[ "$a" = "$b" ] && okc pick-unchanged "pick_overnight_dump body = the aa33f0fc body" "$a = $b" || unx pick-unchanged "pick_overnight_dump body = the aa33f0fc body" "$a != $b"

echo "-- G0 and A-2 main on each fixture state"
for g in g0 a2; do
  case $g in g0) S=$G0; O=$OG0;; a2) S=$PRE; O=$OPRE;; esac
  f23_scenario genuine;            want_pass "$g-genuine-timer-run" "$g" "$S" "$F23_BINV"
  f23_scenario genuine-pid1-lines; want_pass "$g-genuine-with-pid1-lines" "$g" "$S" "$F23_BINV"
  for sc in manual-no-timer timer-failed-then-manual manual-within-5s ok-line-other-invocation two-invocations pid1-other-invocation \
      binv-fail binv-empty binv-malformed binv-multi journal-fail journal-malformed journal-no-invocation no-timer-property \
      timer-run-failed no-completion no-ok-line two-ok-lines ok-line-after-run no-dump two-dumps bad-sidecar journal-other-name journal-other-hash; do
    f23_scenario "$sc" > /dev/null || { unx "$g-$sc" "scenario built" "unknown scenario"; continue; }
    want_stop "$g-$sc" "$g" "$S" "$(f23_reason "$sc")"
    case $sc in manual-no-timer|timer-failed-then-manual|manual-within-5s) want_false_pass "$g-$sc-aa33f0fc" "$g" "$O";; esac
  done
done

echo "-- match_backup directly (R1_LIB_ONLY seam of r1-g0-dump.sh, as arm): the boundaries"
B0=$(f23_ep "$F23_DAY 02:20:00"); B1=$(f23_ep "$F23_DAY 02:31:00"); I=$F23_BINV; D=afldb_prod-$F23_DAYC-022001.dump
jl() { printf '%s %s own 2026-11-24T15:20:19Z scheduled-backup: backup ok: %s 4096 bytes sha256 0123456789abcdef offhost=skipped\n' "$I" "$1" "$D"; }
mb() { f23_as_arm env R1_LIB_ONLY=1 bash -c '. "$1"; shift; match_backup "$@"' _ "$G0" "$@" 2>&1; }
mbc() { # case want-rc regex args...
  local c=$1 w=$2 rx=$3 o rc; shift 3; o=$(mb "$@"); rc=$?
  if [ "$rc" = "$w" ] && grep -Eq -- "$rx" <<< "$o"; then okc "$c" "match_backup returns $w and prints /$rx/" "rc $rc: $(head -1 <<< "$o" | cut -c1-200)"
  else unx "$c" "match_backup returns $w and prints /$rx/" "rc $rc: $(head -1 <<< "$o" | cut -c1-200)"; fi
}
mbc mb-valid 0 "^$I $B0 $((B0+1)) $((B0+19)) $((B0+19)) $D 0123456789abcdef\$" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))"
mbc mb-start-5s-after-dispatch 0 "^$I " "$B0" "$B1" "$B0" $((B0+5)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))"
mbc mb-start-6s-after-dispatch 1 '^REASON .*not within 5 s after the timer dispatch' "$B0" "$B1" "$B0" $((B0+6)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))"
mbc mb-start-before-dispatch 1 '^REASON .*not within 5 s after the timer dispatch' "$B0" "$B1" $((B0+2)) $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))"
mbc mb-dispatch-before-window 1 '^REASON no timer dispatch in the window' "$B0" "$B1" $((B0-1)) "$B0" $((B0+19)) success 0 "$I" 0 "$(jl $((B0+19)))"
mbc mb-dispatch-after-window 1 '^REASON no timer dispatch in the window' "$B0" "$B1" $((B1+1)) $((B1+2)) $((B1+19)) success 0 "$I" 0 "$(jl $((B1+19)))"
mbc mb-exit-at-limit 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B1+900)) success 0 "$I" 0 "$(jl $((B1+900)))"
mbc mb-exit-past-limit 1 '^REASON .*no completion between its start and the window end' "$B0" "$B1" "$B0" $((B0+1)) $((B1+901)) success 0 "$I" 0 "$(jl $((B1+900)))"
mbc mb-ok-line-5s-after-exit 0 "^$I " "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+24)))"
mbc mb-ok-line-6s-after-exit 1 '^REASON .*outside its own run' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+25)))"
mbc mb-ok-line-before-start 1 '^REASON .*outside its own run' "$B0" "$B1" "$B0" $((B0+3)) $((B0+19)) success 0 "$I" 0 "$(jl $((B0+2)))"
mbc mb-status-nonzero 1 '^REASON .*did not succeed: Result=success ExecMainStatus=1' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 1 "$I" 0 "$(jl $((B0+19)))"
mbc mb-invocation-not-hex 1 '^REASON the service InvocationID is not one 32-hex value' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "${I:0:31}" 0 "$(jl $((B0+19)))"
mbc mb-reader-other-failure 1 '^REASON the journal JSON reader failed \(exit 127\)' "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 127 ""
mbc mb-ok-line-not-anchored 1 "^REASON .*logged 0 'backup ok' lines" "$B0" "$B1" "$B0" $((B0+1)) $((B0+19)) success 0 "$I" 0 \
  "$I $((B0+19)) own echo of: x scheduled-backup: backup ok: $D 4096 bytes sha256 0123456789abcdef offhost=skipped trailing"

echo "-- backup_journal directly (same seam; the journalctl shim and the pinned node)"
bj() { f23_as_arm env R1_LIB_ONLY=1 bash -c '. "$1"; backup_journal "$2" "$3" "$4"' _ "$G0" "$B0" "$((B1+906))" "$F23_NODE" 2> /dev/null; }
bjc() { # case scenario want-rc want-lines regex
  local o rc n; f23_scenario "$2" > /dev/null; o=$(bj); rc=$?; n=$(grep -c . <<< "$o")
  if [ "$rc" = "$3" ] && [ "$n" = "$4" ] && grep -Eq -- "$5" <<< "$o"; then okc "$1" "backup_journal returns $3 with $4 line(s) matching /$5/" "rc $rc, $n line(s)"
  else unx "$1" "backup_journal returns $3 with $4 line(s) matching /$5/" "rc $rc, $n line(s): $(head -1 <<< "$o" | cut -c1-160)"; fi
}
bjc bj-genuine genuine 0 2 "^$F23_BINV [0-9]{10} own [^ ]+ scheduled-backup: backup ok: "
bjc bj-pid1-lines genuine-pid1-lines 0 4 "^$F23_BINV [0-9]{10} pid1 -\$"
bjc bj-journalctl-fails journal-fail 10 0 '^$'
bjc bj-malformed-json journal-malformed 3 0 '^$'
bjc bj-own-entry-without-invocation journal-no-invocation 4 0 '^$'
f23_scenario genuine > /dev/null
o=$(f23_as_arm env R1_LIB_ONLY=1 bash -c '. "$1"; backup_journal "$2" "$3" /nonexistent/node' _ "$G0" "$B0" "$((B1+906))" 2> /dev/null); rc=$?
[ "$rc" != 0 ] && [ -z "$o" ] && okc bj-no-node "backup_journal fails (non-zero) and prints nothing without node" "rc $rc" \
  || unx bj-no-node "backup_journal fails and prints nothing without node" "rc $rc"
finish
