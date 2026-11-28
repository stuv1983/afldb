#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r4, 27 Nov 2026). Suite f3: review finding 3, the InvocationID and serving-release identity of
#   A-2  <STAGE>/docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh  (section 4: ONE validated capture, printed from it)
#   F-2  <STAGE>/docs/v2/evidence/backlog-20261121/r6-20261125/r6-post-verify.sh full (section 2: validated new ID; strict status)
# Where: as ROOT inside a disposable container (pinned Ubuntu 24.04 image, --network none, --rm, --hostname afldb-prod, the
# pinned node mounted read-only at /home/arm/.nvm/versions/node/v22.23.2); see cases/lib-f23-fixture.sh for the fixture (absolute
# container paths; the suite's own mktemp directory holds only scratch output and is removed on exit). The REAL script bytes
# under <STAGE> run as arm through PATH shims; nothing is copied or edited.
# release.mjs is a STUB here, for every case (as r3 section S): it prints /fx/stub-out and exits /fx/stub-rc. The texts are the
# ones deploy/release.mjs cmdStatus logs ("release: STATUS PASS <id>", "release: STATUS FAIL", and without --expect the line
# "release: note: the service restarted since the last attested PASS (InvocationID a -> b); compare with your maintenance log:
# this was not a restart you attested", after which it still ends STATUS PASS, exit 0). The real release.mjs is NOT run here.
# The systemctl shim counts every single-property `show afldb -p InvocationID` read in /fx/inv-calls.
# Every other check of both scripts passes on the fixture, so a refusal has exactly ONE FAIL line carrying the expected reason.
# Contrast: the aa33f0fc scripts (default <FIX>/<this round>/orig-aa33f0fc/; F3_ORIG_PRE / F3_ORIG_POST override).
# Usage: bash cases/f3-identity.sh <FIX> [<STAGE>]
set -uo pipefail; export LC_ALL=C
FIX=${1:?usage: f3-identity.sh <FIX> [<STAGE>]}; STAGE=${2:-$FIX}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
. "$HERE/lib-f23-fixture.sh"
B=docs/v2/evidence/backlog-20261121; H4=$B/r6-20261125/review-fixes-r4-20261127
PRE=$STAGE/$B/r6-20261125/r6-pre-verify.sh; POST=$STAGE/$B/r6-20261125/r6-post-verify.sh
OPRE=${F3_ORIG_PRE:-$FIX/$H4/orig-aa33f0fc/r6-pre-verify.sh}; OPOST=${F3_ORIG_POST:-$FIX/$H4/orig-aa33f0fc/r6-post-verify.sh}
N=0; U=0
okc() { echo "CASE-RESULT f3-$1 OK ($2 ; got $3)"; N=$((N+1)); }
unx() { echo "CASE-RESULT f3-$1 UNEXPECTED ($2 ; got $3)"; U=$((U+1)); }
finish() { if [ "$U" = 0 ]; then echo "SUITE f3 RESULT PASS ($N cases)"; exit 0; else echo "SUITE f3 RESULT FAIL ($U unexpected)"; exit 1; fi; }
TMP=$(mktemp -d) || { echo "CASE-RESULT f3-setup UNEXPECTED (mktemp ; got failure)"; U=1; finish; }
trap 'f23_service_stop; rm -rf "$TMP"' EXIT
for f in "$PRE" "$POST" "$OPRE" "$OPOST"; do [ -f "$f" ] || { unx setup "script present" "missing $f"; finish; }; done
f23_setup "$FIX" > "$TMP/setup.out" 2>&1 || { unx setup "fixture built" "$(tail -n 1 "$TMP/setup.out")"; finish; }
echo "== f3 $(/usr/bin/date -u +%FT%TZ) host=$(hostname) A-2 $(sha256sum < "$PRE" | cut -c1-16) F-2 $(sha256sum < "$POST" | cut -c1-16) orig A-2 $(sha256sum < "$OPRE" | cut -c1-16) orig F-2 $(sha256sum < "$OPOST" | cut -c1-16)"
a=$(f23_fn "$PRE" read_invocation | sha256sum | cut -c1-16); b=$(f23_fn "$POST" read_invocation | sha256sum | cut -c1-16)
[ -n "$(f23_fn "$PRE" read_invocation)" ] && [ "$a" = "$b" ] && okc fn-identical "read_invocation body hashes the same in A-2 and F-2" "$a = $b" \
  || unx fn-identical "read_invocation body hashes the same in A-2 and F-2" "$a / $b"

