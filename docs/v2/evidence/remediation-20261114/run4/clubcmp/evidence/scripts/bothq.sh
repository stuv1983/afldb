#!/usr/bin/env bash
# bothq.sh <sqlfile>: read-only SQL against both pristine templates
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
for t in "$TMPL_RB" "$TMPL_SN"; do echo "=== $t"; Qf "$t" "$1"; done
