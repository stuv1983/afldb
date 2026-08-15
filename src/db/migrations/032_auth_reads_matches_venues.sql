-- =====================================================================
-- AFLDB 032 — afldb_auth may read matches/venues for CSV validation
-- =====================================================================
-- Migration 023 granted afldb_auth SELECT on the statistical tables
-- validation resolves names against: players, player_clubs, clubs,
-- club_aliases, seasons, awards, award_nominations, award_winners,
-- import_batches. It missed matches/venues/venue_aliases because no
-- dataset needed them at the time.
--
-- The new match_results and player_match_stats datasets (src/lib/ingest/
-- datasets.ts) validate against matches (resolveMatch, to find the
-- match a player-stats row belongs to) and venues/venue_aliases
-- (resolveVenue) during the staged/validated steps, which run as
-- afldb_auth. Without this grant every row would fail to resolve with
-- a permission-denied error rather than a useful validation message.
-- =====================================================================

GRANT SELECT ON matches, venues, venue_aliases TO afldb_auth;
