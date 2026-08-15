-- =====================================================================
-- AFLDB 026 — AFLW read model: the competition as the website reads it
-- =====================================================================
-- Migration 025 staged the aflwstats.com scrape exactly as published.
-- This migration turns that staging schema into something the site can
-- query: seasons with premiers, matches with margins and results, clubs,
-- venues, players and career totals.
--
-- WHY VIEWS AND NOT TABLES
--
-- The AFL side keys a season by `seasons.year`, and AFLW has two seasons
-- inside calendar 2022 (Season Six and Season Seven). Adding AFLW to the
-- normalised model therefore means replacing that key with a surrogate
-- across 22 foreign keys, plus a `competitions` table — a change to the
-- AFL model that has not been designed yet, let alone tested against
-- 694,210 player-match rows.
--
-- Views cost that refactor nothing. `aflw` is a read layer over
-- `staging_aflw`: no second copy of the data to keep in step, no import
-- job, and a staging reload is visible immediately with no refresh step
-- and no deploy. When the competition-scoping work does happen, these
-- view definitions are the specification of what the pages need.
--
-- None of them are MATERIALIZED. The whole competition is 51,018 rows,
-- so the largest aggregate here — career totals over 29,878 player-match
-- rows — is a sub-50ms sequential scan. A materialized view would buy
-- nothing and would need a REFRESH the import role does not own.
--
-- IDENTITY
--
-- Keys are the source's own: `team_code` for a club, `player_slug` for a
-- person, `match_key` for a game, `season_key` for a season. They are
-- stable across re-scrapes, which display names are not — the source
-- applies current club names retroactively, so 2017 pages already read
-- Kuwarna rather than Adelaide. A URL built on a name would break the
-- next time a club is renamed; one built on `ade` does not.
--
-- The resolution columns in staging (club_id, player_id, venue_id) stay
-- unused here. They are NULL until a reconciliation pass fills them, and
-- nothing in this schema needs an AFL-side identity to work.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS aflw;

GRANT USAGE ON SCHEMA aflw TO afldb_app, afldb_import;

-- Seasons -------------------------------------------------------------
-- `ordinal` is the only safe sort key: calendar_year repeats in 2022.
-- A season is complete when nothing is still scheduled — Season Six is
-- complete despite two of its 77 fixtures never being played, and 2026
-- is not, with 106 still to come.
CREATE VIEW aflw.seasons AS
SELECT s.season_key,
       s.ordinal,
       s.calendar_year,
       s.display_label,
       s.first_fixture_date,
       s.last_fixture_date,
       s.fixture_count,
       s.played_count,
       s.ladder_group_count,
       s.has_grand_final,
       NOT EXISTS (
         SELECT 1 FROM staging_aflw.fixtures f
          WHERE f.season_key = s.season_key AND f.fixture_status = 'scheduled'
       ) AS is_complete,
       CASE WHEN EXISTS (
         SELECT 1 FROM staging_aflw.fixtures f
          WHERE f.season_key = s.season_key AND f.fixture_status = 'scheduled'
       ) THEN 'in_progress' ELSE 'complete' END AS status,
       -- 2020 was abandoned at the semi-finals and 2026 is still being
       -- played: both have a complete-looking home-and-away season and no
       -- premier. has_grand_final carries that, so the premier is read
       -- only through it and never inferred from a ladder leader.
       gf.winner_team_code AS premier_team_code,
       (SELECT count(*) FROM staging_aflw.player_seasons ps
         WHERE ps.season_key = s.season_key)::int AS player_count,
       (SELECT count(DISTINCT l.team_code) FROM staging_aflw.ladders l
         WHERE l.season_key = s.season_key)::int AS club_count
  FROM staging_aflw.seasons s
  LEFT JOIN LATERAL (
    SELECT CASE WHEN m.home_score > m.away_score THEN m.home_team_code
                WHEN m.away_score > m.home_score THEN m.away_team_code END
             AS winner_team_code
      FROM staging_aflw.matches m
     WHERE m.season_key = s.season_key
       AND m.round_type = 'grand_final'
       AND m.home_score <> m.away_score
     ORDER BY m.match_date DESC
     LIMIT 1
  ) gf ON s.has_grand_final;

