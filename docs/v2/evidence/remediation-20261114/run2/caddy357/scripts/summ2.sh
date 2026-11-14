#!/usr/bin/env bash
cd /mnt/ssd/afldb-rem2-caddy357-20261114/evidence
for l in r2-prod-2.11.9 r2-prod-2.11.4 r2-dev-2.11.9 r2-dev-2.11.4; do
  f=matrix-$l.txt
  echo "=== $l"
  grep -E '^== (binary|file)' $f | cut -c1-190
  grep -E '^(adapt|validate)' $f | cut -c1-110
  echo "corpora: $(grep -c '^corpus=' $f); total:mismatches $(grep '^corpus=' $f | sed -E 's/.*total=([0-9]+).*mismatches=([0-9]+)/\1:\2/' | tr '\n' ' ')"
  echo "upstream EQUAL: $(grep -c 'EQUAL' $f)  DIFFERENT: $(grep -c 'DIFFERENT' $f)  curl-I rechecks: $(grep 're-checked' $f | tr -s ' ' | tr '\n' ';')"
  echo "sentinels non-zero: $(grep 'PROBE-' $f | awk '$3>0' | tr -s ' ' | tr '\n' ';')"
  echo "invite probes logged with the token: $(grep -c 'PROBE-INVITE' /mnt/ssd/afldb-rem2-caddy357-20261114/matrix/$l/logs/afldb-access.log)"
  tail -2 $f
done
