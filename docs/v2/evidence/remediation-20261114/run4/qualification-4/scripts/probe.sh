#!/usr/bin/env bash
set -u
. /mnt/ssd/afldb-rem4-qual-20261115/in/common.sh
Q "$TRB" "SELECT table_name||'.'||column_name||':'||data_type FROM information_schema.columns WHERE table_name IN ('brownlow_season_votes','player_match_stats') AND table_schema='public' ORDER BY table_name, ordinal_position" | tr '\n' ' '; echo
Q "$TRB" "SELECT count(*) FROM matches WHERE season=2026"
