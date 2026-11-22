#!/usr/bin/env bash
# Read-only on streamanator; explicit Melbourne DATE, overnight DUMP, full production SHA.
set -euo pipefail
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}
bash "$OPS/scheduled-pull-evidence.sh" "${1:?DATE}" "${2:?DUMP}" "${3:?SHA256}"
echo 'R6 OFFHOST RESULT PASS'