COMMENT ON VIEW aflw.seasons IS
  '11 AFLW seasons, 2017-2026. Sort by ordinal: calendar_year is not unique.';

-- Clubs ---------------------------------------------------------------
-- The source publishes no AFLW rename history, so a club has exactly one
-- name: its current one, which is what every page of the scrape shows.
-- The name is taken from the club's most recent season rather than
-- pinned here, so a future re-scrape carries a rename through on its own.
CREATE VIEW aflw.clubs AS
WITH appearances AS (
  SELECT l.team_code, s.ordinal, l.team_name_raw
    FROM staging_aflw.ladders l
    JOIN staging_aflw.seasons s ON s.season_key = l.season_key
),
named AS (
  SELECT DISTINCT ON (team_code) team_code, team_name_raw
    FROM appearances
   ORDER BY team_code, ordinal DESC
)
SELECT n.team_code AS code,
       n.team_name_raw AS name,
       min(a.ordinal)::smallint AS first_season_ordinal,
       max(a.ordinal)::smallint AS last_season_ordinal,
       count(DISTINCT a.ordinal)::int AS seasons_contested
  FROM named n
  JOIN appearances a ON a.team_code = n.team_code
 GROUP BY n.team_code, n.team_name_raw;

COMMENT ON VIEW aflw.clubs IS
  'The 18 AFLW clubs. Keyed by the source team code, which is stable; the name is a current label the source applies retroactively.';

-- Venues --------------------------------------------------------------
-- Venue names are free text in the source and were never resolved to the
-- AFL venue table, so the name is canonicalised only far enough to make
-- a URL. Nothing here claims these are the same entities as venues.id.
CREATE VIEW aflw.venues AS
SELECT lower(regexp_replace(btrim(m.venue_raw), '[^A-Za-z0-9]+', '-', 'g')) AS slug,
       m.venue_raw AS name,
       count(*)::int AS matches,
       min(s.ordinal)::smallint AS first_season_ordinal,
       max(s.ordinal)::smallint AS last_season_ordinal
  FROM staging_aflw.matches m
  JOIN staging_aflw.seasons s ON s.season_key = m.season_key
 GROUP BY m.venue_raw;

-- Matches -------------------------------------------------------------
-- One row per played match, with the derived facts every match list on
-- the site needs: margin, result, winner, and the combined and extreme
-- scores that Match Search filters on.
CREATE VIEW aflw.matches AS
SELECT m.match_key,
       m.season_key,
       s.ordinal        AS season_ordinal,
       s.display_label  AS season_label,
       s.calendar_year,
       m.round_code,
       m.round_number,
       m.round_type,
       m.is_final,
       m.match_date,
       m.match_time,
       m.venue_raw      AS venue_name,
       lower(regexp_replace(btrim(m.venue_raw), '[^A-Za-z0-9]+', '-', 'g')) AS venue_slug,
       m.weather_raw,
       m.home_team_code,
       hc.name          AS home_club_name,
       m.away_team_code,
       ac.name          AS away_club_name,
       m.home_goals, m.home_behinds, m.home_score,
       m.away_goals, m.away_behinds, m.away_score,
       abs(m.home_score - m.away_score)::smallint AS margin,
       (m.home_score + m.away_score)::smallint    AS total_score,
       greatest(m.home_score, m.away_score)::smallint AS high_score,
       least(m.home_score, m.away_score)::smallint    AS low_score,
       CASE WHEN m.home_score > m.away_score THEN 'home_win'
            WHEN m.away_score > m.home_score THEN 'away_win'
            ELSE 'draw' END AS result,
       CASE WHEN m.home_score > m.away_score THEN m.home_team_code
            WHEN m.away_score > m.home_score THEN m.away_team_code END
         AS winner_team_code
  FROM staging_aflw.matches m
  JOIN staging_aflw.seasons s ON s.season_key = m.season_key
  LEFT JOIN aflw.clubs hc ON hc.code = m.home_team_code
  LEFT JOIN aflw.clubs ac ON ac.code = m.away_team_code;

