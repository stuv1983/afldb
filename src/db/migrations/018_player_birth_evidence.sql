-- =====================================================================
-- AFLDB 018 — Birth-date evidence
-- =====================================================================
-- Only 945 of 13,361 players (7.1%) carry a date of birth, yet the dates
-- for 12,472 of them are already present in the legacy database. The
-- club player register scraper collapsed a malformed AFL Tables table
-- header, so every column ended up under one key:
--
--   "DOB HT WT Games (W-D-L) Goals Seasons Debut Last": "1976-08-04"
--
-- The parsed dob column is empty for all 15,310 rows; raw_row_json is
-- intact. Keeping the raw payload is what makes this recoverable at all.
--
-- This migration adds the evidence table. Nothing is written to
-- players.dob by the migration itself: the backfill is a separate,
-- re-runnable enrichment pass, so the evidence and the decision made
-- from it stay visible and reversible.
--
-- Rules the backfill obeys, enforced here where possible:
--   * Join on the AFL Tables profile URL, never on name. Names collide
--     (six Peter Browns, two Ron Barassis); the profile URL does not.
--   * Fill only MISSING dates. An existing value is never overwritten.
--   * A disagreement is recorded as a data_issue and left unresolved,
--     not silently averaged or preferred.
-- =====================================================================

CREATE TABLE player_birth_evidence (
  id           bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  player_id    integer     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source_id    smallint    NOT NULL REFERENCES sources(id),

  -- The durable key in the source. For AFL Tables this is the profile
  -- URL path, which survives spelling changes to the player's name.
  external_id  text,

  dob          date        NOT NULL,
  evidence_type text       NOT NULL,
  confidence   value_confidence NOT NULL DEFAULT 'sourced',

  -- How many source rows asserted this date. A player appears in the
  -- register once per club, so agreement across stints is corroboration.
  occurrences  integer     NOT NULL DEFAULT 1,

  batch_id     bigint      REFERENCES import_batches(id),
  observed_at  timestamptz NOT NULL DEFAULT now(),
  notes        text,

  CONSTRAINT pbe_plausible_ck CHECK (dob >= DATE '1850-01-01'),
  -- One row per distinct date per player per source: repeated agreement
  -- increments occurrences rather than adding rows.
  CONSTRAINT player_birth_evidence_uq UNIQUE (player_id, source_id, dob)
);
COMMENT ON TABLE player_birth_evidence IS
  'Every birth date any source asserts for a player, with its origin. players.dob is a decision made from these rows; this table is the evidence behind it, retained so the decision can be revisited.';
COMMENT ON COLUMN player_birth_evidence.external_id IS
  'Source key the evidence was joined on. Names are never used: they collide.';
COMMENT ON COLUMN player_birth_evidence.occurrences IS
  'Number of source rows asserting this date. Two clubs agreeing is corroboration, not duplication.';

CREATE INDEX ix_pbe_player ON player_birth_evidence (player_id);

-- Which evidence row produced the value currently in players.dob, and
-- whether anything disagrees with it.
ALTER TABLE players
  ADD COLUMN dob_evidence_id bigint REFERENCES player_birth_evidence(id),
  ADD COLUMN dob_disputed    boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN players.dob_evidence_id IS
  'The evidence row players.dob was taken from. NULL means the date predates this system or none is known.';
COMMENT ON COLUMN players.dob_disputed IS
  'True when sources disagree. The existing value is retained and an open data_issue records the conflict; it is not resolved by guessing.';

CREATE INDEX ix_players_dob_disputed ON players (id) WHERE dob_disputed;

-- A date of birth that is present must say where it came from.
ALTER TABLE players
  ADD CONSTRAINT players_dob_confidence_ck
  CHECK (dob IS NULL OR dob_confidence <> 'unknown');

GRANT SELECT ON player_birth_evidence TO afldb_app;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON player_birth_evidence TO afldb_import;
