#!/usr/bin/env bash
# caddy357: are the 16 body differences direct-vs-Caddy real, or does the app itself render those pages differently on every request?
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
C=$EV/viacaddy-v2.11.4/compare.tsv
grep 'body:' "$C" | cut -f6 | while IFS= read -r u; do
  a=$(curl -s -H 'Host: beta.afldb.com' "http://127.0.0.1:55663$u" | sha256sum | cut -c1-12)
  b=$(curl -s -H 'Host: beta.afldb.com' "http://127.0.0.1:55663$u" | sha256sum | cut -c1-12)
  printf '%s direct-vs-direct %s\n' "$( [ "$a" = "$b" ] && echo SAME || echo VARIES-BY-ITSELF )" "$u"
done | sort | uniq -c | sort -rn | cut -c1-120
