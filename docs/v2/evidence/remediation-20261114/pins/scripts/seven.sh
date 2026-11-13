#!/usr/bin/env bash
# run the seven uninvoked tests/python contracts directly, with the venv and the system python3
. /mnt/ssd/afldb-rem-pins-20261114/in/env.sh
cd "$CAND" || exit 1
echo "HEAD=$(git rev-parse HEAD)"
for n in brownlow_afl_api_season_rehearsal_contract draftguru_bridge_v2_contract draftguru_child_validation_v3_contract draftguru_population_scan_contract fitzroy_profile_continuity_contract issue333_o2_contract settle_emit_contract; do
  for py in "$VENVPY" python3; do
    out=$($py tests/python/$n.py 2>&1); rc=$?
    echo "== $n [$py] rc=$rc lines=$(echo "$out" | wc -l)"
    echo "$out" | grep -v "^PASS" | tail -6 | cut -c1-220
    echo "   last: $(echo "$out" | tail -1 | cut -c1-160)"
  done
done
