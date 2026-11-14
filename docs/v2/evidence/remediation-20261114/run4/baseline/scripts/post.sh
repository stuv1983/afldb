#!/usr/bin/env bash
# remediation run 4, scope baseline: post-processing of the three cells' raw output (no database access, no test is run).
#   bash $W/in/post.sh
# 1. <cell>-order.txt: the integration files in the order vitest executed them, from the default reporter's per-file result lines
#    (one line per file: "<status marker> tests/integration/<file> (<n> tests ...) <ms>"). It supersedes baseline.sh's
#    <cell>-order-log.txt, whose pattern was too loose (it also matched failure re-listings: 172 names for 99 files).
# 2. <cell>-classified.tsv: failing ids with section 4 classes where run-3 records give the cause (classify.js), else unclassified-baseline.
# 3. cross-cell comparison tables (keys: file TAB full test name).
set -u -o pipefail
export W=/mnt/ssd/afldb-rem4-baseline-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
E=$W/evidence; IN=$W/in
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
for t in c1 c2 c3; do
  [ -f "$E/$t.log" ] || continue
  strip < "$E/$t.log" | grep -a -E '^ (✓|×|↓|❯) tests/integration/[^ ]+\.test\.ts \(' | awk '{print NR "\t" $2 "\t" $1}' > "$E/$t-order.txt"
  echo "$t order: $(wc -l < "$E/$t-order.txt") files"
  base=rebuild; [ "$t" = c3 ] && base=snapshot
  [ -f "$E/$t-failures.tsv" ] && node "$IN/classify.js" "$E/$t-failures.tsv" "$base" > "$E/$t-classified.tsv"
  [ -f "$E/$t-classified.tsv" ] && { echo "$t classified: $(cut -f3 "$E/$t-classified.tsv" | sort | uniq -c | tr '\n' ';')"; }
done
# set comparison on <file>\t<id>
for pair in "c1 c2" "c1 c3" "c2 c3"; do
  set -- $pair
  [ -f "$E/$1-failures.tsv" ] && [ -f "$E/$2-failures.tsv" ] || continue
  cut -f1,2 "$E/$1-failures.tsv" | sort > "$E/.a"; cut -f1,2 "$E/$2-failures.tsv" | sort > "$E/.b"
  comm -23 "$E/.a" "$E/.b" > "$E/cmp-$1-only-vs-$2.tsv"
  comm -13 "$E/.a" "$E/.b" > "$E/cmp-$2-only-vs-$1.tsv"
  comm -12 "$E/.a" "$E/.b" > "$E/cmp-$1-and-$2.tsv"
  echo "$1 vs $2: only-$1=$(wc -l < "$E/cmp-$1-only-vs-$2.tsv") only-$2=$(wc -l < "$E/cmp-$2-only-vs-$1.tsv") both=$(wc -l < "$E/cmp-$1-and-$2.tsv")"
done
rm -f "$E/.a" "$E/.b"
# run 3's snapshot x per-file cell (committed) against C3 and C1
R3=$W/cand/docs/v2/evidence/remediation-20261114/run3/qualification-3/integ-failures.tsv
if [ -f "$R3" ]; then
  cut -f1,2 "$R3" | sort > "$E/.r3"
  for t in c1 c2 c3; do
    [ -f "$E/$t-failures.tsv" ] || continue
    cut -f1,2 "$E/$t-failures.tsv" | sort > "$E/.t"
    echo "$t vs run3 snapshot x per-file (46 ids): only-run3=$(comm -23 "$E/.r3" "$E/.t" | wc -l) only-$t=$(comm -13 "$E/.r3" "$E/.t" | wc -l) both=$(comm -12 "$E/.r3" "$E/.t" | wc -l)"
    comm -23 "$E/.r3" "$E/.t" > "$E/cmp-run3snapshotperfile-only-vs-$t.tsv"
  done
  rm -f "$E/.r3" "$E/.t"
fi
