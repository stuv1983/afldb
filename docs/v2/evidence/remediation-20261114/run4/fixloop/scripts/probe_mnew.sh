#!/usr/bin/env bash
# fixloop: read-only probe on the two TEMPLATES (no mutation): what the `mnew` row's player (min(players.id)) looks like in 2026.
# Prints aggregates only (counts/clubCount), no names.
set -u -o pipefail
. "$(dirname "$0")/common.sh"
for p in "rb:$TRB" "snap:$TSNAP"; do
  t=${p%%:*}; db=${p#*:}
  echo "== $t ($db)"
  Q "$db" "SELECT 'min_player_id_is_set='||((SELECT min(id) FROM players) IS NOT NULL)||' ps_2026_rows='||(SELECT count(*) FROM player_season_stats ps WHERE ps.player_id=(SELECT min(id) FROM players) AND ps.season=2026)||' ps_2026_club_count='||coalesce((SELECT max(ps.club_count)::text FROM player_season_stats ps WHERE ps.player_id=(SELECT min(id) FROM players) AND ps.season=2026),'none')||' pms_2026_matches='||(SELECT count(*) FROM player_match_stats pms JOIN matches m ON m.id=pms.match_id WHERE pms.player_id=(SELECT min(id) FROM players) AND m.season=2026)"
  Q "$db" "SELECT 'club_id_null_vote_rows_all_seasons='||count(*)||' of_which_season_2026='||count(*) FILTER (WHERE season=2026) FROM brownlow_season_votes WHERE club_id IS NULL"
  Q "$db" "SELECT 'players_with_2026_club_count_gt1='||count(*) FROM player_season_stats WHERE season=2026 AND club_count>1"
done
