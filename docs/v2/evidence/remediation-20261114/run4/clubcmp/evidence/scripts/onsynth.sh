#!/usr/bin/env bash
# onsynth.sh <rb|snap> <label> <timeout-s> <vitest file args...>: vitest (shared mode) on a fresh clone of the synthetic-2067 base copy
set -uo pipefail
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
b=$1 label=$2 to=$3; shift 3
BASEDB=afldb_v2_rem4clubcmp_synth_${b}_base_test
DB=afldb_v2_rem4clubcmp_${label//-/_}_test
IR create-db "$DB" --template "$BASEDB" 2>&1 | strip | tail -1
say "onsynth $label base=$b db=$DB files: $*"
cd "$CAND"
timeout "$to" node --import tsx tools/v2/isolated-pg.ts run "$DB" -- node node_modules/vitest/vitest.mjs run "$@" \
  --reporter=default --reporter=json --outputFile.json="$EV/$label.json" > "$EV/$label.log" 2>&1
rc=$?
say "onsynth $label rc=$rc"
[ -f "$EV/$label.json" ] && { summ "$EV/$label.json" > "$EV/$label.summary.txt"; say "$label: $(head -1 "$EV/$label.summary.txt")"; }
[ -n "${KEEP:-}" ] || IR drop-db "$DB" --acknowledge-destroy "$DB" >/dev/null 2>&1 || true
