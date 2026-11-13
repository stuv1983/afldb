-- AFLDB-ISSUE-350 (review O-4): the public and admin effect of the 2027 `seasons` row, as the application reads it.
-- READ-ONLY. Run before and after the opening on the same database and diff the two outputs. One line per fact.
-- Each block names the application reader it reproduces.
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'

-- src/app/page.tsx:55-66 and src/db/queries/overview.ts:34-45 (home totals: lastSeason, seasons)
SELECT 'home_totals', (SELECT count(*) FROM seasons), (SELECT min(year) FROM seasons), (SELECT max(year) FROM seasons);
-- src/db/queries/seasons.ts:213 (getSeasonBounds: the season picker bounds)
SELECT 'season_bounds', COALESCE(min(year), 1897), COALESCE(max(year), 1897) FROM seasons;
-- src/db/queries/admin-fixtures.ts:218 and admin-season-lists.ts:212 (the administrable season ceiling)
SELECT 'admin_ceiling', max(year) FROM seasons;
-- src/db/queries/db-health.ts:46 (health card)
SELECT 'db_health', (SELECT min(year) FROM seasons), (SELECT max(year) FROM seasons), (SELECT count(*) FROM seasons);
-- src/db/queries/club-comparison.ts:1744 (SEASON_COLUMNS: what the comparison season selector and labels read)
SELECT 'season_row', s.year, s.competition, s.league, s.status::text, COALESCE(s.is_complete, false), (s.status <> 'complete'),
       s.data_through_date, s.completed_at, s.first_match_date, s.last_match_date, s.match_count, s.club_count
  FROM seasons s WHERE s.year >= 2025 ORDER BY s.year;
-- src/db/queries/player-derived.ts:737-758 (Brownlow coverage labels key off seasons.status = 'in_progress')
SELECT 'seasons_in_progress', count(*) FROM seasons WHERE status = 'in_progress';
-- migration 096 afldb_season_list_clubs: switches arm on max(seasons.year); the lists must not change
SELECT 'season_list_2026', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM afldb_season_list_clubs(2026::smallint);
SELECT 'season_list_2027', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM afldb_season_list_clubs(2027::smallint);
-- afldb_identity_for_season over EVERY organisation and every season up to 2026 (identical before and after) and for 2027 (non-NULL only for the open identities after)
SELECT 'identity_history_2026', md5(string_agg(o.id::text || ':' || s.year::text || ':' || COALESCE(afldb_identity_for_season(o.id, s.year)::text, '-'), ',' ORDER BY o.id, s.year))
  FROM club_organizations o CROSS JOIN seasons s WHERE s.year <= 2026;
SELECT 'identity_2027_resolved', count(*) FROM club_organizations o WHERE afldb_identity_for_season(o.id, 2027::smallint) IS NOT NULL;
-- the surfaces that carry the lifecycle
SELECT 'clubs_current', count(*) FILTER (WHERE is_current_afl_club), count(*) FILTER (WHERE last_season IS NULL OR last_season >= 2027), count(*) FILTER (WHERE last_season = 2026) FROM clubs;
SELECT 'orgs_active', count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE last_season = 2027), count(*) FILTER (WHERE last_season = 2026) FROM club_organizations;
-- what already references 2027 without a seasons row (fixtures carry no FK to seasons)
SELECT 'fixtures_2027', count(*) FROM fixtures WHERE season = 2027;
SELECT 'matches_2027', count(*) FROM matches WHERE season = 2027;
SELECT 'club_seasons_2027', count(*) FROM club_seasons WHERE season = 2027;
