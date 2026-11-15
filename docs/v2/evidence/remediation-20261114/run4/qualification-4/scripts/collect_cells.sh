#!/usr/bin/env bash
# remediation run 4, scope `qual`: stage the evidence of finished cells/phases for transfer. Read-only on $E; writes $W/stage/<name>.
#   bash collect_cells.sh <name> <prefix...>     copies every $E/<prefix>* file (json/log gzipped when > 200 KB)
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-qual-20261115; E=$W/evidence
name=$1; shift
S=$W/stage/$name; mkdir -p "$S"
for p in "$@"; do
  for f in "$E"/$p*; do
    [ -f "$f" ] || continue
    b=$(basename "$f")
    sz=$(stat -c %s "$f")
    case "$b" in *.gz) cp -p "$f" "$S/$b" ;; *) if [ "$sz" -gt 200000 ]; then gzip -9 -n -c "$f" > "$S/$b.gz"; else cp -p "$f" "$S/$b"; fi ;; esac
  done
done
du -sh "$S"; ls "$S" | wc -l
