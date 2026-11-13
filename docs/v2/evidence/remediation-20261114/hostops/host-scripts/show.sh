#!/usr/bin/env bash
# hostops: summarise a Vitest log (ANSI stripped): failed test names, first assertion lines, totals.
f="/mnt/ssd/afldb-rem-hostops-20261114/evidence/$1.log"
sed 's/\x1b\[[0-9;]*m//g' "$f" > "$f.plain"
grep -E "^ *(FAIL|×)" "$f.plain" | sort -u | head -${2:-30}
echo ---
grep -E "AssertionError|TypeError|Error:" "$f.plain" | sort | uniq -c | sort -rn | head -${3:-12}
echo ---
grep -E "Test Files|Tests  |Duration" "$f.plain"
