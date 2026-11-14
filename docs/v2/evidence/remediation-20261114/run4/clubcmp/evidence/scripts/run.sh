#!/usr/bin/env bash
# rem4-clubcmp: run vitest integration files on a FRESH copy of a template.
#   run.sh <rb|snap|rbb> <pf|shared> <label> <timeout-s> <vitest file args...>
# pf     = AFLDB_TEST_PER_FILE_DB=all (each file its own database from the copy)
# shared = one database, files serially (AFLDB_TEST_PER_FILE_DB unset)
# Heavy (multi-file or club-comparison) runs take the heavy lock; set HEAVY=1.
set -uo pipefail
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
base=$1 mode=$2 label=$3 to=$4; shift 4
case "$base" in rb) T=$TMPL_RB;; snap) T=$TMPL_SN;; rbb) T=$TMPL_RBB;; *) echo bad base; exit 2;; esac
DB=afldb_v2_rem4clubcmp_${label//-/_}_test
IR create-db "$DB" --template "$T" 2>&1 | strip | tail -1
say "run $label base=$base mode=$mode db=$DB files: $*"
cd "$CAND"
PRE=(); [ -n "${HEAVY:-}" ] && PRE=(flock "$LOCK")
if [ "$mode" = pf ]; then
  "${PRE[@]}" timeout "$to" env CAND="$CAND" BASE="$DB" MODE=all bash "$CAND/docs/v2/evidence/remediation-20261114/run2/tests363/run-integration-per-file.sh" "$@" \
    --reporter=default --reporter=json --outputFile.json="$EV/$label.json" > "$EV/$label.log" 2>&1
else
  "${PRE[@]}" timeout "$to" node --import tsx tools/v2/isolated-pg.ts run "$DB" -- node node_modules/vitest/vitest.mjs run "$@" \
    --reporter=default --reporter=json --outputFile.json="$EV/$label.json" > "$EV/$label.log" 2>&1
fi
rc=$?
say "run $label rc=$rc"
if [ -f "$EV/$label.json" ]; then summ "$EV/$label.json" > "$EV/$label.summary.txt"; say "$label: $(head -1 "$EV/$label.summary.txt")"; fi
[ -n "${KEEP:-}" ] || IR drop-db "$DB" --acknowledge-destroy "$DB" >/dev/null 2>&1 || true
