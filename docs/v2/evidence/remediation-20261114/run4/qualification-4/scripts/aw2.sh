#!/usr/bin/env bash
set -u
. /mnt/ssd/afldb-rem4-qual-20261115/in/common.sh
Q "$TSNAP" "SELECT 'award 47 = '||code||' / '||name FROM award_definitions WHERE id=47" 2>&1 | head -2
Q "$TSNAP" "SELECT column_name FROM information_schema.columns WHERE table_name='award_definitions' AND table_schema='public' ORDER BY ordinal_position" | tr '\n' ' '; echo
Q afldb_v2_rem4qual_s_sh_test "SELECT 'after: 2026 award 47 rows='||count(*)||' sources='||string_agg(DISTINCT coalesce(source_id::text,'null'),',')||' status='||string_agg(DISTINCT status::text,',') FROM award_winners WHERE season=2026 AND award_id=47"
Q "$TRB" "SELECT 'rebuild: 2026 award 47 rows='||count(*) FROM award_winners WHERE season=2026 AND award_id=47"
Q "$TSNAP" "SELECT 'snapshot template: 2026 award 47 rows='||count(*) FROM award_winners WHERE season=2026 AND award_id=47"