COMMENT ON VIEW aflw.matches IS
  'Played matches only. Attendance and umpires are not published by this source and are absent, not zero.';

-- Fixtures ------------------------------------------------------------
-- The full published list including matches never played. Kept separate
-- from aflw.matches so a scheduled fixture can never be counted as a
-- result: the source renders one as a 0-0 draw, and staging deliberately
-- stores its score as NULL.
CREATE VIEW aflw.fixtures AS
SELECT f.match_key,
       f.season_key,
       s.ordinal       AS season_ordinal,
       s.display_label AS season_label,
       f.round_code, f.round_number, f.round_type, f.is_final,
       f.match_date, f.match_time,
       f.venue_raw AS venue_name,
       f.home_team_code, hc.name AS home_club_name,
       f.away_team_code, ac.name AS away_club_name,
       f.home_score, f.away_score,
       f.is_played, f.fixture_status
  FROM staging_aflw.fixtures f
  JOIN staging_aflw.seasons s ON s.season_key = f.season_key
  LEFT JOIN aflw.clubs hc ON hc.code = f.home_team_code
  LEFT JOIN aflw.clubs ac ON ac.code = f.away_team_code;

-- Ladders -------------------------------------------------------------
-- conference is part of the key, not an attribute: 2020 was played as two
-- conferences and has two ladders.
CREATE VIEW aflw.ladders AS
SELECT l.season_key,
       s.ordinal AS season_ordinal,
       l.conference,
       l.team_code,
       c.name AS club_name,
       l.ladder_rank,
       l.played, l.premiership_points, l.percentage,
       l.wins, l.draws, l.losses,
       l.points_for, l.points_against
  FROM staging_aflw.ladders l
  JOIN staging_aflw.seasons s ON s.season_key = l.season_key
  LEFT JOIN aflw.clubs c ON c.code = l.team_code;

-- Player-match statistics ---------------------------------------------
-- The match context is carried alongside so a player's match log, a
-- match's team sheet and the single-game record boards are all one join
-- away from the same view.
CREATE VIEW aflw.player_match_stats AS
SELECT pms.match_key,
       pms.season_key,
       s.ordinal       AS season_ordinal,
       s.display_label AS season_label,
       pms.player_slug,
       pms.player_name_raw,
       pms.team_code,
       c.name          AS club_name,
       pms.jumper_number,
       pms.position,
       m.match_date,
       m.round_code, m.round_number, m.round_type, m.is_final,
       m.venue_raw AS venue_name,
       CASE WHEN m.home_team_code = pms.team_code
            THEN m.away_team_code ELSE m.home_team_code END AS opponent_code,
       CASE WHEN m.home_team_code = pms.team_code
            THEN m.home_score ELSE m.away_score END AS points_for,
       CASE WHEN m.home_team_code = pms.team_code
            THEN m.away_score ELSE m.home_score END AS points_against,
       CASE WHEN m.home_score = m.away_score THEN 'D'
            WHEN (m.home_score > m.away_score) = (m.home_team_code = pms.team_code)
            THEN 'W' ELSE 'L' END AS outcome,
       pms.kicks, pms.handballs, pms.disposals, pms.contested,
       pms.metres_gained, pms.marks, pms.hitouts, pms.tackles,
       pms.fantasy_points,
       -- The source prints an empty cell rather than 0.0 for a player who
       -- did not score, and the scoring worm confirms the absence
       -- independently. It is a real zero that was simply not written
       -- down, so it reads as 0 here rather than as "not recorded".
       COALESCE(pms.goals, 0)::smallint        AS goals,
       COALESCE(pms.behinds, 0)::smallint      AS behinds,
       COALESCE(pms.score_points, 0)::smallint AS score_points
  FROM staging_aflw.player_match_stats pms
  JOIN staging_aflw.matches m ON m.match_key = pms.match_key
  JOIN staging_aflw.seasons s ON s.season_key = pms.season_key
  LEFT JOIN aflw.clubs c ON c.code = pms.team_code;

