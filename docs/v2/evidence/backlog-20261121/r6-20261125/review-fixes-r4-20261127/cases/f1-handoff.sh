#!/usr/bin/env bash
# R6 r4 fixture suite f1: r6-tuesday-handoff.sh (the Tuesday handoff parser) on FIXTURE Tuesday records.
# Runs as a plain user (no root, no network, no container needed; also fine inside the pinned container or Git Bash).
# Executes the REAL parser bytes at <STAGE>/docs/v2/evidence/backlog-20261121/r6-20261125/r6-tuesday-handoff.sh.
# Fixture records and fixture IDs exist only under this suite's own mktemp directory, removed on exit; the real sitting
# record is never read or written. Result-line text in the fixtures is the text the Tuesday scripts print (r1-p3b-build-check.sh,
# r1-p4-gate-promote.sh, r1-p5-accept.sh, r1-rollback.sh).
# Contrast: the three reviewer-named STOP cases are also run against the ORIGINAL parser (aa33f0fc), which must falsely PASS
# them. Original = $F1_ORIG if set, else <FIX>/docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r4-20261127/
# orig-aa33f0fc/r6-tuesday-handoff.sh; if neither exists the contrast is skipped with a printed note.
# Usage: bash cases/f1-handoff.sh <FIX> [<STAGE>]
# Output: one "CASE-RESULT f1-<case> OK|UNEXPECTED (...)" line per case; last line "SUITE f1 RESULT PASS (<n> cases)" exit 0,
# or "SUITE f1 RESULT FAIL (<k> unexpected)" exit 1.
main() {
  set -uo pipefail; export LC_ALL=C
  local FIX=${1:-} STAGE=${2:-${1:-}} B=docs/v2/evidence/backlog-20261121/r6-20261125
  [ -n "$FIX" ] && [ -d "$FIX" ] && [ -d "$STAGE" ] || { echo "usage: f1-handoff.sh <FIX> [<STAGE>]"; exit 2; }
  local HAND=$STAGE/$B/r6-tuesday-handoff.sh ORIG=${F1_ORIG:-$FIX/$B/review-fixes-r4-20261127/orig-aa33f0fc/r6-tuesday-handoff.sh}
  [ -f "$HAND" ] || { echo "STOP no parser at $HAND"; exit 2; }
  RD=$(mktemp -d "${TMPDIR:-/tmp}/f1-handoff.XXXXXX") || exit 2; trap 'rm -rf -- "$RD"' EXIT
  N=0; BADN=0
  NEWB=fixtureBuild0123456789; CUR=17822b29e6de-$NEWB; PREV=7d92042fd110-XWruOm_9nLCSMY8nGPqYU
  SUN=342040625f6d4012a35d598dfbf9afe6; INV_TUE=aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001; INV_RB=bbbbbbbbbbbbbbbbbbbbbbbbbbbb0002
  P3B="P3b RESULT BUILD PASS $CUR"
  P4P="P4 RESULT PROMOTED 2026-11-24T00:12:03Z: OWNER NOW: RESTART block (runbook section 4.2), no later than 11:35 AEDT"
  INV5="PASS running invocation = the owner's restart $INV_TUE"
  P5A="P5 RESULT ACCEPT PASS (1-4)"; P5T="P5 RESULT FAIL: ROLLBACK TRIGGER (1, 2 or 3)"
  P5C="P5 RESULT FAIL: check 4 only (owner decides; not a rollback trigger)"
  RBL="ROLLBACK RESULT LINKS SWITCHED 2026-11-24T01:05:10Z: OWNER NOW: RESTART block (runbook section 4.2)"
  INVR="PASS running invocation = the owner's rollback restart $INV_RB"
  RBV="ROLLBACK RESULT VERIFIED (1-3): now r1-rawhead.sh check and S9 with XWruOm_9nLCSMY8nGPqYU"
  RBF="ROLLBACK RESULT VERIFY FAIL: owner; site state as printed"
  REFUSAL="STOP past the promotion cutoff (Tue 24 Nov 11:30 AEDT): do not promote; production unchanged; reschedule"
  echo "== f1 handoff suite $(date -u +%FT%TZ) parser sha256=$(sha256sum < "$HAND" | cut -c1-64) bash=$BASH_VERSION"
  rec() { # file line... : a fixture record; every argument is one line
    local f=$1; shift
    { echo "# Tuesday sitting record: REHEARSAL FIXTURE written by f1-handoff.sh (fixture IDs; not the real record)"
      echo "G0 PROD RESULT PASS: fixture"; echo "P1 RESULT PASS"; printf '%s\n' "$@"; } > "$RD/$f"
  }
  ho() { printf '%s\n' "R6-HANDOFF tuesday-outcome $1" "R6-HANDOFF current-id $2" "R6-HANDOFF attested-invocation $3"; }
  mapfile -t HREL < <(ho released "$CUR" "$INV_TUE"); mapfile -t HRB < <(ho rolledback "$PREV" "$INV_RB"); mapfile -t HDEF < <(ho deferred "$PREV" "$SUN")
  OUT=; RC=
  run() { OUT=$(bash "$1" "${@:2}" 2>&1 < /dev/null); RC=$?; }
  res() { N=$((N + 1)); [ "$1" = OK ] || BADN=$((BADN + 1)); echo "CASE-RESULT f1-$2 $1 ($3 ; got $4)"; }
  got() { echo "rc=$RC $(grep -E '^(STOP|R6-A2-|R6 HANDOFF RESULT)' <<< "$OUT" | cut -c1-150 | tr '\n' '|')"; }
  pass() { # case file expected-outcome expected-current-id expected-inv [extra line that must be printed]
    run "$HAND" "$RD/$2"
    local want; want=$(printf '%s\n' "R6-A2-TUESDAY tue:$3" "R6-A2-CURRENT_ID $4" "R6-A2-ATTESTED inv:$5")
    if [ "$RC" = 0 ] && [ "$(grep '^R6-A2-' <<< "$OUT")" = "$want" ] && [ "$(tail -n 1 <<< "$OUT")" = 'R6 HANDOFF RESULT PASS' ] \
      && ! grep -q '^STOP' <<< "$OUT" && { [ -z "${6:-}" ] || grep -qF -- "$6" <<< "$OUT"; }
    then res OK "$1" "exit 0, tue:$3 $4 inv:$5${6:+, note printed}" "$(got)"; else res UNEXPECTED "$1" "exit 0, tue:$3 $4 inv:$5" "$(got)"; fi
  }
  stop() { # case file reason-substring (of a STOP line)
    run "$HAND" "$RD/$2"
    if [ "$RC" = 1 ] && grep -q '^R6 HANDOFF RESULT STOP' <<< "$OUT" && ! grep -q '^R6-A2-' <<< "$OUT" && grep '^STOP ' <<< "$OUT" | grep -qF -- "$3"
    then res OK "$1" "exit 1 STOP '$3', no R6-A2- line" "rc=$RC, reason present, R6-A2- lines $(grep -c '^R6-A2-' <<< "$OUT")"
    else res UNEXPECTED "$1" "exit 1 STOP '$3', no R6-A2- line" "$(got)"; fi
  }
  orig() { # case file : the ORIGINAL parser must falsely PASS this record
    if [ ! -f "$ORIG" ]; then echo "NOTE f1-orig-$1 skipped: no original parser at $ORIG (set F1_ORIG)"; return 0; fi
    run "$ORIG" "$RD/$2"
    if [ "$RC" = 0 ] && grep -qx 'R6 HANDOFF RESULT PASS' <<< "$OUT" && [ "$(grep -c '^R6-A2-' <<< "$OUT")" = 3 ]
    then res OK "orig-$1" "the aa33f0fc parser falsely PASSes (exit 0, 3 R6-A2- lines): defect reproduced" "$(got)"
    else res UNEXPECTED "orig-$1" "the aa33f0fc parser falsely PASSes" "$(got)"; fi
  }

  # ---- valid records -> PASS with the exact values
  rec released.md "$P3B" "BUILD_ID $NEWB" "$P4P" "Owner restart 11:33: InvocationID $INV_TUE (owner attests this is their restart)" "$INV5" "$P5A" "${HREL[@]}"
  rec rb-accepted.md "$P3B" "$P4P" "$INV5" "$P5A" "P6 tick 2 NOT OK: rollback trigger" "$RBL" "Owner rollback restart 12:08: InvocationID $INV_RB" "$INVR" "$RBV" "${HRB[@]}"
  rec rb-trigger.md "$P3B" "$P4P" "$INV5" "$P5T" "$RBL" "$INVR" "$RBV" "${HRB[@]}"
  rec rb-check4.md "$P3B" "$P4P" "$INV5" "$P5C" "Owner decision: roll back" "$RBL" "$INVR" "$RBV" "${HRB[@]}"
  rec rb-nop5.md "$P3B" "$P4P" "Restart not completed by 11:35: owner chose rollback" "$RBL" "$INVR" "$RBV" "${HRB[@]}"
  rec deferred.md "G0b exit 10 COPY-VERIFIED-ORIGIN-UNPROVEN: STOP before P2; release deferred; production unchanged" "${HDEF[@]}"
  rec deferred-refused.md "$P3B" '```' "$REFUSAL" '```' "Not run: P4 did not promote." "${HDEF[@]}"
  rec fenced.md '```' "$P3B" '```' "prose" '```text' "$P4P" '```' '```' "$INV5" "PASS 1 status --expect" "$P5A" '```' "${HREL[@]}"
  sed 's/$/\r/' "$RD/released.md" > "$RD/crlf.md"
  pass released released.md released "$CUR" "$INV_TUE"
  pass rolledback-after-accepted-p5 rb-accepted.md rolledback "$PREV" "$INV_RB"
  pass rolledback-after-p5-rollback-trigger rb-trigger.md rolledback "$PREV" "$INV_RB"
  pass rolledback-after-p5-check4-only rb-check4.md rolledback "$PREV" "$INV_RB"
  pass rolledback-without-p5 rb-nop5.md rolledback "$PREV" "$INV_RB"
  pass deferred deferred.md deferred "$PREV" "$SUN" 'R6-NOTE parser PASS means only that the record is internally consistent'
  pass deferred-p4-refusal-line-is-not-a-result deferred-refused.md deferred "$PREV" "$SUN" 'R6-NOTE the record has 1 P4 cutoff-refusal line(s)'
  pass released-results-inside-fences fenced.md released "$CUR" "$INV_TUE"
  pass crlf-record crlf.md released "$CUR" "$INV_TUE"
  # released prints no deferral note
  run "$HAND" "$RD/released.md"
  if [ "$RC" = 0 ] && ! grep -q '^R6-NOTE' <<< "$OUT"; then res OK released-no-deferral-note "no R6-NOTE line for released" "rc=$RC, R6-NOTE lines 0"
  else res UNEXPECTED released-no-deferral-note "no R6-NOTE line for released" "$(got)"; fi
  # read-only: the record and its directory are unchanged by a run
  local before after; before=$(sha256sum "$RD"/* | sha256sum; ls -la "$RD" | sha256sum)
  run "$HAND" "$RD/released.md"; run "$HAND" "$RD/deferred-refused.md"; after=$(sha256sum "$RD"/* | sha256sum; ls -la "$RD" | sha256sum)
  if [ "$before" = "$after" ]; then res OK read-only "fixture directory byte- and listing-identical after two runs" "identical"
  else res UNEXPECTED read-only "fixture directory unchanged" "changed"; fi

  # ---- usage / no record -> exit 2
  run "$HAND" "$RD/absent.md"
  if [ "$RC" = 2 ] && grep -q '^STOP no readable Tuesday sitting record' <<< "$OUT" && ! grep -q '^R6-A2-' <<< "$OUT"
  then res OK no-record "exit 2 'no readable Tuesday sitting record', no R6-A2- line" "rc=$RC"; else res UNEXPECTED no-record "exit 2" "$(got)"; fi
  run "$HAND"
  if [ "$RC" = 2 ] && grep -q '^STOP usage' <<< "$OUT" && ! grep -q '^R6-A2-' <<< "$OUT"
  then res OK no-argument "exit 2 'STOP usage', no R6-A2- line" "rc=$RC"; else res UNEXPECTED no-argument "exit 2" "$(got)"; fi

  # ---- r3 section H cases, ported
  grep -v R6-HANDOFF "$RD/released.md" > "$RD/x1.md";                                          stop no-handoff-lines x1.md 'the record has 0 lines mentioning R6-HANDOFF'
  { cat "$RD/deferred.md"; echo "R6-HANDOFF tuesday-outcome deferred"; } > "$RD/x2.md";         stop repeated-outcome x2.md "missing, repeated or ambiguous 'R6-HANDOFF tuesday-outcome"
  { cat "$RD/deferred.md"; echo "R6-HANDOFF tuesday-outcome released"; } > "$RD/x3.md";         stop two-outcomes x3.md "missing, repeated or ambiguous 'R6-HANDOFF tuesday-outcome"
  sed 's/^R6-HANDOFF tuesday-outcome .*/R6-HANDOFF tuesday-outcome released-or-deferred/' "$RD/released.md" > "$RD/x4.md"; stop ambiguous-outcome-value x4.md "missing, repeated or ambiguous 'R6-HANDOFF tuesday-outcome"
  sed '/^R6-HANDOFF tuesday-outcome/d' "$RD/released.md" > "$RD/x5.md";                        stop missing-outcome x5.md "missing, repeated or ambiguous 'R6-HANDOFF tuesday-outcome"
  sed 's/^R6-HANDOFF tuesday-outcome/  R6-HANDOFF tuesday-outcome/' "$RD/released.md" > "$RD/x6.md"; stop indented-handoff-line x6.md "missing, repeated or ambiguous 'R6-HANDOFF tuesday-outcome"
  sed '/^P5 RESULT ACCEPT PASS/d' "$RD/released.md" > "$RD/x7.md";                             stop released-without-p5 x7.md "released, but the record has no complete 'P5 RESULT ACCEPT PASS (1-4)' line"
  { cat "$RD/released.md"; echo "$RBL"; } > "$RD/x8.md";                                        stop released-with-rollback x8.md 'released, but the record also has a ROLLBACK RESULT line'
  sed "s/$INV_TUE/$SUN/" "$RD/released.md" > "$RD/x9.md";                                       stop released-sunday-inv x9.md "released, but the attested InvocationID is Sunday's"
  sed "/^PASS running invocation/d" "$RD/released.md" > "$RD/x10.md";                           stop released-inv-only-on-handoff-and-prose x10.md 'released needs exactly one P5 line'
  sed "s/^R6-HANDOFF current-id .*/R6-HANDOFF current-id $PREV/" "$RD/released.md" > "$RD/x11.md"; stop released-old-id x11.md 'released needs current-id 17822b29e6de-<BUILD_ID>'
  sed '/^ROLLBACK RESULT VERIFIED/d' "$RD/rb-accepted.md" > "$RD/x12.md";                      stop rollback-unverified x12.md 'an unverified rollback is NO-GO'
  sed "s/$INV_RB/$SUN/g" "$RD/rb-accepted.md" > "$RD/x13.md";                                   stop rollback-sunday-inv x13.md "rolledback, but the attested InvocationID is Sunday's"
  sed "s/attested-invocation $SUN/attested-invocation $INV_TUE/" "$RD/deferred.md" > "$RD/x14.md"; stop deferred-not-sunday x14.md "deferred needs Sunday's attested InvocationID"
  { cat "$RD/deferred.md"; echo "$P4P"; } > "$RD/x15.md";                                       stop deferred-but-promoted x15.md "deferred, but the record has 'P4 RESULT PROMOTED'"
  sed "s/attested-invocation $INV_TUE/attested-invocation ${INV_TUE^^}/" "$RD/released.md" > "$RD/x16.md"; stop uppercase-inv x16.md "malformed 'R6-HANDOFF attested-invocation"
  sed "s/attested-invocation $INV_TUE/attested-invocation ${INV_TUE:0:31}/" "$RD/released.md" > "$RD/x17.md"; stop short-inv x17.md "malformed 'R6-HANDOFF attested-invocation"

  # ---- r4: the reviewer-named defects (with the contrast against the original parser)
  rec n1.md "$P3B" "$P4P" "$INV5" "$P5T" "$P5A" "${HREL[@]}"
  stop released-with-p5-pass-and-p5-fail n1.md 'the record has 2 P5 terminal result lines'
  orig released-with-p5-pass-and-p5-fail n1.md
  rec n2.md "$P3B" "$P4P" "$INV5" "$P5T" "$RBL" "$INVR" "$RBV" "R6-HANDOFF tuesday-outcome rolledback" "R6-HANDOFF current-id $PREV" "R6-HANDOFF attested-invocation $INV_TUE"
  stop rollback-naming-the-initial-restart-id n2.md 'is the INITIAL (P5) restart, not the rollback restart'
  orig rollback-naming-the-initial-restart-id n2.md
  rec n3.md "$P3B" "$P5A" "${HDEF[@]}"
  stop deferred-with-p5-acceptance-but-no-p4 n3.md 'the record has a P5 result line but no P4 RESULT PROMOTED line: inconsistent record'
  orig deferred-with-p5-acceptance-but-no-p4 n3.md
  stop deferred-with-p5-acceptance-names-deferred-rule n3.md 'deferred, but the record has a P5 RESULT line'

  # ---- r4: only COMPLETE lines count
  rec n4.md "$P3B" "$P4P" "$INV5" "The script then printed $P5A and the owner agreed." "${HREL[@]}"
  stop p5-result-only-quoted-in-prose-not-counted n4.md "released, but the record has no complete 'P5 RESULT ACCEPT PASS (1-4)' line"
  stop p5-result-quoted-in-prose-is-flagged n4.md 'mention a result but are not a complete result line'
  rec n5.md "$P3B" "$P4P" "$INV5" "P5 RESULT ACCEPT PASS" "${HREL[@]}"
  stop p5-result-truncated-not-counted n5.md "released, but the record has no complete 'P5 RESULT ACCEPT PASS (1-4)' line"
  rec n6.md "$P3B" "$P4P" "$INV5" "$P5A (after a second try)" "${HREL[@]}"
  stop p5-result-with-suffix-not-counted n6.md "released, but the record has no complete 'P5 RESULT ACCEPT PASS (1-4)' line"
  rec n7.md "$P3B" "$P4P" "$INV5" "    $P5A" "${HREL[@]}"
  stop p5-result-indented-not-counted n7.md "released, but the record has no complete 'P5 RESULT ACCEPT PASS (1-4)' line"
  rec n8.md "$P3B" "$P4P" "$INV5" "| P5 | \`$P5A\` |" "${HREL[@]}"
  stop p5-result-in-table-cell-not-counted n8.md "released, but the record has no complete 'P5 RESULT ACCEPT PASS (1-4)' line"
  rec n9.md "$P3B" "P4 RESULT PROMOTED" "$INV5" "$P5A" "${HREL[@]}"
  stop p4-result-truncated-not-counted n9.md "released, but the record has no complete 'P4 RESULT PROMOTED <ts>: ...' line"
  rec n10.md "$P3B" "$P4P" "PASS running invocation = the owner's restart ${INV_TUE:0:31}" "$P5A" "${HREL[@]}"
  stop restart-line-truncated-id-not-counted n10.md 'released needs exactly one P5 line'
  rec n11.md "> $P4P" "${HDEF[@]}"
  stop deferred-with-quoted-promotion-line n11.md 'mention a result but are not a complete result line'
  rec n12.md "$RBV extra" "$P3B" "$P4P" "$INV5" "$P5A" "$RBL" "$INVR" "${HRB[@]}"
  stop rollback-verified-with-suffix-not-counted n12.md 'an unverified rollback is NO-GO'

  # ---- r4: contradictory or repeated terminal results
  rec n13.md "$P3B" "$P4P" "$INV5" "$P5A" "$RBL" "$INVR" "$RBF" "$RBV" "${HRB[@]}"
  stop rollback-verified-plus-verify-fail n13.md 'both ROLLBACK RESULT VERIFIED and ROLLBACK RESULT VERIFY FAIL'
  rec n14.md "$P3B" "$P4P" "$INV5" "$P5A" "$RBL" "$INVR" "$RBF" "${HRB[@]}"
  stop rollback-verify-fail-only n14.md "a failed rollback verify is NO-GO"
  rec n15.md "$P3B" "$P4P" "$INV5" "$P5A" "$P5A" "${HREL[@]}"
  stop released-two-p5-accept-lines n15.md 'the record has 2 P5 terminal result lines'
  rec n16.md "$P3B" "$P4P" "$INV5" "$P5C" "$P5A" "${HREL[@]}"
  stop released-p5-check4-fail-then-pass n16.md 'the record has 2 P5 terminal result lines'
  rec n17.md "$P3B" "$P4P" "$INV5" "$P5T" "${HREL[@]}"
  stop released-with-only-p5-fail n17.md 'released, but the record has a P5 RESULT FAIL line'
  rec n18.md "$P3B" "$P4P" "$INV5" "$P5A" "$RBL" "$INVR" "$RBV" "${HREL[@]}"
  stop released-with-verified-rollback n18.md 'released, but the record also has a ROLLBACK RESULT line'
  rec n19.md "$P3B" "$P4P" "$P4P" "$INV5" "$P5A" "${HREL[@]}"
  stop two-promotion-lines n19.md 'the record has 2 P4P lines'
  rec n20.md "$P3B" "$P4P" "$INV5" "$P5T" "$RBL" "$INVR" "$RBV" "$RBV" "${HRB[@]}"
  stop two-rollback-verified-lines n20.md 'the record has 2 RBV lines'
  rec n21.md "$RBL" "${HDEF[@]}"
  stop deferred-with-rollback-line n21.md 'deferred, but the record has a ROLLBACK RESULT line'
  rec n22.md "$P3B" "$P4P" "$INV5" "$P5T" "${HDEF[@]}"
  stop deferred-with-p4-and-p5-fail n22.md 'deferred, but the record has a P5 RESULT line'
  rec n23.md "$INV5" "${HDEF[@]}"
  stop deferred-with-restart-confirmation n23.md 'deferred, but the record has a restart confirmation line'
  rec n24.md "$P3B" "$P5A" "$INV5" "${HREL[@]}"
  stop released-p5-without-p4 n24.md 'the record has a P5 result line but no P4 RESULT PROMOTED line: inconsistent record'
  rec n25.md "$P3B" "$RBL" "$INVR" "$RBV" "${HRB[@]}"
  stop rollback-without-p4 n25.md 'the record has a ROLLBACK RESULT line but no P4 RESULT PROMOTED line: inconsistent record'
  rec n26.md "$P3B" "$P4P" "$INV5" "$P5T" "$INVR" "$RBV" "${HRB[@]}"
  stop rollback-without-links-switched n26.md "rolledback, but the record has no complete 'ROLLBACK RESULT LINKS SWITCHED"

  # ---- r4: the InvocationID is bound to the selected outcome's confirmation line
  rec n27.md "$P3B" "$P4P" "Owner restart 11:33: InvocationID $INV_TUE" "PASS running invocation = the owner's restart $INV_RB" "$P5A" "${HREL[@]}"
  stop released-inv-differs-from-p5-confirmation n27.md 'is not the one the accepting P5 run confirmed'
  rec n28.md "$P3B" "$P4P" "$INV5" "PASS running invocation = the owner's restart $INV_RB" "$P5A" "${HREL[@]}"
  stop released-two-restart-confirmations n28.md 'the record has 2 INV5 lines'
  rec n29.md "$P3B" "$P4P" "$INV5" "$P5T" "$RBL" "Owner rollback restart: InvocationID $INV_RB" "$RBV" "${HRB[@]}"
  stop rollback-without-verify-confirmation-line n29.md 'rolledback needs exactly one verify line'
  rec n30.md "$P3B" "$P4P" "PASS running invocation = the owner's restart $INV_RB" "$P5T" "$RBL" "$INVR" "$RBV" "${HRB[@]}"
  stop rollback-restart-id-equals-initial-id n30.md 'name the same InvocationID'
  rec n31.md "$P3B" "$P4P" "$INV5" "$P5A" "$INVR" "${HREL[@]}"
  stop released-with-rollback-restart-confirmation n31.md 'released, but the record has a rollback restart confirmation line'
  rec n32.md "$P3B" "$P4P" "$INV5" "$P5T" "$RBL" "PASS running invocation = the owner's rollback restart $INV_TUE" "$RBV" "${HRB[@]}"
  stop rollback-attested-id-not-on-verify-line n32.md 'is not the rollback restart the verify confirmed'

  # ---- r4: P3b binding and record order
  rec n33.md "P3b RESULT BUILD PASS 17822b29e6de-otherBuild" "$P4P" "$INV5" "$P5A" "${HREL[@]}"
  stop released-p3b-names-another-id n33.md "released needs exactly one complete 'P3b RESULT BUILD PASS <id>' line"
  rec n34.md "$P3B" "$INV5" "$P5A" "$P4P" "${HREL[@]}"
  stop released-p5-before-promotion n34.md 'record order: the INV5 line'
  rec n35.md "$P3B" "$P4P" "$RBL" "$INVR" "$RBV" "$INV5" "$P5A" "${HRB[@]}"
  stop rollback-verified-before-p5 n35.md 'record order: the RBL line'

  if [ "$BADN" = 0 ]; then echo "SUITE f1 RESULT PASS ($N cases)"; exit 0; fi
  echo "SUITE f1 RESULT FAIL ($BADN unexpected)"; exit 1
}
main "$@"
