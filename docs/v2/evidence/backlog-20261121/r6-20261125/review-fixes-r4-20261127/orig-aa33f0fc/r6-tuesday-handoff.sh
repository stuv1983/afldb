#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), before A-2: derive A-2's Tuesday arguments from the TUESDAY SITTING RECORD.
# Workstation (Git Bash) or any host; READ-ONLY: reads the one file named, writes nothing, makes no request, needs no network.
# R6 r3 (Astra, 24 Nov 2026): the attested InvocationID that A-2 compares with the live service must come from the sitting record,
# never from the live service or the latest events.log entry. This script is the only source of A-2's CURRENT_ID, tue: and inv:.
#
# The record (docs/v2/evidence/release-17822b29-20261124/SITTING-20261124.md) must contain exactly three lines carrying the
# token R6-HANDOFF, each exactly in this form (no indentation; a trailing CR is tolerated), owner-confirmed and copied from the
# record's own lines:
#   R6-HANDOFF tuesday-outcome <released|rolledback|deferred>
#   R6-HANDOFF current-id <full release id>
#   R6-HANDOFF attested-invocation <32 lowercase hex>
# Rules (any breach: STOP, exit 1; a missing record or usage error: exit 2):
#   released    current-id 17822b29e6de-<BUILD_ID>; the record contains "P3b RESULT BUILD PASS <current-id>" and
#               "P5 RESULT ACCEPT PASS", and no "ROLLBACK RESULT"; the attested ID is not Sunday's and appears in the record
#               at least twice (the handoff line and the owner's restart report or P5 line).
#   rolledback  current-id 7d92042fd110-XWruOm_9nLCSMY8nGPqYU; the record contains "ROLLBACK RESULT VERIFIED"; the attested ID
#               is not Sunday's and appears in the record at least twice (the handoff line and the rollback restart/verify).
#   deferred    current-id 7d92042fd110-XWruOm_9nLCSMY8nGPqYU; attested ID = Sunday's 342040625f6d4012a35d598dfbf9afe6; the
#               record contains neither "P4 RESULT PROMOTED" nor "ROLLBACK RESULT". (The record line itself is the confirmation
#               of deferral; without a Tuesday record there is no deferral.)
# Prints, on PASS:  R6-A2-TUESDAY tue:<outcome> / R6-A2-CURRENT_ID <id> / R6-A2-ATTESTED inv:<id> / R6 HANDOFF RESULT PASS
# Usage: bash r6-tuesday-handoff.sh <Tuesday sitting record>
main() {
  set -uo pipefail; export LC_ALL=C
  local rec=${1:-} text n outcome cur att stops=0
  local OLD_ID=7d92042fd110-XWruOm_9nLCSMY8nGPqYU SUNDAY_INV=342040625f6d4012a35d598dfbf9afe6
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
  has() { grep -Fq -- "$1" <<< "$text"; }
  seen_twice() { [ "$(grep -oF -- "$1" <<< "$text" | wc -l)" -ge 2 ]; }
  case $outcome in
    released)
      [[ $cur =~ ^17822b29e6de-[A-Za-z0-9_-]{1,64}$ ]] || stop "released needs current-id 17822b29e6de-<BUILD_ID>, not '$cur'"
      has "P3b RESULT BUILD PASS $cur" || stop "released, but the record has no 'P3b RESULT BUILD PASS $cur'"
      has 'P5 RESULT ACCEPT PASS' || stop "released, but the record has no 'P5 RESULT ACCEPT PASS'"
      ! has 'ROLLBACK RESULT' || stop "released, but the record also has a ROLLBACK RESULT line: ambiguous"
      [ "$att" != "$SUNDAY_INV" ] || stop "released, but the attested InvocationID is Sunday's: Tuesday's restart was not recorded"
      seen_twice "$att" || stop "the attested InvocationID $att appears only on the handoff line, not in the record's restart report";;
    rolledback)
      [ "$cur" = "$OLD_ID" ] || stop "rolledback needs current-id $OLD_ID, not '$cur'"
      has 'ROLLBACK RESULT VERIFIED' || stop "rolledback, but the record has no 'ROLLBACK RESULT VERIFIED': an unverified rollback is NO-GO"
      [ "$att" != "$SUNDAY_INV" ] || stop "rolledback, but the attested InvocationID is Sunday's: the rollback restart was not recorded"
      seen_twice "$att" || stop "the attested InvocationID $att appears only on the handoff line, not in the record's rollback restart report";;
    deferred)
      [ "$cur" = "$OLD_ID" ] || stop "deferred needs current-id $OLD_ID, not '$cur'"
      [ "$att" = "$SUNDAY_INV" ] || stop "deferred needs Sunday's attested InvocationID $SUNDAY_INV, not '$att'"
      ! has 'P4 RESULT PROMOTED' || stop "deferred, but the record has 'P4 RESULT PROMOTED': ambiguous"
      ! has 'ROLLBACK RESULT' || stop "deferred, but the record has a ROLLBACK RESULT line: ambiguous";;
  esac
  if [ "$stops" != 0 ]; then echo "R6 HANDOFF RESULT STOP ($stops): do not run A-2; R6 is NO-GO until the owner resolves the record"; exit 1; fi
  echo "R6-A2-TUESDAY tue:$outcome"
  echo "R6-A2-CURRENT_ID $cur"
  echo "R6-A2-ATTESTED inv:$att"
  echo "R6 HANDOFF RESULT PASS"
}
main "$@" < /dev/null