-- Players -------------------------------------------------------------
-- player_slug is the source's only handle on a person and is
-- name-derived, which is why staging leaves player_id NULL. The same
-- caveat applies here: two players who share a name and were never
-- disambiguated by the source would share a slug, and a surname change
-- would split one career in two. 960 slugs is small enough to audit, and
-- tools/aflw/profile_aflw.py prints the candidates.
CREATE VIEW aflw.players AS
WITH latest AS (
  SELECT DISTINCT ON (pms.player_slug)
         pms.player_slug, pms.player_name_raw, pms.team_code
    FROM staging_aflw.player_match_stats pms
    JOIN staging_aflw.seasons s ON s.season_key = pms.season_key
    JOIN staging_aflw.matches m ON m.match_key = pms.match_key
   ORDER BY pms.player_slug, s.ordinal DESC, m.match_date DESC
)
SELECT l.player_slug AS slug,
       l.player_name_raw AS display_name,
       -- "Surname, First" for alphabetical ordering by surname, matching
       -- how the AFL side sorts. A single-word name sorts as itself.
       CASE WHEN l.player_name_raw ~ '\s'
            THEN regexp_replace(l.player_name_raw, '^(.*)\s+(\S+)$', '\2, \1')
            ELSE l.player_name_raw END AS sort_name,
       l.team_code AS current_team_code,
       c.name AS current_club_name
  FROM latest l
  LEFT JOIN aflw.clubs c ON c.code = l.team_code;

-- Player season totals -------------------------------------------------
-- Derived from the match rows rather than read from the source's own
-- season page, so wins, finals and the club a player represented come
-- from the same grain as everything else. The source's aggregates
-- reconcile exactly against these across all 3,972 player-seasons and are
-- kept in staging as the check.
CREATE VIEW aflw.player_seasons AS
SELECT pms.player_slug,
       pms.season_key,
       pms.season_ordinal,
       pms.season_label,
       -- A mid-season club change is not something this source has ever
       -- shown, but the club of most games is still the honest label
       -- rather than an arbitrary one.
       (array_agg(pms.team_code ORDER BY pms.match_date DESC))[1] AS team_code,
       count(*)::int                                   AS games,
       count(*) FILTER (WHERE pms.is_final)::int       AS finals,
       count(*) FILTER (WHERE pms.outcome = 'W')::int  AS wins,
       count(*) FILTER (WHERE pms.outcome = 'D')::int  AS draws,
       count(*) FILTER (WHERE pms.outcome = 'L')::int  AS losses,
       sum(pms.goals)::int          AS goals,
       sum(pms.behinds)::int        AS behinds,
       sum(pms.score_points)::int   AS score_points,
       sum(pms.kicks)::int          AS kicks,
       sum(pms.handballs)::int      AS handballs,
       sum(pms.disposals)::int      AS disposals,
       sum(pms.contested)::int      AS contested,
       sum(pms.metres_gained)::int  AS metres_gained,
       sum(pms.marks)::int          AS marks,
       sum(pms.tackles)::int        AS tackles,
       sum(pms.hitouts)::int        AS hitouts,
       sum(pms.fantasy_points)::int AS fantasy_points
  FROM aflw.player_match_stats pms
 GROUP BY pms.player_slug, pms.season_key, pms.season_ordinal, pms.season_label;

