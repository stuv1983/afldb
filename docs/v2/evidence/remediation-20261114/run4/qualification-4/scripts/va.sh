#!/usr/bin/env bash
set -u
. /mnt/ssd/afldb-rem4-qual-20261115/in/common.sh
for p in "q:$RBDB" "r3:afldb_v2_rem4qual_rb3ref_test"; do
  t=${p%%:*}; db=${p#*:}
  Q "$db" "SELECT to_jsonb(r)::text FROM venue_aliases r ORDER BY to_jsonb(r)::text" > $E/venue_aliases.$t.txt
  Q "$db" "SELECT column_name||':'||data_type FROM information_schema.columns WHERE table_name='venue_aliases' ORDER BY ordinal_position" | tr '\n' ' ' > $E/venue_aliases.$t.cols.txt
done
cat $E/venue_aliases.q.cols.txt; echo
diff $E/venue_aliases.r3.txt $E/venue_aliases.q.txt | head -30
echo "rows: $(wc -l < $E/venue_aliases.q.txt) $(wc -l < $E/venue_aliases.r3.txt)"
