-- =====================================================================
-- 067  Player-link match candidates
--
-- Cached, explainable match suggestions for /admin/player-links.
--
-- WHAT THIS TABLE IS
--   A precomputed ranking, so the review queue can be sorted and
--   filtered by confidence without rescoring 1,900 source rows on every
--   page load, and so a reviewer sees the same evidence twice running.
--
-- WHAT THIS TABLE IS NOT
--   Authority to create a link. Approval re-reads the source and the
--   candidate inside the import transaction and runs the scorer again;
--   a cached row that no longer reflects the data is rejected there.
--   Nothing in this table can make a link by itself, and nothing here
--   is ever shown to the public.
--
-- GRAIN
--   One row per (resolution entity, rank). Six of the seven review
--   tables resolve themselves, so the entity is the row. Draft picks
--   resolve through draft_persons (migration 019), where one person may
--   own several picks: keying on the person means one decision with one
--   set of evidence, instead of four suggestions that could disagree.
--   target_table/target_id record the row a reviewer acts on.
--
-- Suggestions are advisory, exactly like the reader tips in migration
-- 056, so afldb_auth owns them. The import role is deliberately given
-- nothing here: it rescores from source data and never reads the cache.
-- =====================================================================

CREATE TABLE player_link_match_candidates (
  id                     bigint  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  resolution_entity_type text    NOT NULL,
  resolution_entity_id   bigint  NOT NULL,
  target_table           text    NOT NULL,
  target_id              bigint  NOT NULL,

  -- 1 is the best candidate. Alternatives are kept so a reviewer can
  -- see what else was plausible without re-running the search.
  rank                   smallint NOT NULL,
  player_id              integer NOT NULL REFERENCES players(id),

  score                  smallint NOT NULL,
  band                   text    NOT NULL,
  -- Distance to the next candidate. NULL means there was no rival,
  -- which is the least ambiguous case, not the most.
  gap                    smallint,
  near_ties              smallint NOT NULL DEFAULT 0,
  ambiguous              boolean NOT NULL DEFAULT false,
  hard_conflict          boolean NOT NULL DEFAULT false,
  -- Stricter than band: what an unattended batch may take.
  bulk_eligible          boolean NOT NULL DEFAULT false,

  -- The score broken into signals, and every contradiction found. The
  -- reviewer sees these, not a bare number.
  evidence               jsonb   NOT NULL DEFAULT '[]'::jsonb,
  conflicts              jsonb   NOT NULL DEFAULT '[]'::jsonb,

  algorithm_version      text    NOT NULL,
  computed_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plmc_entity_type_ck CHECK (resolution_entity_type IN (
    'award_winners', 'award_nominations', 'hall_of_fame',
    'honour_team_members', 'captaincies', 'player_achievements',
    'draft_picks', 'draft_person')),
  CONSTRAINT plmc_target_table_ck CHECK (target_table IN (
    'award_winners', 'award_nominations', 'hall_of_fame',
    'honour_team_members', 'captaincies', 'player_achievements',
    'draft_picks')),
  CONSTRAINT plmc_band_ck CHECK (band IN ('very_high','high','medium','low','none')),
  CONSTRAINT plmc_entity_id_ck CHECK (resolution_entity_id > 0),
  CONSTRAINT plmc_target_id_ck CHECK (target_id > 0),
  CONSTRAINT plmc_rank_ck CHECK (rank >= 1),
  CONSTRAINT plmc_score_ck CHECK (score BETWEEN 0 AND 100),
  -- A contradicted candidate is never bulk-approvable, enforced rather
  -- than trusted to the application.
  CONSTRAINT plmc_bulk_ck CHECK (NOT bulk_eligible OR NOT hard_conflict),
  CONSTRAINT plmc_entity_rank_uq UNIQUE (resolution_entity_type, resolution_entity_id, rank)
);

COMMENT ON TABLE player_link_match_candidates IS
  'Cached, explainable match suggestions for the player-link review queue. Advisory only: approval rescores from source data inside the import transaction.';
COMMENT ON COLUMN player_link_match_candidates.gap IS
  'Score distance to the next candidate. NULL means no rival existed at all.';
COMMENT ON COLUMN player_link_match_candidates.bulk_eligible IS
  'Stricter than band: requires exact-quality name evidence, two independent corroborating families, a wide gap and no contradiction.';

CREATE INDEX ix_plmc_target ON player_link_match_candidates (target_table, target_id);
CREATE INDEX ix_plmc_band   ON player_link_match_candidates (band) WHERE rank = 1;
CREATE INDEX ix_plmc_bulk   ON player_link_match_candidates (resolution_entity_type)
  WHERE rank = 1 AND bulk_eligible;
-- Supporting index for the foreign key, so a player delete does not
-- sequential-scan this table (the omission AFLDB-ISSUE-073 tracks).
CREATE INDEX ix_plmc_player ON player_link_match_candidates (player_id);

-- ---------------------------------------------------------------------
-- Approval provenance
--
-- Columns, not a note string: calibrating the model later means asking
-- "what did suggested approvals actually score, and were any of them
-- reverted", which has to be queryable. All three are nullable, so
-- every resolution written before this migration stays valid and
-- manual approvals simply record 'manual'.
-- ---------------------------------------------------------------------
ALTER TABLE player_link_resolutions
  ADD COLUMN match_method      text,
  ADD COLUMN match_score       smallint,
  ADD COLUMN algorithm_version text;

ALTER TABLE player_link_resolutions
  ADD CONSTRAINT plr_match_method_ck CHECK (
    match_method IS NULL OR match_method IN ('manual', 'suggested', 'bulk_suggested')),
  ADD CONSTRAINT plr_match_score_ck CHECK (
    match_score IS NULL OR match_score BETWEEN 0 AND 100);

COMMENT ON COLUMN player_link_resolutions.match_score IS
  'The score the server recomputed at approval time, never a value supplied by the browser.';

-- ---------------------------------------------------------------------
-- Privileges
--
-- afldb_app reads the cache to render the queue. afldb_auth owns it,
-- because regenerating suggestions is an operational act like recording
-- a reader tip, not a statistical write. afldb_import gets nothing: the
-- approval path rescores from source tables and must not be able to
-- read its own advice back.
--
-- Since migration 039 afldb_app is fail-closed, so a new table is
-- invisible until it is registered readable. Mirrored in
-- tools/maintenance/privileges.sql, which is subtractive.
-- ---------------------------------------------------------------------
SELECT afldb_meta.grant_app_read('player_link_match_candidates');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON player_link_match_candidates TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE player_link_match_candidates_id_seq TO afldb_auth;
  END IF;
END
$$;
