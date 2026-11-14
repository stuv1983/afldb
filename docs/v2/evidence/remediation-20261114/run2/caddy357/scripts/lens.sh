#!/usr/bin/env bash
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
cd "$W/corpus"
awk -F'\t' '{p=$2; sub(/\?.*/,"",p); if(length(p)>m){m=length(p); u=p}} END{print "longest legit path in the corpus (query excluded):", m, u}' legit.tsv | cut -c1-200
find "$CAND/.next/static" -type f | sed "s#$CAND/.next#/_next#" | awk '{if(length($0)>m){m=length($0);u=$0}} END{print "longest /_next/static path of this build:", m, u}'
awk -F'\t' '$2 ~ /^\/aflw\/players\//{p=$2; if(length(p)>m){m=length(p); u=p}} END{print "longest AFLW player path:", m, u}' legit.tsv
awk -F'\t' '$2 ~ /^\/players\/[a-z0-9-]+-[0-9]+$/{ if(length($2)>m){m=length($2); u=$2}} END{print "longest player path:", m, u}' legit.tsv
