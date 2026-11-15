#!/usr/bin/env bash
set -u
. /mnt/ssd/afldb-rem4-qual-20261115/in/common.sh
Q "$TSNAP" "SELECT column_name FROM information_schema.columns WHERE table_name='award_winners' AND table_schema='public' ORDER BY ordinal_position" | tr '\n' ' '; echo
G="SELECT season, award_id, count(*) AS n FROM award_winners GROUP BY season, award_id ORDER BY 1,2"
Q afldb_v2_rem4qual_s_sh_test "$G" > $E/aw.after.txt; Q "$TSNAP" "$G" > $E/aw.before.txt
diff $E/aw.before.txt $E/aw.after.txt | tee $E/aw.diff.txt
Q afldb_v2_rem4qual_r_sh_test "$G" > $E/aw.r_after.txt; Q "$TRBB" "$G" > $E/aw.r_before.txt; diff $E/aw.r_before.txt $E/aw.r_after.txt | tee $E/aw.r_diff.txt; echo "r_sh award groups identical: rc=$?"
