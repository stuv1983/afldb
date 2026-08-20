-- =====================================================================
-- AFLDB 063 - External current-season match source snapshots
-- =====================================================================
-- Squiggle and Kali are useful live/current-season cross-checks, but they
-- are not a new blind write path into AFLDB. Raw payloads land in staging
-- with source provenance first; normalised match rows are updated only
-- when a tool can resolve the local match unambiguously.
-- =====================================================================

INSERT INTO sources (key, name, url, kind, description) VALUES
  ('squiggle_api', 'Squiggle API', 'https://api.squiggle.com.au/', 'upstream_dataset',
   'Public fixture, score, ladder and prediction API used as a current-season cross-check.'),
  ('kali_afl_stats', 'Kali AFL Stats API', 'https://kaliaflstats.com/', 'upstream_dataset',
   'Key-authenticated AFL statistics API covering matches, scores, standings and player stats from 2000 onward.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  url = EXCLUDED.url,
  kind = EXCLUDED.kind,
  description = EXCLUDED.description;

CREATE TABLE staging.external_current_matches (
  source_id          smallint     NOT NULL REFERENCES sources(id),
  external_game_id   text         NOT NULL,
  season             smallint     NOT NULL REFERENCES seasons(year),
  round_label        text,
  round_number       smallint,
  complete_percent   smallint,
  match_date         date,
  venue_raw          text,
  home_team_raw      text,
  away_team_raw      text,
  home_club_id       integer      REFERENCES clubs(id),
  away_club_id       integer      REFERENCES clubs(id),
  local_match_id     integer      REFERENCES matches(id),
  home_goals         smallint,
  home_behinds       smallint,
  home_score         smallint,
  away_goals         smallint,
  away_behinds       smallint,
  away_score         smallint,
  raw_payload        jsonb        NOT NULL,
  fetched_at         timestamptz  NOT NULL DEFAULT now(),
  last_seen_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, external_game_id),
  CONSTRAINT external_current_matches_complete_ck CHECK (
    complete_percent IS NULL OR complete_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT external_current_matches_scores_ck CHECK (
    (home_score IS NULL OR home_score >= 0)
    AND (away_score IS NULL OR away_score >= 0)
    AND (home_goals IS NULL OR home_goals >= 0)
    AND (home_behinds IS NULL OR home_behinds >= 0)
    AND (away_goals IS NULL OR away_goals >= 0)
    AND (away_behinds IS NULL OR away_behinds >= 0)
  ),
  CONSTRAINT external_current_matches_components_ck CHECK (
    (home_goals IS NULL OR home_behinds IS NULL OR home_score IS NULL
     OR home_score = 6 * home_goals + home_behinds)
    AND
    (away_goals IS NULL OR away_behinds IS NULL OR away_score IS NULL
     OR away_score = 6 * away_goals + away_behinds)
  )
);

COMMENT ON TABLE staging.external_current_matches IS
  'Raw current-season match snapshots from external APIs. Used for reconciliation; never read by public pages.';
COMMENT ON COLUMN staging.external_current_matches.local_match_id IS
  'Set only when the local AFLDB match resolves unambiguously by season/date/round/clubs.';

CREATE INDEX ix_external_current_matches_season
  ON staging.external_current_matches (season, source_id);
CREATE INDEX ix_external_current_matches_local
  ON staging.external_current_matches (local_match_id)
  WHERE local_match_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON staging.external_current_matches TO afldb_import;
GRANT SELECT ON staging.external_current_matches TO afldb_app;
