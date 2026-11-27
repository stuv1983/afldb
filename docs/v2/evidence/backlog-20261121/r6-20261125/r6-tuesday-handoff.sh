#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), before A-2: derive A-2's Tuesday arguments from the TUESDAY SITTING RECORD.
# Workstation (Git Bash) or any host; READ-ONLY: reads the one file named, writes nothing, makes no request, needs no network.
# R6 r3 (Astra, 24 Nov 2026): the attested InvocationID that A-2 compares with the live service must come from the sitting record,
# never from the live service or the latest events.log entry. This script is the only source of A-2's CURRENT_ID, tue: and inv:.
# R6 r4 (Astra, 27 Nov 2026): results are matched as COMPLETE lines, contradictory terminal results are refused for every
# outcome, and the attested InvocationID is bound to the confirmation line of the SELECTED outcome (no "appears twice" test).
#
# The record (docs/v2/evidence/release-17822b29-20261124/SITTING-20261124.md) must contain exactly three lines carrying the
# token R6-HANDOFF, each exactly in this form (no indentation; a trailing CR is tolerated), owner-confirmed and copied from the
# record's own lines:
#   R6-HANDOFF tuesday-outcome <released|rolledback|deferred>
#   R6-HANDOFF current-id <full release id>
#   R6-HANDOFF attested-invocation <32 lowercase hex>
#
# Supporting result lines. A line counts only if the WHOLE line (after a trailing CR is removed) is exactly what the Tuesday
# script prints: no indentation, no quote mark, list marker, table cell, backticks, prefix or suffix. <ts> is date -u +%FT%TZ.
#   P3B   P3b RESULT BUILD PASS 17822b29e6de-<BUILD_ID>                                              (r1-p3b-build-check.sh)
#   P4P   P4 RESULT PROMOTED <ts>: OWNER NOW: RESTART block (runbook section 4.2), no later than 11:35 AEDT   (r1-p4-gate-promote.sh)
#   INV5  PASS running invocation = the owner's restart <32 hex>                                     (r1-p5-accept.sh)
#   P5A   P5 RESULT ACCEPT PASS (1-4)
#   P5T   P5 RESULT FAIL: ROLLBACK TRIGGER (1, 2 or 3)
#   P5C   P5 RESULT FAIL: check 4 only (owner decides; not a rollback trigger)
#   RBL   ROLLBACK RESULT LINKS SWITCHED <ts>: OWNER NOW: RESTART block (runbook section 4.2)        (r1-rollback.sh links)
#   INVR  PASS running invocation = the owner's rollback restart <32 hex>                            (r1-rollback.sh verify)
#   RBV   ROLLBACK RESULT VERIFIED (1-3): now r1-rawhead.sh check and S9 with XWruOm_9nLCSMY8nGPqYU
#   RBF   ROLLBACK RESULT VERIFY FAIL: owner; site state as printed
# Fenced blocks: a Markdown fence is not interpreted. The record pastes script output as unindented excerpts inside ``` fences,
# so a complete line counts inside or outside a fence alike; an indented fence (inside a list item) does not hold complete lines.
# Mentions: any other line that contains "P3b RESULT BUILD PASS", "P4 RESULT", "P5 RESULT", "ROLLBACK RESULT" or
# "running invocation = the owner's" (prose, a quotation, a truncated or extended line) is NOT a result and is itself a STOP:
# the record must state each result once, as the script printed it, so that nothing is left to interpretation.
#
# Rules (any breach: STOP, exit 1; a missing record or usage error: exit 2):
#   every outcome   at most one of each of P4P, INV5, RBL, INVR, RBV, RBF; at most one P5 terminal line in total (P5A + P5T +
#               P5C); never RBV with RBF; a P5 or rollback line needs P4P; INV5 and INVR never name the same ID.
#   released    current-id 17822b29e6de-<BUILD_ID>; exactly one P3B line and it names current-id; exactly one P4P; the one P5
#               terminal line is P5A; no RBL/RBV/RBF/INVR; exactly one INV5 line and the attested ID is the ID on it (the
#               restart the accepting P5 run confirmed), not Sunday's; record order P3B, P4P, INV5, P5A.
#   rolledback  current-id 7d92042fd110-XWruOm_9nLCSMY8nGPqYU; exactly one each of P4P, RBL, INVR, RBV; no RBF; the attested ID
#               is the ID on the INVR line (the rollback restart the verify confirmed), not Sunday's, and differs from the INV5
#               ID when the record has one. Zero or one P5 terminal line of any kind is valid before the rollback (accepted
#               then a later rollback trigger; P5 rollback trigger; check 4 only with the owner choosing rollback; or no P5 at
#               all). Record order P4P, INV5, P5 line, RBL, INVR, RBV (those present).
#   deferred    current-id 7d92042fd110-XWruOm_9nLCSMY8nGPqYU; attested ID = Sunday's 342040625f6d4012a35d598dfbf9afe6; the
#               record contains NO P4P, P5A, P5T, P5C, RBL, RBV, RBF, INV5 or INVR line. (The record line itself is the
#               confirmation of deferral; without a Tuesday record there is no deferral.)
# What a PASS does NOT decide. This parser judges only whether the record is internally consistent and unambiguous for the
# outcome its handoff lines claim. Whether the owner accepts a deferral as "before P4" is the owner's ruling, recorded
# separately; it is not a parser rule. A P4 REFUSAL ("STOP past the promotion cutoff ...") is not a P4 RESULT line: it is
# reported in an R6-NOTE and neither supports nor stops any outcome. R6 stays NO-GO on an owner ruling whatever is printed here.
# Prints, on PASS:  R6-A2-TUESDAY tue:<outcome> / R6-A2-CURRENT_ID <id> / R6-A2-ATTESTED inv:<id> / [R6-NOTE ... for deferred] /
#                   R6 HANDOFF RESULT PASS
# Usage: bash r6-tuesday-handoff.sh <Tuesday sitting record>
main() {
  set -uo pipefail; export LC_ALL=C
  local rec=${1:-} text n outcome cur att stops=0 k p5 rb inv5 invr bad refused
  local OLD_ID=7d92042fd110-XWruOm_9nLCSMY8nGPqYU SUNDAY_INV=342040625f6d4012a35d598dfbf9afe6 OLD_BUILD=XWruOm_9nLCSMY8nGPqYU
  local TS='[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' HEX='[0-9a-f]{32}'
  local KEYS='P3B P4P INV5 P5A P5T P5C RBL INVR RBV RBF'
  local -A RX C
  RX[P3B]="P3b RESULT BUILD PASS 17822b29e6de-[A-Za-z0-9_-]{1,64}"
  RX[P4P]="P4 RESULT PROMOTED $TS: OWNER NOW: RESTART block \(runbook section 4\.2\), no later than 11:35 AEDT"
  RX[INV5]="PASS running invocation = the owner's restart $HEX"
  RX[P5A]="P5 RESULT ACCEPT PASS \(1-4\)"
  RX[P5T]="P5 RESULT FAIL: ROLLBACK TRIGGER \(1, 2 or 3\)"
  RX[P5C]="P5 RESULT FAIL: check 4 only \(owner decides; not a rollback trigger\)"
  RX[RBL]="ROLLBACK RESULT LINKS SWITCHED $TS: OWNER NOW: RESTART block \(runbook section 4\.2\)"
  RX[INVR]="PASS running invocation = the owner's rollback restart $HEX"
  RX[RBV]="ROLLBACK RESULT VERIFIED \(1-3\): now r1-rawhead\.sh check and S9 with $OLD_BUILD"
  RX[RBF]="ROLLBACK RESULT VERIFY FAIL: owner; site state as printed"
  [ "$#" = 1 ] && [ -n "$rec" ] || { echo "STOP usage: r6-tuesday-handoff.sh <Tuesday sitting record>"; exit 2; }
  [ -f "$rec" ] && [ -r "$rec" ] || { echo "STOP no readable Tuesday sitting record at '$rec': no Tuesday outcome, so R6 is NO-GO"; exit 2; }
  text=$(tr -d '\r' < "$rec") || { echo "STOP cannot read $rec"; exit 2; }
  echo "== R6 Tuesday handoff $(date -u +%FT%TZ) record=$rec sha256=$(sha256sum < "$rec" | cut -c1-64)"
  stop() { echo "STOP $*"; stops=$((stops + 1)); }
  n=$(grep -c 'R6-HANDOFF' <<< "$text")
  [ "$n" = 3 ] || stop "the record has $n lines mentioning R6-HANDOFF (need exactly 3: tuesday-outcome, current-id, attested-invocation)"
  one() { # key regex-for-value -> the value, if exactly one strict line has that key
    local lines; lines=$(grep -E "^R6-HANDOFF $1 " <<< "$text")
    [ "$(grep -c . <<< "$lines")" = 1 ] || { echo "?"; return 1; }
    [[ $lines =~ ^R6-HANDOFF\ $1\ ($2)$ ]] || { echo "?"; return 1; }
    echo "${BASH_REMATCH[1]}"
  }
  outcome=$(one tuesday-outcome 'released|rolledback|deferred') || stop "missing, repeated or ambiguous 'R6-HANDOFF tuesday-outcome released|rolledback|deferred' line"
  cur=$(one current-id '[A-Za-z0-9_-]{1,80}') || stop "missing, repeated or malformed 'R6-HANDOFF current-id <id>' line"
  att=$(one attested-invocation '[0-9a-f]{32}') || stop "missing, repeated or malformed 'R6-HANDOFF attested-invocation <32 hex>' line"
  # complete result lines: count each kind; any other mention of a result token is a STOP
  for k in $KEYS; do C[$k]=$(grep -cxE -- "${RX[$k]}" <<< "$text"); done
  first() { grep -nxE -- "${RX[$1]}" <<< "$text" | head -n 1 | cut -d: -f1; }
  idof() { grep -xE -- "${RX[$1]}" <<< "$text" | head -n 1 | grep -oE "$HEX\$"; }
  bad=$(grep -nE "P3b RESULT BUILD PASS|P4 RESULT|P5 RESULT|ROLLBACK RESULT|running invocation = the owner's" <<< "$text" \
    | grep -vE "^[0-9]+:(${RX[P3B]}|${RX[P4P]}|${RX[INV5]}|${RX[P5A]}|${RX[P5T]}|${RX[P5C]}|${RX[RBL]}|${RX[INVR]}|${RX[RBV]}|${RX[RBF]})\$" | cut -d: -f1 | tr '\n' ' ')
  [ -z "$bad" ] || stop "record line(s) ${bad% } mention a result but are not a complete result line as the script prints it (prose, quoted, indented, truncated or extended): not counted, and the record is ambiguous until each result appears exactly as printed"
  p5=$((C[P5A] + C[P5T] + C[P5C])); rb=$((C[RBL] + C[RBV] + C[RBF]))
  refused=$(grep -c '^STOP past the promotion cutoff ' <<< "$text")
  echo "   complete result lines: P3B=${C[P3B]} P4P=${C[P4P]} INV5=${C[INV5]} P5A=${C[P5A]} P5T=${C[P5T]} P5C=${C[P5C]} RBL=${C[RBL]} INVR=${C[INVR]} RBV=${C[RBV]} RBF=${C[RBF]}; P4 cutoff-refusal lines (not a result): $refused"
  for k in P4P INV5 RBL INVR RBV RBF; do [ "${C[$k]}" -le 1 ] || stop "the record has ${C[$k]} $k lines (at most one): repeated result, ambiguous"; done
  [ "$p5" -le 1 ] || stop "the record has $p5 P5 terminal result lines (ACCEPT PASS ${C[P5A]}, ROLLBACK TRIGGER ${C[P5T]}, check 4 only ${C[P5C]}): contradictory or repeated, at most one"
  [ "${C[RBV]}" = 0 ] || [ "${C[RBF]}" = 0 ] || stop "the record has both ROLLBACK RESULT VERIFIED and ROLLBACK RESULT VERIFY FAIL: contradictory"
  [ "$p5" = 0 ] || [ "${C[P4P]}" != 0 ] || stop "the record has a P5 result line but no P4 RESULT PROMOTED line: inconsistent record"
  [ "$rb" = 0 ] || [ "${C[P4P]}" != 0 ] || stop "the record has a ROLLBACK RESULT line but no P4 RESULT PROMOTED line: inconsistent record"
  inv5=$(idof INV5) || inv5=; invr=$(idof INVR) || invr=
  [ -z "$inv5" ] || [ "$inv5" != "$invr" ] || stop "the P5 restart line and the rollback restart line name the same InvocationID $inv5: the rollback restart was not recorded"
  ordered() { # keys in the required record order; only the kinds present are compared
    local prev=0 pk= ln
    for k in "$@"; do [ "${C[$k]}" != 0 ] || continue; ln=$(first "$k")
      [ "$ln" -gt "$prev" ] || stop "record order: the $k line (line $ln) comes before the $pk line (line $prev)"; prev=$ln; pk=$k; done
  }
  case $outcome in
    released)
      [[ $cur =~ ^17822b29e6de-[A-Za-z0-9_-]{1,64}$ ]] || stop "released needs current-id 17822b29e6de-<BUILD_ID>, not '$cur'"
      { [ "${C[P3B]}" = 1 ] && [ "$(grep -cxF -- "P3b RESULT BUILD PASS $cur" <<< "$text")" = 1 ]; } || stop "released needs exactly one complete 'P3b RESULT BUILD PASS <id>' line and it must name $cur (found ${C[P3B]} P3B lines)"
      [ "${C[P4P]}" = 1 ] || stop "released, but the record has no complete 'P4 RESULT PROMOTED <ts>: ...' line"
      [ "${C[P5A]}" = 1 ] || stop "released, but the record has no complete 'P5 RESULT ACCEPT PASS (1-4)' line"
      [ "$((C[P5T] + C[P5C]))" = 0 ] || stop "released, but the record has a P5 RESULT FAIL line: contradictory"
      [ "$rb" = 0 ] || stop "released, but the record also has a ROLLBACK RESULT line: ambiguous"
      [ "${C[INVR]}" = 0 ] || stop "released, but the record has a rollback restart confirmation line: ambiguous"
      [ "$att" != "$SUNDAY_INV" ] || stop "released, but the attested InvocationID is Sunday's: Tuesday's restart was not recorded"
      [ "${C[INV5]}" = 1 ] || stop "released needs exactly one P5 line \"PASS running invocation = the owner's restart <32 hex>\" (found ${C[INV5]}): the attested InvocationID is not bound to the accepting P5 run"
      [ "${C[INV5]}" != 1 ] || [ "$inv5" = "$att" ] || stop "released, but the attested InvocationID $att is not the one the accepting P5 run confirmed ($inv5)"
      ordered P3B P4P INV5 P5A;;
    rolledback)
      [ "$cur" = "$OLD_ID" ] || stop "rolledback needs current-id $OLD_ID, not '$cur'"
      [ "${C[P4P]}" = 1 ] || stop "rolledback, but the record has no complete 'P4 RESULT PROMOTED <ts>: ...' line: nothing was promoted to roll back"
      [ "${C[RBL]}" = 1 ] || stop "rolledback, but the record has no complete 'ROLLBACK RESULT LINKS SWITCHED <ts>: ...' line"
      [ "${C[RBV]}" = 1 ] || stop "rolledback, but the record has no complete 'ROLLBACK RESULT VERIFIED (1-3): ...' line: an unverified rollback is NO-GO"
      [ "${C[RBF]}" = 0 ] || stop "rolledback, but the record has 'ROLLBACK RESULT VERIFY FAIL': a failed rollback verify is NO-GO"
      [ "$att" != "$SUNDAY_INV" ] || stop "rolledback, but the attested InvocationID is Sunday's: the rollback restart was not recorded"
      [ "${C[INVR]}" = 1 ] || stop "rolledback needs exactly one verify line \"PASS running invocation = the owner's rollback restart <32 hex>\" (found ${C[INVR]}): the attested InvocationID is not bound to the rollback verify"
      [ "${C[INVR]}" != 1 ] || [ "$invr" = "$att" ] || stop "rolledback, but the attested InvocationID $att is not the rollback restart the verify confirmed ($invr)"
      [ -z "$inv5" ] || [ "$inv5" != "$att" ] || stop "rolledback, but the attested InvocationID $att is the INITIAL (P5) restart, not the rollback restart"
      ordered P4P INV5 P5A P5T P5C RBL INVR RBV;;
    deferred)
      [ "$cur" = "$OLD_ID" ] || stop "deferred needs current-id $OLD_ID, not '$cur'"
      [ "$att" = "$SUNDAY_INV" ] || stop "deferred needs Sunday's attested InvocationID $SUNDAY_INV, not '$att'"
      [ "${C[P4P]}" = 0 ] || stop "deferred, but the record has 'P4 RESULT PROMOTED': ambiguous"
      [ "$p5" = 0 ] || stop "deferred, but the record has a P5 RESULT line: ambiguous"
      [ "$rb" = 0 ] || stop "deferred, but the record has a ROLLBACK RESULT line: ambiguous"
      [ "$((C[INV5] + C[INVR]))" = 0 ] || stop "deferred, but the record has a restart confirmation line (PASS running invocation = the owner's ...): ambiguous"
      # a P4 or rollback interrupted after release.mjs switched the links prints the tool's line but no RESULT line
      tool=$(grep -cE '(^|[^A-Za-z])release: (PROMOTED|ROLLED BACK) ' <<< "$text")
      [ "$tool" = 0 ] || stop "deferred, but the record has $tool release.mjs 'release: PROMOTED ...' or 'release: ROLLED BACK ...' line(s): the links were switched, so this is not a deferral";;
  esac
  if [ "$stops" != 0 ]; then echo "R6 HANDOFF RESULT STOP ($stops): do not run A-2; R6 is NO-GO until the owner resolves the record"; exit 1; fi
  echo "R6-A2-TUESDAY tue:$outcome"
  echo "R6-A2-CURRENT_ID $cur"
  echo "R6-A2-ATTESTED inv:$att"
  if [ "$outcome" = deferred ]; then
    echo "R6-NOTE parser PASS means only that the record is internally consistent for 'deferred' (no P4, P5 or rollback result line). It does NOT decide whether the owner accepts this deferral as \"before P4\": that is the owner's ruling, recorded separately; this parser neither applies nor replaces it."
    [ "$refused" = 0 ] || echo "R6-NOTE the record has $refused P4 cutoff-refusal line(s) ('STOP past the promotion cutoff ...'): P4 was run and refused. A refusal is not a P4 RESULT line and is not judged here."
  fi
  echo "R6 HANDOFF RESULT PASS"
}
main "$@" < /dev/null