CUR=$F23_CUR; TUE=$F23_INV_TUE; NEW=$F23_INV_NEW; OTHER=$F23_INV_OTHER
PB=0f0e0d0c-0b0a-4908-8706-050403020100; GB=$(printf 'fixture-grub-baseline' | sha256sum | cut -c1-64)
NOTE="release: note: the service restarted since the last attested PASS (InvocationID $TUE -> $NEW); compare with your maintenance log: this was not a restart you attested"
OUT=; RC=; CALLS=
state() { # live-InvocationID inv-mode stub-output stub-rc
  f23_set afldb InvocationID "$1"; printf '%s' "$2" > /fx/inv-mode; f23_stub "$3" "$4"; : > /fx/inv-calls; }
pre() { OUT=$(f23_as_arm bash "$1" accepted "$CUR" r3:yes "$F23_R4" 10:00 tue:released "inv:$TUE" 2>&1); RC=$?; CALLS=$(wc -l < /fx/inv-calls); }
post() { OUT=$(f23_as_arm bash "$1" full 6.8.0-137-generic "$CUR" "$PB" "$TUE" none "$F23_R4" "$GB" 2>&1); RC=$?; CALLS=$(wc -l < /fx/inv-calls); }
got() { local f; f=$(grep -m1 -E -- "${1:-^FAIL}" <<< "$OUT" | cut -c1-230); [ -n "$f" ] || f=$(grep -m1 '^FAIL' <<< "$OUT" | cut -c1-230)
  echo "exit $RC, $(grep -c '^FAIL' <<< "$OUT") FAIL line(s), '$(grep -E '^R6 (PRE|POST) RESULT ' <<< "$OUT" | cut -c1-22 | head -1)', '$(grep '^INVOCATION_ID' <<< "$OUT" | cut -c1-60 | tr '\n' '|')', $CALLS InvocationID read(s)${f:+, $f}"; }
passes() { # case verdict printed-id extra-regex
  if [ "$RC" = 0 ] && [ "$(grep -c '^FAIL' <<< "$OUT")" = 0 ] && grep -q "^$2" <<< "$OUT" && [ "$(grep '^INVOCATION_ID' <<< "$OUT")" = "INVOCATION_ID $3" ] \
     && [ "$CALLS" = 1 ] && grep -Eq -- "$4" <<< "$OUT"; then okc "$1" "exit 0, $2, 'INVOCATION_ID $3' from 1 read, /$4/" "$(got)"
  else unx "$1" "exit 0, $2, 'INVOCATION_ID $3' from 1 read, /$4/" "$(got)"; fi
}
stops() { # case verdict reason-regex id-line(none|<id>)
  local idok=0
  case $4 in none) [ "$(grep -c '^INVOCATION_ID' <<< "$OUT")" = 1 ] && grep -q '^INVOCATION_ID none (' <<< "$OUT" && ! grep -Eq '^INVOCATION_ID .*[0-9a-fA-F]{32}' <<< "$OUT" && idok=1;;
    *) [ "$(grep '^INVOCATION_ID' <<< "$OUT")" = "INVOCATION_ID $4" ] && idok=1;; esac
  if [ "$RC" = 1 ] && [ "$(grep -c '^FAIL' <<< "$OUT")" = 1 ] && grep -q "^$2" <<< "$OUT" && grep -Eq -- "^FAIL $3" <<< "$OUT" && [ "$idok" = 1 ] && [ "$CALLS" = 1 ]; then
    okc "$1" "exit 1, $2, exactly 1 FAIL line /$3/, INVOCATION_ID line '$4', 1 read" "$(got "^FAIL $3")"
  else unx "$1" "exit 1, $2, exactly 1 FAIL line /$3/, INVOCATION_ID line '$4', 1 read" "$(got "^FAIL $3")"; fi
}
GOOD="release: current  $CUR\nrelease: STATUS PASS $CUR\n"

