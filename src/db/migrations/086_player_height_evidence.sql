-- =====================================================================
-- AFLDB 086 — Height evidence (AFLDB-ISSUE-118 Stage H2)
-- =====================================================================
-- players.height_cm (002) has been NULL for every player on every
-- environment since the canonical rebuild: the fitzRoy core import
-- deliberately leaves the AFL Tables player_details register alone
-- because it carries no stable id. Two Gridley criteria ("195cm OR
-- TALLER", "180cm OR SHORTER", 142 board occurrences) read that column.
--
-- This migration adds the evidence table the height backfill writes to,
-- on the same terms as player_birth_evidence (018):
--
--   * Nothing here writes players.height_cm. The fill is a separate,
--     re-runnable enrichment pass (tools/migration/enrich_heights.py),
--     so the evidence and the decision made from it stay visible.
--   * Identity is the AFL Tables profile URL held in external_identities
--     (match_method 'afltables_profile_url'), reached by reconciling the
--     register row to the snapshot's own per-match rows on club, games,
--     goals, the exact season set and the source's own spelling of the
--     name. A name alone never identifies anyone.
--   * Fill only MISSING heights. An existing value is never overwritten.
--   * Two heights asserted for one player are both kept as evidence, the
--     player is NOT filled, and the conflict is opened as a data_issue —
--     never averaged, never "first one wins".
-- =====================================================================

CREATE TABLE player_height_evidence (
  id           bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  player_id    integer     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source_id    smallint    NOT NULL REFERENCES sources(id),

  -- The durable key in the source. For AFL Tables this is the profile
  -- URL path (players/A/Name.html), the same form external_identities
  -- stores, so the evidence can always be traced back to the identity
  -- it was joined through.
  external_id  text,

  height_cm    smallint    NOT NULL,
  evidence_type text       NOT NULL,
  confidence   value_confidence NOT NULL DEFAULT 'sourced',

  -- How many source rows asserted this height. The register lists a
  -- player once per club, so agreement across stints is corroboration.
  occurrences  integer     NOT NULL DEFAULT 1,

  batch_id     bigint      REFERENCES import_batches(id),
  observed_at  timestamptz NOT NULL DEFAULT now(),
  notes        text,

  -- The same plausibility window the player_bio ingest dataset enforces.
  CONSTRAINT phe_plausible_ck CHECK (height_cm BETWEEN 120 AND 230),
  -- One row per distinct height per player per source: repeated
  -- agreement increments occurrences rather than adding rows.
  CONSTRAINT player_height_evidence_uq UNIQUE (player_id, source_id, height_cm)
);
COMMENT ON TABLE player_height_evidence IS
  'Every height any source asserts for a player, with its origin. players.height_cm is a decision made from these rows; this table is the evidence behind it, retained so the decision can be revisited.';
COMMENT ON COLUMN player_height_evidence.external_id IS
  'Source key the evidence was joined on (the AFL Tables profile URL path). Names are never used: they collide.';
COMMENT ON COLUMN player_height_evidence.occurrences IS
  'Number of source rows asserting this height. Two clubs agreeing is corroboration, not duplication.';

CREATE INDEX ix_phe_player ON player_height_evidence (player_id);

-- Which evidence row produced the value currently in players.height_cm.
-- NULL with a height present means the value predates this system or
-- was entered by hand (the player_bio ingest dataset, migration-free).
ALTER TABLE players
  ADD COLUMN height_evidence_id bigint REFERENCES player_height_evidence(id);

COMMENT ON COLUMN players.height_evidence_id IS
  'The evidence row players.height_cm was taken from. NULL means the height predates this system, was entered by hand, or none is known.';

-- Fail-closed role registries (039 / 045): the app reads it, the ETL
-- role writes it. privileges.sql reconciles from these rows.
SELECT afldb_meta.grant_app_read('player_height_evidence');
SELECT afldb_meta.grant_import_write('player_height_evidence');
