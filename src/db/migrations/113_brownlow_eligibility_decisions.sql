-- =====================================================================
-- 113 - Brownlow eligibility decisions: the append-only ledger of administrator rulings
-- =====================================================================
-- AFLDB V2 Launch F (stream F-D, Brownlow eligibility; follows the migration 111 / 112 pattern).
-- Forward-only. Additive. Writes NO data and never rewrites an existing row.
--
-- Purpose
-- -------
-- Whether a player was ELIGIBLE for the Brownlow Medal in a season is sometimes a matter of a
-- ruling (a suspension, a tribunal outcome, a rule in force that year) rather than of a source
-- column. The owner's rule is that an authorised administrator resolves a player's eligibility
-- through an AUDITED DECISION carrying a citation and a note, that the decision is new
-- authoritative evidence going forward, and that it NEVER alters the raw votes. This table is
-- where such a decision is recorded:
--   * verdict      'eligible' or 'ineligible';
--   * citation     the URL or source reference the ruling rests on;
--   * note         the administrator's reasoning (20..2000 characters);
--   * decided_by / decided_at   the actor and the time;
--   * basis        'open_season' (the season is not sealed) or 'audited_correction' (the
--                  season is sealed, so the decision is an audited correction through the
--                  season seal, workflow 'brownlow_eligibility_decision',
--                  packages/domain/src/season-seal.ts, docs/v2/historical-baseline.md section 2);
--   * correction   the seal's audit record (evaluateSeasonWrite(...).audit), NULL for an open
--                  season.
--
-- Precedence: a decision is NEW AUTHORITATIVE ELIGIBILITY EVIDENCE and takes precedence over
-- the flags stored on brownlow_season_votes (is_ineligible, ineligible_reason). The raw vote
-- rows are untouched: this table sits beside them and a reader resolves the effective
-- eligibility from the CURRENT decision of a (season, player_identity), falling back to the
-- stored flag only where no decision exists.
--
-- Natural identity, not row ids
-- -----------------------------
-- A decision names its player by the durable identity string
-- src/db/queries/player-identity.ts resolvePlayerIdentity() computes ('afltables:<profile path>'
-- or 'manual_admin_edit:<token>'), NEVER by a foreign key into players or seasons. Those tables
-- are rebuilt by TRUNCATE ... CASCADE and renumbered by a promotion, so an FK into them would
-- either empty this ledger on a rebuild or make it lineage-bound (the migration 111 / 112
-- reason, restated). player_id_at_decision is a SNAPSHOT of the database id at the time of the
-- decision, kept for the reader's convenience; it carries no constraint other than > 0 and is
-- not a durable reference. The only foreign keys are decided_by -> auth_users(id) and the
-- intra-table supersession chain.
--
-- Append-only, and how "current" is kept without an UPDATE
-- ---------------------------------------------------------
-- No role is ever granted UPDATE, DELETE or TRUNCATE here, so a decision can never be edited
-- or withdrawn in place. Reversal is expressed by a NEW row: supersedes_id names the decision
-- it replaces (the same single-chain design as derived_award_results, migration 112). Four
-- constraints make the chain a single linear history per (season, player_identity):
--   * uq_brownlow_eligibility_decisions_root        at most ONE row per (season,
--                                                   player_identity) has supersedes_id IS NULL;
--   * uq_brownlow_eligibility_decisions_supersedes  a row has at most ONE successor;
--   * brownlow_eligibility_decisions_supersedes_fk  the predecessor must be the SAME
--                                                   (season, player_identity), via a composite
--                                                   foreign key to (id, season, player_identity);
--   * brownlow_eligibility_decisions_supersedes_ck  supersedes_id < id, so there is no cycle.
-- The CURRENT decision is the one no other row names in supersedes_id (equivalently the highest
-- id). Writers serialise with pg_advisory_xact_lock (afldb_import has no UPDATE privilege, so
-- SELECT ... FOR UPDATE is unavailable by design); the two unique indexes are the backstop.
--
-- Grants (hand-written, NOT afldb_meta.grant_app_read / grant_import_write)
-- ------------------------------------------------------------------------
--   afldb_import   SELECT, INSERT + USAGE on the identity sequence
--   afldb_auth     SELECT (the admin history view)
--   afldb_app      nothing at the table level. A public surface that reflects a decision
--                  reads it through the application's own server-side query, not through a
--                  direct app-role grant on the ledger.
-- The table is deliberately NOT registered in afldb_meta.import_writable_tables: that
-- registry's reconcile loop hands out UPDATE, DELETE and TRUNCATE, which would destroy the
-- append-only property (the migration-066 / 104 / 111 / 112 reason).
--
-- Deployment order (the AFLDB-ISSUE-027 / 097 lesson): apply this migration, THEN run
-- `npm run db:privileges` (it re-grants the import and auth blocks added to
-- tools/maintenance/privileges.sql, whose revoke loop strips them on every reconcile), THEN
-- deploy the code that writes this table. The other order only ever fails closed (no write),
-- never writes wrongly.
--
-- ROLLBACK: (comment lines only; the migration runner executes this whole file)
-- ROLLBACK:   DROP TABLE IF EXISTS brownlow_eligibility_decisions;
-- ROLLBACK:   Dropping the table drops its identity sequence, indexes, constraints and grants.
-- ROLLBACK:   Then remove the brownlow_eligibility_decisions blocks from
-- ROLLBACK:   tools/maintenance/privileges.sql (the afldb_import block and the afldb_auth spec
-- ROLLBACK:   row), the table name from the NOT IN list in tests/integration/privileges.test.ts
-- ROLLBACK:   with its dedicated test case, the inventory entry in tools/db/promotion-inventory.ts,
-- ROLLBACK:   the pins in tests/db-promotion-check.test.ts and the list in
-- ROLLBACK:   tests/reference-data.test.ts, and the workflow id 'brownlow_eligibility_decision'
-- ROLLBACK:   from AUDITED_CORRECTION_WORKFLOWS (packages/domain/src/season-seal.ts) with its
-- ROLLBACK:   pin in tests/v2-season-seal.test.ts and its row in docs/v2/historical-baseline.md.
-- ROLLBACK:   Rolling back DISCARDS every eligibility decision and its audit record: export them
-- ROLLBACK:   first (COPY brownlow_eligibility_decisions TO a file). brownlow_season_votes is NOT
-- ROLLBACK:   affected: this ledger never altered it.
-- =====================================================================

