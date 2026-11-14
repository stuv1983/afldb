#!/usr/bin/env bash
# club-comparison proofs + mutation (scratch copies only). Sequential; swaps ONE test file in and out of the checkout.
W=/mnt/ssd/afldb-rem4-fixup-20261115
LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
CC=tests/integration/club-comparison.test.ts
H="bash $W/in/h4.sh"
T='exposes selected-season Brownlow coverage'
LOADED="INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, (SELECT min(id) FROM players), NULL, 1; UPDATE stat_availability SET coverage = 'complete', is_recorded = true WHERE stat_key = 'brownlow_season_total' AND season = 2026"
VOTESONLY="INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, (SELECT min(id) FROM players), NULL, 1"
cd $W/cand || exit 1
FIX=$(git rev-parse HEAD)
echo "BATCH2 HEAD=$FIX porcelain=$(git status --porcelain | wc -l) $(date -u +%FT%TZ)"
# --- green: the targeted test, then the whole file, on both bases, both modes
flock $LOCK $H run c1rb   rb   shared $CC
flock $LOCK $H run c2rb   rb   all    $CC
flock $LOCK $H run c1snap snap shared $CC
flock $LOCK $H run c2snap snap all    $CC
# --- mutation on scratch copies: 2026 Brownlow results "loaded"
echo "=== OLD file (c9b2c3e7) on the loaded-2026 rb copy"
git checkout -q c9b2c3e7 -- $CC; echo "swapped in old: porcelain=$(git status --porcelain | wc -l)"
PRESEED="$LOADED" $H run mold rb shared $CC -t "$T"
PRESEED="$LOADED" $H run moldsnap snap shared $CC -t "$T"
git checkout -q HEAD -- $CC; echo "restored: HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
echo "=== NEW file on the loaded-2026 copies"
PRESEED="$LOADED" $H run mnew rb shared $CC -t "$T"
PRESEED="$LOADED" $H run mnewsnap snap shared $CC -t "$T"
echo "=== NEW file, votes loaded but stat_availability NOT recomputed (inconsistent)"
PRESEED="$VOTESONLY" $H run mvotes rb shared $CC -t "$T"
echo "=== NEW file, targeted test on the unmutated bases (control)"
$H run mctlrb rb shared $CC -t "$T"
$H run mctlsnap snap shared $CC -t "$T"
echo "BATCH2 DONE HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l) $(date -u +%FT%TZ)"
