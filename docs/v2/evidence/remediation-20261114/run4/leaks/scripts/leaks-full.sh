#!/usr/bin/env bash
# run-4 leaks scope: full-order shared-mode attribution runs (99 files, c2 order), heavy lock per file.
set -u -o pipefail
IN=/mnt/ssd/afldb-rem4-leaks-20261115/in; W=/mnt/ssd/afldb-rem4-leaks-20261115
until grep -q "attrib redsnap: done" $W/evidence/run-redsnap.out 2>/dev/null; do sleep 20; done
CAND=$W/cand     bash $IN/leaks-attrib.sh greensnap afldb_v2_rem4leaks_snap_tmpl_test $IN/c2-order.txt > $W/evidence/run-greensnap-full.out 2>&1
CAND=$W/cand-red bash $IN/leaks-attrib.sh redrb     afldb_v2_rem4leaks_rb_tmpl_test   $IN/c2-order.txt > $W/evidence/run-redrb-full.out 2>&1
CAND=$W/cand     bash $IN/leaks-attrib.sh greenrb   afldb_v2_rem4leaks_rb_tmpl_test   $IN/c2-order.txt > $W/evidence/run-greenrb-full.out 2>&1
echo done > $W/evidence/full.done
