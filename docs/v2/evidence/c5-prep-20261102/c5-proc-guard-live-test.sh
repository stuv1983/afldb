#!/bin/bash
# LIVE test of c5_conflicting_writers on a real Linux procps table. Run on a NON-production host only.
# It spawns ONE harmless probe (`bash -c 'sleep 40; :' settle-afl-api-probe`, not exec-optimised so its argv keeps the name) whose argv names a writer, checks it is
# detected, then kills that one pid. It touches nothing else and never runs on afldb-prod.
#   NOT RUN in the 2026-11-02 session (the DEV host refused SSH); run it on any non-production Linux host.
#   ssh <host> 'echo afldb-settle-afl-api.timer; bash /tmp/c5-proc-guard-live-test.sh'     (transport carries the unit name)
[ "$(hostname)" = afldb-prod ] && { echo "REFUSED: not on production"; exit 3; }
HERE=$(dirname "$(readlink -f "$0")"); . "$HERE/c5-proc-guard.sh" || exit 2
FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 (got $2)"; else echo "FAIL  $1 (got $2, expected $3)"; FAIL=$((FAIL+1)); fi; }
tbl() { ps -eo pid=,ppid=,comm=,args=; }
echo "host=$(hostname) self=$$ ancestors:"; p=$$; while [ "$p" -gt 1 ]; do printf '    %s\n' "$(ps -o pid=,ppid=,comm= -p "$p" | tr -s ' ')"; p=$(ps -o ppid= -p "$p" | tr -d ' '); done
echo "naive (old pgrep -f style) count of matching lines, own pgrep excluded: $(pgrep -fc '[s]ettle-afl-api|[a]cquire-afl-api' || true)"
check "real table: operator transport excluded, no writer present" "$(tbl | c5_conflicting_writers $$ | grep -c .)" 0
bash -c 'sleep 40; :' settle-afl-api-probe & PROBE=$!
sleep 1
check "real table: a genuine process naming a writer is detected" "$(tbl | c5_conflicting_writers $$ | grep -c .)" 1
tbl | c5_conflicting_writers $$ | cut -c1-120 | sed 's/^/    matched: /'
check "the matched pid is the probe" "$(tbl | c5_conflicting_writers $$ | awk '{print $1}')" "$PROBE"
kill "$PROBE" 2>/dev/null; wait "$PROBE" 2>/dev/null
check "after the probe is killed: back to 0" "$(tbl | c5_conflicting_writers $$ | grep -c .)" 0
[ "$FAIL" = 0 ] && echo "C5-PROC-GUARD-LIVE PASS" || { echo "C5-PROC-GUARD-LIVE FAIL"; exit 1; }
