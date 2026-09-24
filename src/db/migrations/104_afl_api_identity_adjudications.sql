-- ---------------------------------------------------------------------
-- 104 — AFLDB-ISSUE-235: afl_api human identity adjudication
-- ---------------------------------------------------------------------
-- Adds the one human path onto an afl_api provider (CD_I...) that ingestion
-- could not resolve on its own. The bridge loader
-- (tools/migration/import_afl_api_player_bridge.py) is the only OTHER
-- writer of external_identities for source 'afl_api', and it writes every
-- row as status = 'unique' (E3 in the runbook). It never UPDATEs or
-- DELETEs a row (E6). Because external_identities carries
-- UNIQUE (source_id, external_id), at most one row can ever exist per
-- provider, so there is no ranking between the two writers: first trusted
-- writer wins, and neither writer may change the other's row (runbook D1).
--
-- This migration adds two things, both load-bearing for that contract:
--
--   1. afl_api_identity_adjudications -- an append-only ledger of every
--      human 'linked'/'revoked' decision, keyed on stable identities only
--      (external_id, player_identity), never on a surrogate FK into
--      external_identities (there is none to have: a revoke DELETEs the
--      row it undoes). It is durable identity authority (OD-3): a
--      promotion or the destructive afldb_test rebuild replays a human
--      'resolved' external_identities row from this ledger, so the ledger
--      must outlive the row it describes. player_identity stores exactly
--      the value tools/db/promotion-inventory.ts's existing
--      afltables_profile_url lineage rule already computes for the player
--      (external_identities.external_id for a trusted
--      afltables/afltables_profile_url row, or manual_admin_edit/
--      manual_admin_edit for an administrator-created player) -- not a
--      prefixed composite -- so a promotion or rebuild can assert the
--      remapped player's identity against the stored value with no new
--      parsing and no new identity kind (plan-review R8).
--
--      Written as afldb_import, INSERT into external_identities and INSERT
--      into this table in the SAME transaction (the migration-066/
--      AFLDB-ISSUE-027 pattern): an audit failure rolls the identity write
--      back. Grants are therefore SELECT, INSERT + sequence USAGE to
--      afldb_import, and SELECT only to afldb_auth (the admin history
--      view). No role ever gets UPDATE, DELETE or TRUNCATE: this table is
--      deliberately NOT added to afldb_meta.import_writable_tables, whose
--      reconcile loop would hand full DML back and destroy the
--      append-only property (the 066 reason, restated here).
--
--   2. uq_external_identities_afl_api_player -- a partial unique index,
--      one afl_api row per player, closing the gap that neither the
--      loader (it checks only the provider key, never rule (b) across
--      writers) nor the schema previously enforced. It binds on
--      source_id, so it catches a row under ANY match_method, importer or
--      human alike -- a match_method-based convention could be escaped by
--      a future writer. The DO block below re-checks for existing
--      duplicates and fails closed if any exist; AFLDB-ISSUE-235's S0
--      census found zero on both afldb_test (803/803/803) and DEV
--      (669/669/669) on 2026-09-23, but this migration does not trust
--      that stale reading -- it measures again, at apply time, on
--      whichever database it runs against.
--
-- Deployment order (the ISSUE-027 lesson, restated): this migration and
-- db:privileges must land BEFORE the application code that writes this
-- table, or every adjudication action fails closed with no write. That is
-- the safe direction: reverting the order the other way round risks
-- nothing being written, never a wrong write.
-- ---------------------------------------------------------------------

CREATE TABLE afl_api_identity_adjudications (
  id                                  bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- Free column rather than an FK into sources: the ledger must remain
  -- readable, and its rows must remain remappable, even if a database
  -- rebuild has not yet (re-)created the afl_api sources row.
  source_key                          text         NOT NULL CHECK (source_key = 'afl_api'),
  external_id                         text         NOT NULL CHECK (external_id ~ '^CD_I[0-9]+$'),
  action                              text         NOT NULL CHECK (action IN ('linked', 'revoked')),
  player_id                           integer      NOT NULL REFERENCES players(id),
  -- The stable identity of player_id at the time of the action -- see the
  -- header. Never NULL: D6-3 already requires a stable identity before a
  -- link can be written at all.
  player_identity                     text         NOT NULL,
  -- The provider's external_identities row immediately before this
  -- action, or NULL for a first link. Reduced form (id/status/player_id/
  -- match_method), never raw payloads.
  previous_state                      jsonb,
  -- The evidence snapshot the admin was shown (runbook §6, blocks 1-5,
  -- reduced form) plus its fingerprint context. NOT the raw spine
  -- payload.
  evidence                            jsonb        NOT NULL,
  evidence_sha256                     text         NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  surname_disagreement_acknowledged   boolean      NOT NULL,
  -- Set only on a 'revoked' row: the 'linked' row it undoes. Intra-table,
  -- so it is carried unchanged by a rebuild/promotion reinstate (the ids
  -- are reinstated together, never reassigned independently).
  supersedes_id                       bigint       REFERENCES afl_api_identity_adjudications(id),
  admin_user_id                       integer      NOT NULL REFERENCES auth_users(id),
  -- OD-4: every manual adjudication carries a non-trivial note, whether or
  -- not a surname disagreement holds.
  note                                text         NOT NULL CHECK (length(note) BETWEEN 20 AND 2000),
  created_at                          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT afl_api_identity_adjudications_revoke_ck
    CHECK ((action = 'revoked') = (supersedes_id IS NOT NULL))
);

