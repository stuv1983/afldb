#!/usr/bin/env bash
# final.sh <tag(lowercase)> <it|dbmuts-rb|dbmuts-snap|srcmuts|full> : the evidence set at the current cand HEAD
set -uo pipefail
W=/mnt/ssd/afldb-rem4-gates-20261115
tag=$1; what=${2:-full}
cd $W/cand
echo "CHECKOUT HEAD $(git rev-parse HEAD) porcelain $(git status --porcelain | wc -l)"
RB=afldb_v2_rb_rem4gates_tmpl_test; SN=afldb_v2_rem4gates_snap_tmpl_test
if [ "$what" = it ] || [ "$what" = full ]; then
  for b in rb:$RB snap:$SN; do
    n=${b%%:*}; d=${b#*:}
    for mode in shared all; do
      echo "######## $tag $n $mode"
      bash $W/scripts/it.sh ${tag}_${n}_${mode} $d $mode tests/integration/release-gates.test.ts 2>&1 | tail -14
    done
  done
fi
if [ "$what" = dbmuts-rb ] || [ "$what" = full ]; then bash $W/in/muts.sh rb 2>&1 | cut -c1-420; fi
if [ "$what" = dbmuts-snap ] || [ "$what" = full ]; then bash $W/in/muts.sh snap 2>&1 | cut -c1-420; fi
if [ "$what" = srcmuts ] || [ "$what" = full ]; then
  for b in rb:$RB snap:$SN; do
    n=${b%%:*}; d=${b#*:}
    for m in g1 g2 g3; do
      echo "######## src-mutation $m $n"
      bash $W/in/srcmut.sh ${m}_$n $d src/db/queries/player-derived.ts $W/in/$m.sed "a season in progress is provisional" 2>&1 | cut -c1-420 | tail -14
    done
  done
fi
echo "######## FINAL DONE $tag $what; HEAD $(git rev-parse HEAD) porcelain $(git status --porcelain | wc -l)"