CREATE TABLE brownlow_eligibility_decisions (
  id                    bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- The target, by natural identity (see the header).
  season                integer      NOT NULL,
  player_identity       text         NOT NULL,
  -- A snapshot of players.id when the decision was made. NOT a foreign key: a rebuild renumbers.
  player_id_at_decision integer      NOT NULL,

  -- The ruling.
  verdict               text         NOT NULL,
  citation              text         NOT NULL,
  note                  text         NOT NULL,

  -- The decision.
  decided_by            integer      NOT NULL REFERENCES auth_users(id),
  decided_at            timestamptz  NOT NULL DEFAULT now(),
  basis                 text         NOT NULL,
  -- The season seal's audit record (evaluateSeasonWrite(...).audit); NULL for an open season.
  correction            jsonb,

  -- The decision this one replaces; NULL for the first decision of a (season, player_identity).
  supersedes_id         bigint,

  -- Target of the composite supersession foreign key below.
  CONSTRAINT brownlow_eligibility_decisions_target_uq
    UNIQUE (id, season, player_identity),
  -- The predecessor must belong to the same (season, player_identity). With supersedes_id NULL
  -- the foreign key is not checked (MATCH SIMPLE).
  CONSTRAINT brownlow_eligibility_decisions_supersedes_fk
    FOREIGN KEY (supersedes_id, season, player_identity)
    REFERENCES brownlow_eligibility_decisions (id, season, player_identity),
  CONSTRAINT brownlow_eligibility_decisions_supersedes_ck
    CHECK (supersedes_id IS NULL OR supersedes_id < id),
  CONSTRAINT brownlow_eligibility_decisions_season_ck
    CHECK (season BETWEEN 1897 AND 2100),
  CONSTRAINT brownlow_eligibility_decisions_player_identity_ck
    CHECK (player_identity ~ '^(afltables|manual_admin_edit):.+$' AND length(player_identity) <= 500),
  CONSTRAINT brownlow_eligibility_decisions_player_id_ck
    CHECK (player_id_at_decision > 0),
  CONSTRAINT brownlow_eligibility_decisions_verdict_ck
    CHECK (verdict IN ('eligible', 'ineligible')),
  CONSTRAINT brownlow_eligibility_decisions_citation_ck
    CHECK (length(btrim(citation)) BETWEEN 1 AND 2000),
  CONSTRAINT brownlow_eligibility_decisions_note_ck
    CHECK (length(btrim(note)) BETWEEN 20 AND 2000),
  CONSTRAINT brownlow_eligibility_decisions_basis_ck
    CHECK (basis IN ('open_season', 'audited_correction')),
  -- An open-season decision carries no seal record; a sealed-season decision carries the seal's
  -- own, for THIS workflow, season and actor, with the note and evidence the seal requires.
  -- coalesce(..., false): a CHECK PASSES on NULL, so a missing key must FAIL, not pass.
  CONSTRAINT brownlow_eligibility_decisions_correction_ck
    CHECK (
      (basis = 'open_season' AND correction IS NULL)
      OR (basis = 'audited_correction'
          AND correction IS NOT NULL
          AND jsonb_typeof(correction) = 'object'
          AND coalesce(
            correction ->> 'workflow' = 'brownlow_eligibility_decision'
            AND correction ->> 'actorUserId' = decided_by::text
            AND correction ->> 'season' = season::text
            AND length(btrim(correction ->> 'note')) BETWEEN 20 AND 2000
            AND length(btrim(correction ->> 'evidenceRef')) >= 1,
            false))
    )
);