COMMENT ON TABLE afl_api_identity_adjudications IS
  'AFLDB-ISSUE-235: append-only ledger of every human afl_api identity decision (linked/revoked). Durable identity authority (OD-3): a promotion or the afldb_test rebuild replays the human resolved external_identities row from this ledger, keyed on external_id and player_identity, never on a surrogate id into external_identities. No role ever gets UPDATE, DELETE or TRUNCATE.';
COMMENT ON COLUMN afl_api_identity_adjudications.player_identity IS
  'The same value tools/db/promotion-inventory.ts LINEAGE_IDENTITY_SQL.afltables_profile_url already computes for player_id: external_identities.external_id for a trusted afltables/afltables_profile_url row, or the manual_admin_edit token for an administrator-created player. Not a prefixed composite, so the promotion/rebuild remap assertion compares it byte-for-byte with no new parsing.';
COMMENT ON COLUMN afl_api_identity_adjudications.supersedes_id IS
  'Set only when action = revoked: the linked row this revoke undoes.';

CREATE INDEX ix_afl_api_identity_adjudications_external_id
  ON afl_api_identity_adjudications (external_id);
CREATE INDEX ix_afl_api_identity_adjudications_player_id
  ON afl_api_identity_adjudications (player_id);
CREATE INDEX ix_afl_api_identity_adjudications_admin_user_id
  ON afl_api_identity_adjudications (admin_user_id);

-- ---------------------------------------------------------------------
-- Grants. Deliberately outside afldb_meta.import_writable_tables (its
-- reconcile loop hands back UPDATE/DELETE/TRUNCATE, which would destroy
-- the append-only property -- the migration-066 reason). Mirrored in
-- tools/maintenance/privileges.sql, whose afldb_auth section is
-- subtractive: a grant absent from that file is revoked on the next
-- reconcile.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT, INSERT ON afl_api_identity_adjudications TO afldb_import;
    GRANT USAGE ON SEQUENCE afl_api_identity_adjudications_id_seq TO afldb_import;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    -- SELECT only: afldb_auth never writes this table. Every write runs
    -- as afldb_import, in the same transaction as the external_identities
    -- write it audits (runbook D8, the migration-066/AFLDB-ISSUE-027
    -- pattern).
    GRANT SELECT ON afl_api_identity_adjudications TO afldb_auth;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- OD-1 (approved 2026-09-23): one afl_api provider per player, enforced
-- in the database across both writers. The source-id predicate binds
-- every afl_api row whatever its match_method; a match_method LIKE
-- pattern could be escaped by a future writer (runbook §8.3).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  src_id  smallint;
  dupes   bigint;
BEGIN
  SELECT id INTO src_id FROM sources WHERE key = 'afl_api';
  IF src_id IS NULL THEN
    RAISE EXCEPTION
      'sources.key = ''afl_api'' not found. Migration 077 registers it and must be applied first.';
  END IF;

  SELECT count(*) INTO dupes FROM (
    SELECT player_id
      FROM external_identities
     WHERE source_id = src_id AND player_id IS NOT NULL
     GROUP BY player_id
    HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      '% player(s) hold more than one afl_api external_identities row, so the '
      'one-provider-per-player index (AFLDB-ISSUE-235 OD-1) cannot be built yet. '
      'Each case needs human adjudication before this migration can apply. Inspect them with: '
      'SELECT player_id, count(*) FROM external_identities WHERE source_id = % AND player_id IS NOT NULL '
      'GROUP BY player_id HAVING count(*) > 1;',
      dupes, src_id;
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX uq_external_identities_afl_api_player ON external_identities (player_id) '
    || 'WHERE source_id = %s AND player_id IS NOT NULL',
    src_id);
END
$$;

COMMENT ON INDEX uq_external_identities_afl_api_player IS
  'AFLDB-ISSUE-235 OD-1: one afl_api (sources.key) provider identity per player, across both writers (importer unique and human resolved).';
