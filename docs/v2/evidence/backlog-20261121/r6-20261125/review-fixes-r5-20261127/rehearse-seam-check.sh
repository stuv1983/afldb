#!/usr/bin/env bash
# R6 r5 (27 Nov 2026): the two release-rehearsal checks that touch r1-g0-dump.sh, run alone (the full rehearsal needs a bundle of
# 17822b29 and a node_modules, see release-17822b29-20261124/rehearsal/rehearse.sh lines 57-61): (1) pick_overnight_dump is identical in
# r1-g0-dump.sh and r6-pre-verify.sh (rehearse.sh line 60, same extraction), (2) G0 loads through its R1_LIB_ONLY seam without running
# main and defines the functions. Usage: bash rehearse-seam-check.sh <FIX>. Runs nothing else.
set -uo pipefail; FIX=${1:?FIX}; E=$FIX/docs/v2/evidence
S=$E/release-17822b29-20261124/scripts; R6=$E/backlog-20261121/r6-20261125
fn() { sed -n "/^$2() {/,/^}/p" "$1" | sha256sum | cut -c1-64; }
a=$(fn "$S/r1-g0-dump.sh" pick_overnight_dump); b=$(fn "$R6/r6-pre-verify.sh" pick_overnight_dump); n=0
[ "$a" = "$b" ] && [ -n "$a" ] && echo "SEAM PASS pick_overnight_dump identical ($a)" || { echo "SEAM FAIL pick_overnight_dump differs: $a $b"; n=1; }
for f in ts timer_usec read_invocation backup_journal match_backup scheduled_backup_run; do
  [ "$(fn "$S/r1-g0-dump.sh" $f)" = "$(fn "$R6/r6-pre-verify.sh" $f)" ] && echo "SEAM PASS $f identical" || { echo "SEAM FAIL $f differs"; n=1; }; done
out=$(R1_LIB_ONLY=1 bash -c ". '$S/r1-g0-dump.sh'; type pick_overnight_dump match_backup timer_usec scheduled_backup_run > /dev/null && echo LOADED" 2>&1)
[ "$out" = LOADED ] && echo "SEAM PASS R1_LIB_ONLY load defines the functions and runs no main" || { echo "SEAM FAIL load: $out"; n=1; }
[ $n = 0 ] && echo "SEAM RESULT PASS" || { echo "SEAM RESULT FAIL"; exit 1; }
