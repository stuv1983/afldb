#!/usr/bin/env bash
# probeq.sh <db> <sqlfile> [w]: SQL against a scratch probe database (read-only unless 'w')
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
if [ "${3:-}" = w ]; then Wf "$1" "$2"; else Qf "$1" "$2"; fi
