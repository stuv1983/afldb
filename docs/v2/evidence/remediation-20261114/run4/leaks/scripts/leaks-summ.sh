#!/usr/bin/env bash
# summarise one attribution run: bash leaks-summ.sh <tag>
E=/mnt/ssd/afldb-rem4-leaks-20261115/evidence; T=$1
echo "== $T: files=$(grep -c . $E/attrib-$T.progress) rc-nonzero:"; grep -v "rc=0" $E/attrib-$T.progress | sed "s|tests/integration/||; s/ residue-tables=.*//" | tr '\n' ' '; echo
echo "== net row delta by file/table"; awk -F"\t" '$6!=0{sub(/tests\/integration\//,"",$1); print "  " $1, $3, $6}' $E/attrib-$T.tsv
echo "== total by table"; awk -F"\t" '{n[$3]+=$6} END{for(t in n) if(n[t]!=0) print "  " t, n[t]}' $E/attrib-$T.tsv | sort
echo "== id-less content fingerprint CHANGED"; grep CHANGED $E/fp-$T.tsv | sed "s|tests/integration/||" | awk -F"\t" '{print "  " $1, $2}'