echo "-- A-2 (r6-pre-verify.sh): the InvocationID is captured once, validated, and printed from that capture"
state "$TUE" '' "$GOOD" 0; pre "$PRE"
passes pre-valid 'R6 PRE RESULT PASS' "$TUE" "^PASS live InvocationID = the owner-attested $TUE"
state "$TUE" flip2 "$GOOD" 0; pre "$PRE"
passes pre-later-read-differs 'R6 PRE RESULT PASS' "$TUE" "^PASS live InvocationID = the owner-attested $TUE"
state "$TUE" flip1 "$GOOD" 0; pre "$PRE"
stops pre-first-read-differs 'R6 PRE RESULT STOP' "InvocationID: live InvocationID $OTHER != owner-attested $TUE" none
state "$TUE" flip1 "$GOOD" 0; pre "$OPRE"
if [ "$RC" = 0 ] && grep -q '^R6 PRE RESULT PASS' <<< "$OUT" && [ "$(grep '^INVOCATION_ID' <<< "$OUT")" = "INVOCATION_ID $OTHER" ] && [ "$CALLS" = 2 ]; then
  okc pre-first-read-differs-aa33f0fc "the aa33f0fc A-2 reads twice, PASSes on the second read and prints the first, unvalidated ID $OTHER for F-2 (the defect)" "$(got)"
else unx pre-first-read-differs-aa33f0fc "the aa33f0fc A-2 exits 0 printing the unvalidated first read from 2 reads" "$(got)"; fi
for m in fail empty malformed multi upper; do
  case $m in fail) rx='InvocationID: systemctl show afldb failed \(exit 1\)';; empty) rx='InvocationID: the live InvocationID is empty';;
    *) rx='InvocationID: the live InvocationID .* is malformed';; esac
  state "$TUE" "$m" "$GOOD" 0; pre "$PRE"; stops "pre-read-$m" 'R6 PRE RESULT STOP' "$rx" none
done
state "$OTHER" '' "$GOOD" 0; pre "$PRE"
stops pre-mismatch 'R6 PRE RESULT STOP' "InvocationID: live InvocationID $OTHER != owner-attested $TUE" none

echo "-- F-2 (r6-post-verify.sh full): a validated new InvocationID and a strict serving status for exactly $CUR"
state "$NEW" '' "release: current  $CUR\n$NOTE\nrelease: STATUS PASS $CUR\n" 0; post "$POST"
passes post-valid-after-reboot-with-restart-note 'R6 POST RESULT PASS (6.8.0-137-generic)' "$NEW" \
  "^PASS release\.mjs status \(read-only\): exit 0, one result line 'STATUS PASS $CUR' \(restart note present"
grep -q "^PASS afldb InvocationID new: $NEW " <<< "$OUT" && okc post-valid-new-id-line "PASS afldb InvocationID new: $NEW" "present" \
  || unx post-valid-new-id-line "PASS afldb InvocationID new: $NEW" "absent"
state "$NEW" '' "$GOOD" 0; post "$POST"
passes post-valid-without-note 'R6 POST RESULT PASS (6.8.0-137-generic)' "$NEW" \
  "^PASS release\.mjs status \(read-only\): exit 0, one result line 'STATUS PASS $CUR' \(restart note absent"
for m in fail empty malformed multi upper; do
  case $m in fail) rx='afldb InvocationID: systemctl show afldb failed \(exit 1\)';; empty) rx='afldb InvocationID: the live InvocationID is empty';;
    *) rx='afldb InvocationID: the live InvocationID .* is malformed';; esac
  state "$NEW" "$m" "$GOOD" 0; post "$POST"; stops "post-read-$m" 'R6 POST RESULT FAIL' "$rx" none
