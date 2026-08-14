-- =====================================================================
-- AFLDB 014 — Staging schema and its privileges
-- =====================================================================
-- Implements the raw -> staging -> normalised -> derived pipeline.
-- Staging holds source rows close to their original shape, with the raw
-- source string preserved next to the resolved AFLDB key. When club or
-- name resolution improves, staging can be re-resolved without going
-- back to the legacy database.
--
-- Staging is never read by the website. afldb_app is granted SELECT for
-- the internal data-quality report only.
-- =====================================================================

GRANT USAGE ON SCHEMA staging TO afldb_import, afldb_app;

ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging
  GRANT SELECT ON TABLES TO afldb_app;

-- Season ladders as published, with club resolution recorded alongside.
CREATE TABLE staging.team_seasons (
  season             smallint NOT NULL REFERENCES seasons(year),
  club_raw           text     NOT NULL,
  club_id            integer  REFERENCES clubs(id),
  played             smallint NOT NULL,
  wins               smallint NOT NULL,
  draws              smallint NOT NULL,
  losses             smallint NOT NULL,
  points_for         integer  NOT NULL,
  points_against     integer  NOT NULL,
  premiership_points integer,
  percentage         numeric(9,4),
  ladder_rank        smallint,
  wooden_spoon       boolean  NOT NULL DEFAULT false,
  PRIMARY KEY (season, club_raw)
);
COMMENT ON TABLE staging.team_seasons IS
  'Raw season ladders. club_raw is the source string; club_id is the resolution, NULL when unresolved.';
COMMENT ON COLUMN staging.team_seasons.club_id IS
  'NULL means the club string could not be resolved. Such rows are reported, never dropped.';

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON staging.team_seasons TO afldb_import;
GRANT SELECT ON staging.team_seasons TO afldb_app;
