#!/usr/bin/env bash
cd /mnt/ssd/afldb-rem2-caddy357-20261114/evidence
for l in prod-2.11.9 prod-2.11.4 dev-2.11.9 dev-2.11.4; do
  f=matrix-$l.txt
  echo "=== $l"
  grep -E '^== (binary|file)' $f | cut -c1-190
  grep -E '^(adapt|validate)' $f | cut -c1-150
  echo "corpora: $(grep -c '^corpus=' $f); mismatches: $(grep '^corpus=' $f | sed -E 's/.*total=([0-9]+).*mismatches=([0-9]+)/\1:\2/' | tr '\n' ' ')"
  echo "upstream EQUAL: $(grep -c 'EQUAL' $f)  DIFFERENT: $(grep -c 'DIFFERENT' $f)  curl-I rechecks: $(grep 're-checked' $f | tr -s ' ' | tr '\n' ';')"
  echo "sentinels non-zero: $(grep 'PROBE-' $f | awk '$3>0' | tr -s ' ' | tr '\n' ';')"
  tail -3 $f
done