done
state "$TUE" '' "$GOOD" 0; post "$POST"
stops post-id-unchanged 'R6 POST RESULT FAIL' "afldb InvocationID unchanged \($TUE is the pre-boot ID" none
P='release\.mjs status does not prove [^ ]+ is serving after the boot: '
state "$NEW" '' "release: FAIL health not ok\nrelease: STATUS FAIL\n" 1; post "$POST"
stops post-status-fail-exit-1 'R6 POST RESULT FAIL' "${P}exit 1; no line 'release: STATUS PASS $CUR'" "$NEW"
state "$NEW" '' "$GOOD" 1; post "$POST"
stops post-status-pass-line-exit-1 'R6 POST RESULT FAIL' "${P}exit 1\$" "$NEW"
state "$NEW" '' "release: current  $CUR\nrelease: STATUS PASS 17822b29e6de-OtherBuild\n" 0; post "$POST"
stops post-status-wrong-release 'R6 POST RESULT FAIL' "${P}no line 'release: STATUS PASS $CUR'" "$NEW"
state "$NEW" '' "release: STATUS PASS ${CUR}x\n" 0; post "$POST"
stops post-status-longer-id 'R6 POST RESULT FAIL' "${P}no line 'release: STATUS PASS $CUR'" "$NEW"
state "$NEW" '' "release: STATUS FAIL\nrelease: STATUS PASS $CUR\n" 0; post "$POST"
stops post-status-fail-beside-pass 'R6 POST RESULT FAIL' "${P}2 result lines \(need exactly 1\)" "$NEW"
state "$NEW" '' "release: STATUS PASS $CUR\nrelease: STATUS PASS $CUR\n" 0; post "$POST"
stops post-status-duplicate-pass 'R6 POST RESULT FAIL' "${P}2 result lines \(need exactly 1\)" "$NEW"
state "$NEW" '' "release: current  $CUR\n" 0; post "$POST"
stops post-status-no-result-line 'R6 POST RESULT FAIL' "${P}0 result lines \(need exactly 1\); no line" "$NEW"
state "$NEW" '' "release: STATUS PASS $CUR\r\n" 0; post "$POST"
stops post-status-crlf-pass 'R6 POST RESULT FAIL' "${P}the output contains a carriage return; no line" "$NEW"
state "$NEW" '' "release: STATUS FAIL\r\nrelease: STATUS PASS $CUR\n" 0; post "$POST"
stops post-status-crlf-fail-lf-pass 'R6 POST RESULT FAIL' "${P}the output contains a carriage return; 2 result lines" "$NEW"
state "$NEW" '' "release: current  $CUR\r\nrelease: STATUS PASS $CUR\n" 0; post "$POST"
stops post-status-cr-elsewhere 'R6 POST RESULT FAIL' "${P}the output contains a carriage return\$" "$NEW"

echo "-- contrast: the aa33f0fc F-2 on the same fixtures"
state "$NEW" fail "$GOOD" 0; post "$OPOST"
if [ "$RC" = 0 ] && grep -q '^R6 POST RESULT PASS' <<< "$OUT" && grep -q '^PASS afldb InvocationID new:  (the owner attests' <<< "$OUT"; then
  okc post-read-fail-aa33f0fc "the aa33f0fc F-2 exits 0, PASS, with an empty 'new' InvocationID after a failed read (the defect)" "$(got)"
else unx post-read-fail-aa33f0fc "the aa33f0fc F-2 exits 0 after a failed InvocationID read" "$(got)"; fi
state "$NEW" '' "release: FAIL health not ok\nrelease: STATUS FAIL\n" 1; post "$OPOST"
if [ "$RC" = 0 ] && grep -q '^R6 POST RESULT PASS' <<< "$OUT" && grep -q '^INFO release\.mjs status exit 1' <<< "$OUT"; then
  okc post-status-fail-aa33f0fc "the aa33f0fc F-2 exits 0, PASS, although release.mjs status printed STATUS FAIL and exited 1 (the defect)" "$(got)"
else unx post-status-fail-aa33f0fc "the aa33f0fc F-2 exits 0 on a failed status" "$(got)"; fi
finish
