#!/usr/bin/env bash
# Read-only on streamanator; explicit Melbourne DATE, overnight DUMP, full production SHA.
# ISSUE-352: three distinct outcomes, exit status = the verifier's (0 verified scheduled copy, 10 copy verified but scheduled
# origin unproven, 1 copy failed, 2 usage, 127 verifier absent). Only 0 is a PASS.
set -uo pipefail
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}
rc=0
bash "$OPS/scheduled-pull-evidence.sh" "${1:?DATE}" "${2:?DUMP}" "${3:?SHA256}" || rc=$?
case $rc in
  0)  echo 'R6 OFFHOST RESULT PASS' ;;
  10) echo 'R6 OFFHOST RESULT COPY-VERIFIED-ORIGIN-UNPROVEN (not a PASS: record the gap; a retry cannot supply the missing scheduled evidence)' ;;
  *)  echo "R6 OFFHOST RESULT FAIL (verifier exit $rc)" ;;
esac
exit "$rc"
