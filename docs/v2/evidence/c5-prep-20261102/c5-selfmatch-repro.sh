#!/bin/bash
# READ-ONLY reproduction of the 2026-11-02 10:24:17Z process-count self-match, then the fixed helper. Run on afldb-prod as arm.
#   bash /home/arm/c5-selfmatch-repro-20261102.sh afldb-settle-afl-api.timer
# $1 exists only to put the unit name into THIS shell's argv, as the earlier ssh command line did. Nothing is changed.
N=924ff273261834e4112e3f41b61ceeab55427534
echo "== repro $(date -u +%FT%TZ) host=$(hostname) self=$$ argv: $0 $*"
echo "-- who matches the OLD pgrep pattern right now (pid args):"
pgrep -fa '[s]ettle-afl-api|[a]cquire-afl-api' | cut -c1-160 | sed 's/^/    /'
echo "-- OLD helper (r2) timer phase, process lines only:"
bash /home/arm/c5-observe-20261102-r2.sh timer $N 2>&1 | grep -E 'processes|^C5-OBSERVE'
echo "-- FIXED helper (r3) timer phase:"
bash /home/arm/c5-observe-20261102-r3.sh timer $N 2>&1 | grep -E 'processes|conflicting|^    [0-9]|^C5-OBSERVE'
. /home/arm/c5-proc-guard-20261102.sh
echo "-- REAL ps table through the guard (own transport excluded):"
ps -eo pid=,ppid=,comm=,args= | c5_conflicting_writers $$ | cut -c1-140 | sed 's/^/    /'; echo "    (count: $(ps -eo pid=,ppid=,comm=,args= | c5_conflicting_writers $$ | grep -c .))"
echo "-- REAL ps table + ONE INJECTED line (a text line, not a process) naming a writer:"
{ ps -eo pid=,ppid=,comm=,args=; echo '999999 1 node node tools/current-season/settle-afl-api.ts --apply   <INJECTED TEST LINE>'; } | c5_conflicting_writers $$ | cut -c1-140 | sed 's/^/    /'
echo "== end"
