-- =====================================================================
-- AFLDB 027 — AFLW read model corrections
-- =====================================================================
-- Three fixes to the views migration 026 created. They are replacements
-- rather than edits to 026 because that migration has already run:
-- the runner records a checksum and refuses a file that changed after it
-- was applied.
--
-- Every view here keeps its column names, types and order, so
-- CREATE OR REPLACE is enough and the views that read them are
-- undisturbed.
-- =====================================================================

-- 1. The venue slug is defined once ------------------------------------
-- The rule was written out in full in both aflw.venues, which produces a
-- venue's slug, and aflw.matches, which links to it. That slug is the
-- identity of a venue URL: if the two copies were ever changed apart —
-- for a name with an apostrophe, say, or a non-ASCII character — every
-- match page would link to a venue page that no longer answers to that
-- slug, while both views still looked correct read on their own.
CREATE OR REPLACE FUNCTION aflw.venue_slug(venue_raw text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
$$ SELECT lower(regexp_replace(btrim(venue_raw), '[^A-Za-z0-9]+', '-', 'g')) $$;

CREATE OR REPLACE VIEW aflw.venues AS
SELECT aflw.venue_slug(m.venue_raw) AS slug,
       m.venue_raw AS name,
       count(*)::int AS matches,
       min(s.ordinal)::smallint AS first_season_ordinal,
       max(s.ordinal)::smallint AS last_season_ordinal
  FROM staging_aflw.matches m
  JOIN staging_aflw.seasons s ON s.season_key = m.season_key
 GROUP BY m.venue_raw;

CREATE OR REPLACE VIEW aflw.matches AS
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
       aflw.venue_slug(m.venue_raw) AS venue_slug,
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

-- 2. One test behind is_complete and status ----------------------------
-- Both columns answer the same question — is anything still scheduled —
-- and each carried its own copy of the EXISTS. A change to one would
-- have left a season reading complete and in progress at once.
CREATE OR REPLACE VIEW aflw.seasons AS
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
       (st.status = 'complete') AS is_complete,
       st.status,
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
  CROSS JOIN LATERAL (
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM staging_aflw.fixtures f
              WHERE f.season_key = s.season_key AND f.fixture_status = 'scheduled'
           ) THEN 'in_progress' ELSE 'complete' END AS status
  ) st
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

-- 3. A player-season names the club of most games ----------------------
-- The comment already said the club of most games was the honest label
-- and the arbitrary one was not good enough; the expression underneath
-- took the club of the season's most recent match. The two agree for
-- every row the source has published so far, because it has never shown
-- a mid-season change — but the first one it does show would attribute a
-- whole season to a club the player played once for.
CREATE OR REPLACE VIEW aflw.player_seasons AS
SELECT pms.player_slug,
       pms.season_key,
       pms.season_ordinal,
       pms.season_label,
       -- Ties break on the later match, so an even split names the club
       -- the player finished the season at.
       (SELECT x.team_code
          FROM aflw.player_match_stats x
         WHERE x.player_slug = pms.player_slug
           AND x.season_key  = pms.season_key
         GROUP BY x.team_code
         ORDER BY count(*) DESC, max(x.match_date) DESC
         LIMIT 1) AS team_code,
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

GRANT SELECT ON ALL TABLES IN SCHEMA aflw TO afldb_app, afldb_import;
