#!/usr/bin/env bash
W=/mnt/ssd/afldb-rem3-stateb-20261114
export CAND=$W/cand
. <(sed -n '/^W=/,/^strip()/p' "$W/in/h.sh")
bash "$W/in/summall.sh" mutsb mutsa basesa 2>&1 | cut -c1-300
echo "--- ISSUE-276 existing canonical row on the template (aggregates)"
IR create-db afldb_v2_rem3stateb_q276_test --template "$TMPL" 2>&1 | strip | tail -1
RUNDB afldb_v2_rem3stateb_q276_test node "$W/in/q276.mjs" 2>&1 | strip | grep -v '^isolated-pg:'
IR drop-db afldb_v2_rem3stateb_q276_test --acknowledge-destroy afldb_v2_rem3stateb_q276_test 2>&1 | strip | tail -1