COMMENT ON TABLE brownlow_eligibility_decisions IS
  'AFLDB V2 Brownlow eligibility (migration 113): append-only ledger of administrator eligibility decisions (verdict, citation, note, actor, basis). NEW authoritative eligibility evidence that takes precedence over the flags stored on brownlow_season_votes; it never alters a raw vote. A reversal is a NEW row with supersedes_id naming its predecessor; the current decision of a (season, player_identity) is the one no other row supersedes. No role gets UPDATE, DELETE or TRUNCATE. Names its player by durable identity string, never by foreign key into players or seasons.';
COMMENT ON COLUMN brownlow_eligibility_decisions.player_identity IS
  'The durable identity string resolvePlayerIdentity() computes: afltables:<profile path> or manual_admin_edit:<token>. The natural identity of the decision; survives a rebuild.';
COMMENT ON COLUMN brownlow_eligibility_decisions.player_id_at_decision IS
  'Snapshot of players.id when the decision was made. NOT a foreign key and not durable: a rebuild or promotion renumbers players. Use player_identity.';
COMMENT ON COLUMN brownlow_eligibility_decisions.basis IS
  'open_season (the season was not sealed; correction is NULL) or audited_correction (a sealed season; correction holds the season seal audit record, workflow brownlow_eligibility_decision).';
COMMENT ON COLUMN brownlow_eligibility_decisions.correction IS
  'evaluateSeasonWrite(...).audit from packages/domain/src/season-seal.ts: season, workflow (brownlow_eligibility_decision), actorUserId (= decided_by), note and evidenceRef. NULL when basis is open_season.';
COMMENT ON COLUMN brownlow_eligibility_decisions.supersedes_id IS
  'The earlier decision this one replaces, always for the same (season, player_identity). NULL for the first decision. At most one row names any given predecessor.';

-- Exactly one first decision per (season, player_identity).
CREATE UNIQUE INDEX uq_brownlow_eligibility_decisions_root
  ON brownlow_eligibility_decisions (season, player_identity)
  WHERE supersedes_id IS NULL;
-- A decision has at most one successor, so the chain is linear. Also the supporting index for
-- the supersedes_id foreign key.
CREATE UNIQUE INDEX uq_brownlow_eligibility_decisions_supersedes
  ON brownlow_eligibility_decisions (supersedes_id)
  WHERE supersedes_id IS NOT NULL;
CREATE INDEX ix_brownlow_eligibility_decisions_target
  ON brownlow_eligibility_decisions (season, player_identity, id);
CREATE INDEX ix_brownlow_eligibility_decisions_decided_by
  ON brownlow_eligibility_decisions (decided_by);

-- ---------------------------------------------------------------------
-- Grants. Guarded on the roles so a database built before they exist still
-- applies; tools/maintenance/privileges.sql mirrors them (its afldb_import
-- revoke loop strips them on every reconcile, and its afldb_auth section is
-- subtractive).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT, INSERT ON brownlow_eligibility_decisions TO afldb_import;
    GRANT USAGE ON SEQUENCE brownlow_eligibility_decisions_id_seq TO afldb_import;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    -- SELECT only: afldb_auth never writes this table. Every write runs as
    -- afldb_import, inside the decision's single transaction.
    GRANT SELECT ON brownlow_eligibility_decisions TO afldb_auth;
  END IF;
END
$$;
