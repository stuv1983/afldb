#!/bin/bash
# Table-driven test of c5_conflicting_writers (c5-proc-guard.sh). Pure text: reads fixtures, starts nothing.
#   bash c5-proc-guard-test.sh            (run from this directory)
cd "$(dirname "$0")" || exit 2
. ./c5-proc-guard.sh
FAIL=0; PASSN=0
count() { c5_conflicting_writers "$1" | grep -c . ; }
naive() { grep -cE 'settle-afl-api|acquire-afl-api'; }   # the old pgrep -f behaviour over the same table (own pgrep excluded)
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 (got $2)"; PASSN=$((PASSN+1)); else echo "FAIL  $1 (got $2, expected $3)"; FAIL=$((FAIL+1)); fi; }

BASE='1 0 systemd /sbin/init
900 1 sshd sshd: /usr/sbin/sshd -D
2000 900 sshd sshd: arm [priv]
2010 2000 sshd sshd: arm@notty
2020 2010 bash bash -c systemctl show afldb-settle-afl-api.timer; bash /home/arm/c5-observe-r3.sh timer 924ff273261834e4112e3f41b61ceeab55427534
2030 2020 bash bash /home/arm/c5-observe-r3.sh timer 924ff273261834e4112e3f41b61ceeab55427534
2040 2030 bash bash /home/arm/c5-observe-r3.sh timer 924ff273261834e4112e3f41b61ceeab55427534
2041 2040 ps ps -eo pid=,ppid=,comm=,args=
2042 2040 awk awk -v self=2030 -v a=settle -v b=acquire -v c=-afl-api'

echo "== the observed defect (2026-11-02 10:24:17Z): transport only, no writer"
check "old behaviour reproduces: naive count over the table"   "$(printf '%s\n' "$BASE" | naive)" 1
check "fixed guard: operator's own transport is excluded"       "$(printf '%s\n' "$BASE" | count 2030)" 0
check "fixed guard: nothing else matched either"                "$(printf '%s\n' "$BASE" | c5_conflicting_writers 2030 | wc -l | tr -d ' ')" 0

echo "== genuine conflicting writers stay detected (each added to the same transport table)"
W1='3000 1 node /usr/bin/node --import tsx tools/current-season/settle-afl-api.ts --apply --auto-apply --require-complete-source'
W2='3001 1 node /usr/bin/node --import tsx tools/current-season/acquire-afl-api.ts --season 2027'
W3='3100 1 bash /bin/bash /home/arm/projects/afldb/deploy/afldb-settle-afl-api.sh'
W4='3200 1 node /usr/bin/node --import tsx tools/current-season/settle-afl-api-brownlow.ts --apply'
W5='2025 2020 node node tools/current-season/settle-afl-api.ts --apply'
for spec in "systemd-started settle:$W1" "systemd-started acquire:$W2" "unit wrapper script:$W3" "brownlow settle:$W4" "writer started by the SAME operator command (sibling of the helper):$W5"; do
  name=${spec%%:*}; line=${spec#*:}
  check "detected: $name" "$(printf '%s\n%s\n' "$BASE" "$line" | count 2030)" 1
done
check "two writers = two" "$(printf '%s\n%s\n%s\n' "$BASE" "$W1" "$W2" | count 2030)" 2
printf '%s\n%s\n' "$BASE" "$W1" | c5_conflicting_writers 2030 | grep -q '^3000 ' && check "the reported line is the writer, not the transport" ok ok || check "the reported line is the writer, not the transport" bad ok

echo "== the helper's own forks carry its argv (observed in the production repro 10:44:11Z)"
FORKS='2020 2010 bash bash /home/arm/c5-selfmatch-repro-20261102.sh afldb-settle-afl-api.timer
2030 2020 bash bash /home/arm/c5-selfmatch-repro-20261102.sh afldb-settle-afl-api.timer
2031 2030 bash bash /home/arm/c5-selfmatch-repro-20261102.sh afldb-settle-afl-api.timer
2032 2030 bash bash /home/arm/c5-selfmatch-repro-20261102.sh afldb-settle-afl-api.timer
2010 2000 sshd sshd: arm@notty'
check "forks of the helper whose argv names the unit are excluded" "$(printf '%s
' "$FORKS" | count 2030)" 0
check "...but a different-argv writer next to those forks is detected" "$(printf '%s
%s
' "$FORKS" "$W1" | count 2030)" 1
check "...and a writer that is a CHILD of the helper (different argv) is detected" "$(printf '%s
%s
' "$FORKS" '2050 2030 node node tools/current-season/settle-afl-api.ts --apply' | count 2030)" 1

echo "== exclusion is limited to wrapper ancestors"
PARENT='3500 1 node /usr/bin/node --import tsx tools/current-season/settle-afl-api.ts --apply
2030 3500 bash bash /home/arm/c5-observe-r3.sh timer N'
check "a WRITER that launched the helper is not excluded"        "$(printf '%s\n' "$PARENT" | count 2030)" 1
SUDO='2010 1 sudo sudo -u arm bash -c systemctl show afldb-settle-afl-api.timer; bash /home/arm/c5-observe-r3.sh timer N
2030 2010 bash bash /home/arm/c5-observe-r3.sh timer N'
check "sudo/bash transport carrying the unit name is excluded"    "$(printf '%s\n' "$SUDO" | count 2030)" 0
check "unrelated processes never match"                           "$(printf '%s\n%s\n' "$BASE" '4000 1 node node next start' | count 2030)" 0
NONWRAP='2020 1 python3 python3 /opt/runner.py settle-afl-api-probe
2030 2020 bash bash /home/arm/c5-observe-r3.sh timer N'
check "a non-wrapper ancestor (python) naming a writer is NOT excluded" "$(printf '%s\n' "$NONWRAP" | count 2030)" 1

echo "== $PASSN passed, $FAIL failed"
[ "$FAIL" = 0 ] && echo "C5-PROC-GUARD-TEST PASS" || { echo "C5-PROC-GUARD-TEST FAIL"; exit 1; }