-- Player career totals -------------------------------------------------
-- The table Advanced Search filters and sorts on. Premierships are
-- counted from Grand Finals actually won while on the winning team sheet,
-- so 2020 — abandoned with no premier — contributes none.
CREATE VIEW aflw.player_careers AS
SELECT pms.player_slug,
       count(*)::int                                  AS games,
       count(*) FILTER (WHERE pms.is_final)::int      AS finals,
       count(*) FILTER (WHERE pms.outcome = 'W')::int AS wins,
       count(*) FILTER (WHERE pms.outcome = 'D')::int AS draws,
       count(*) FILTER (WHERE pms.outcome = 'L')::int AS losses,
       count(*) FILTER (
         WHERE pms.round_type = 'grand_final' AND pms.outcome = 'W'
       )::int AS premierships,
       count(DISTINCT pms.season_key)::int AS seasons_played,
       count(DISTINCT pms.team_code)::int  AS clubs_played,
       min(pms.season_ordinal)::smallint   AS debut_season_ordinal,
       max(pms.season_ordinal)::smallint   AS final_season_ordinal,
       min(pms.match_date)                 AS debut_date,
       max(pms.match_date)                 AS last_match_date,
       sum(pms.goals)::int          AS goals,
       sum(pms.behinds)::int        AS behinds,
       sum(pms.score_points)::int   AS score_points,
       sum(pms.kicks)::int          AS kicks,
       sum(pms.handballs)::int      AS handballs,
       sum(pms.disposals)::int      AS disposals,
       sum(pms.contested)::int      AS contested,
       sum(pms.metres_gained)::int  AS metres_gained,
       sum(pms.marks)::int          AS marks,
       sum(pms.tackles)::int        AS tackles,
       sum(pms.hitouts)::int        AS hitouts,
       sum(pms.fantasy_points)::int AS fantasy_points,
       max(pms.goals)::smallint     AS best_goals_game,
       max(pms.disposals)::smallint AS best_disposals_game,
       string_agg(DISTINCT pms.club_name, ', ' ORDER BY pms.club_name) AS club_names
  FROM aflw.player_match_stats pms
 GROUP BY pms.player_slug;

-- Club totals ----------------------------------------------------------
CREATE VIEW aflw.club_totals AS
WITH played AS (
  SELECT m.home_team_code AS team_code, m.season_key, m.round_type,
         m.home_score AS points_for, m.away_score AS points_against,
         m.result = 'home_win' AS won, m.result = 'draw' AS drew
    FROM aflw.matches m
  UNION ALL
  SELECT m.away_team_code, m.season_key, m.round_type,
         m.away_score, m.home_score,
         m.result = 'away_win', m.result = 'draw'
    FROM aflw.matches m
)
SELECT c.code,
       c.name,
       c.first_season_ordinal,
       c.last_season_ordinal,
       c.seasons_contested,
       count(p.*)::int                          AS matches,
       count(*) FILTER (WHERE p.won)::int       AS wins,
       count(*) FILTER (WHERE p.drew)::int      AS draws,
       count(*) FILTER (WHERE NOT p.won AND NOT p.drew)::int AS losses,
       count(*) FILTER (WHERE p.round_type <> 'home_and_away')::int AS finals,
       count(*) FILTER (
         WHERE p.round_type = 'grand_final' AND p.won
       )::int AS premierships,
       COALESCE(sum(p.points_for), 0)::int     AS points_for,
       COALESCE(sum(p.points_against), 0)::int AS points_against
  FROM aflw.clubs c
  LEFT JOIN played p ON p.team_code = c.code
 GROUP BY c.code, c.name, c.first_season_ordinal, c.last_season_ordinal,
          c.seasons_contested;

-- Scoring events -------------------------------------------------------
-- Score-by-score progression, which the AFL side of the database has no
-- equivalent for. The scorer is named only for 2017-2021; from Season Six
-- the source names the club alone, so player_name_raw is empty for most
-- rows and that absence is the source's, not a gap in loading.
CREATE VIEW aflw.scoring_events AS
SELECT e.match_key,
       e.season_key,
       e.event_seq,
       e.period,
       e.clock,
       e.team_code,
       c.name AS club_name,
       e.event_type,
       e.player_name_raw,
       e.points,
       e.home_goals, e.home_behinds, e.away_goals, e.away_behinds
  FROM staging_aflw.scoring_events e
  LEFT JOIN aflw.clubs c ON c.code = e.team_code;

GRANT SELECT ON ALL TABLES IN SCHEMA aflw TO afldb_app, afldb_import;

ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA aflw
  GRANT SELECT ON TABLES TO afldb_app, afldb_import;
