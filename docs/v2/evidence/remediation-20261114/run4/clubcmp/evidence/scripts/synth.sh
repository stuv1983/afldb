#!/usr/bin/env bash
# synth.sh <rb|snap>: scratch copy + synthetic COMPLETED season 2067 (never committed) + derived rebuild of the two affected tables.
set -uo pipefail
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
b=$1
case "$b" in rb) T=$TMPL_RB;; snap) T=$TMPL_SN;; esac
DB=afldb_v2_rem4clubcmp_synth_${b}_base_test
IR drop-db "$DB" --acknowledge-destroy "$DB" >/dev/null 2>&1 || true
mkcopy "$DB" "$T"
cat > "$EV/cohorts.sql" <<'EOF'
SELECT 'pms_rows|' || count(*) FROM player_match_stats;
SELECT 'career_games_sum|' || sum(games) FROM player_career_stats;
SELECT 'c_200_249_f16|' || count(*) FROM player_career_stats WHERE games BETWEEN 200 AND 249 AND finals >= 16;
SELECT 'c_50_199_nobv|' || count(*) FROM player_career_stats WHERE goals BETWEEN 50 AND 199 AND brownlow_votes = 0;
SELECT 'c_200_100_f15|' || count(*) FROM player_career_stats WHERE games >= 200 AND goals >= 100 AND finals >= 15;
SELECT 'seasons_complete_max|' || max(year) FROM seasons WHERE status = 'complete';
EOF
say "synth $b: cohorts BEFORE"
Qf "$DB" "$EV/cohorts.sql" | grep '|' | tee "$EV/synth_${b}_cohorts_before.txt"
Wf "$DB" "$W/in/synth2067.sql" 2>&1 | tee "$EV/synth_${b}_insert.log"
(cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$DB" -- "$AFLDB_PYTHON" tools/migration/rebuild_derived.py --targets player_clubs player_career_stats) 2>&1 | strip | tail -12 | tee "$EV/synth_${b}_rebuild.log"
say "synth $b: cohorts AFTER"
Qf "$DB" "$EV/cohorts.sql" | grep '|' | tee "$EV/synth_${b}_cohorts_after.txt"
