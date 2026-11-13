#!/usr/bin/env bash
# hostops: assemble the host evidence (ANSI stripped, no DSNs) into $W/collect for copying back, and print sha256 of each file.
W=/mnt/ssd/afldb-rem-hostops-20261114
C="$W/collect"; rm -rf "$C"; mkdir -p "$C"
strip() { sed 's/\x1b\[[0-9;]*m//g' "$1" > "$C/$2"; }
strip "$W/evidence/red-351-unit.log" red-351-unit.txt
strip "$W/evidence/green-351-1.log" green-351-1-flock-queued-aborted.txt 2>/dev/null
strip "$W/evidence/green-351-3.log" green-351-3-final-code.txt
strip "$W/evidence/green-neighbours.log" green-neighbours.txt
cp "$W/restore-test-sh.out" "$C/restore-test-sh.txt"
cp "$W/rehearse.out" "$C/rehearse-352.txt"
cp "$W/rehearse-dr.out" "$C/rehearse-dr.txt"
cp "$W/evidence/verify-units.txt" "$W/evidence/node-modules-real.txt" "$W/evidence/host-gate-smoke.txt" "$W/evidence/needrestart-conf-check.txt" "$C/"
[ -s "$W/evidence/tsc.txt" ] && cp "$W/evidence/tsc.txt" "$C/tsc-cand-before-gate-fix.txt"
rm -f "$C/green-351-1-flock-queued-aborted.txt"
grep -lE "postgres(ql)?://[^ ]*:[^ ]*@" "$C"/* 2>/dev/null && echo "WARNING: a DSN-like string is present"
(cd "$C" && sha256sum * )
