#!/usr/bin/env bash
# muts.sh <rb|snap> : run every DB-data mutation against a fresh copy of that base
set -uo pipefail
W=/mnt/ssd/afldb-rem4-gates-20261115
case "$1" in
  rb) T=afldb_v2_rb_rem4gates_tmpl_test ;;
  snap) T=afldb_v2_rem4gates_snap_tmpl_test ;;
esac
n=$1
run() { echo "######## $n $1  ($3)"; bash $W/in/mut.sh "${1}_$n" $T $W/in/m_$1.sql "$2" 2>&1 | tail -8; }
run struct1 "has at most one season in progress" "a historical season left in progress"
run c261a "returns the cohort an independent oracle derives" "Brownlow row the career table does not know"
run c261b "returns the cohort an independent oracle derives" "cohort player moved out consistently"
run c261c "returns the cohort an independent oracle derives" "cohort player loses profile identity"
run att1 "records why each attendance is missing" "historical missing crowd becomes recorded"
run att2 "records why each attendance is missing" "pairing constraint dropped, crowd mislabelled"
run lad1 "attaches every ladder row" "Footscray 1950 filed under Sydney"
run lad2 "attaches every ladder row" "Sydney 1990 row lost"
run dob1 "populates the canonical dates" "historical player loses date"
run dob2 "keeps the evidence behind every recovered date" "club-list evidence row dropped and unlinked"
echo "######## $n DONE"
