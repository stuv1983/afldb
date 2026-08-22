-- ---------------------------------------------------------------------
-- 069 — the draft source's real identity (AFLDB-ISSUE-078)
-- ---------------------------------------------------------------------
-- tools/migration/import_draft.py used to TRUNCATE draft_picks and
-- draft_persons and re-COPY them. draft_picks is in LINK_TARGET_TABLES,
-- so its surrogate id is durable application identity the moment
-- player_link_resolutions names it — and draft_persons.id is referenced
-- just as durably by player_link_match_candidates and by the draft-person
-- data_issues history. Rebuilding therefore destroyed manual links, left
-- their audit rows dangling, and silently deleted admin-created picks.
--
-- Reloading by key instead needs a key, and the obvious candidates are
-- not keys at all:
--
--   * source_record_id holds the legacy SQLite rowid, and the upstream
--     loader writes that table with to_sql(if_exists="replace"), so every
--     rowid is reissued on every source rebuild;
--   * dg_person_id is assigned as `p.index + 1` over a person frame
--     sorted by player_url, i.e. a RANK recomputed on every load, not
--     DraftGuru's own id. A single new person renumbers everything after
--     it;
--   * pick_number is a correctable fact and is NULL for trades, free
--     agency and signings.
--
-- What the source does carry is player_url — DraftGuru's own person page,
-- whose trailing ordinal disambiguates same-name people. It is the
-- upstream loader's own person_key, of which dg_person_id is merely the
-- rank, and AFLDB already stores it on both tables.
--
--   draft_persons  (source_id, player_url)
--   draft_picks    (source_id, player_url, draft_year, draft_kind)
--
-- draft_year is not a correctable field here: the year page IS the
-- source_url, one to one. draft_kind separates the 23 people who appear
-- twice on one year's board (Pre-Draft + Trade, National + Pre-Season,
-- and so on), and unlike draft_type it already absorbs the source's own
-- `National` / `National Draft` wording split.
--
-- Both indexes FAIL CLOSED: if the current data contains a duplicate the
-- migration errors and nothing is de-duplicated or rewritten on its own
-- authority. Verified clean on afldb_dev and afldb_test, 2026-08-22
-- (6,810 picks, 5,057 persons, 0 duplicates, 0 NULL draft_kind).
--
-- The draft_picks index is PARTIAL on source_id IS NOT NULL so that
-- admin-created picks — createPlayerInTransaction leaves source_id,
-- source_record_id and draft_person_id NULL — stay outside the importer's
-- identity space entirely, and two admins can still create players
-- drafted at the same year and pick without colliding. That is the same
-- ownership boundary the reload itself now uses, and the mistake tracked
-- as AFLDB-ISSUE-080 on the honours tables.
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX draft_persons_source_uq
    ON draft_persons (source_id, player_url);

CREATE UNIQUE INDEX draft_picks_source_uq
    ON draft_picks (source_id, player_url, draft_year, draft_kind)
    NULLS NOT DISTINCT
    WHERE source_id IS NOT NULL;

COMMENT ON INDEX draft_persons_source_uq IS
    'DraftGuru person identity: the reload key for draft_persons.';
COMMENT ON INDEX draft_picks_source_uq IS
    'DraftGuru selection identity: the reload key for source-owned draft_picks. '
    'Partial, so admin-created rows (source_id IS NULL) are outside it.';

-- dg_person_id remains stored and indexed — the upstream project, the
-- draft board and the data_issues payloads all quote it — but it is a
-- per-load rank, so the reload UPDATEs it like any other fact. A bulk
-- UPDATE that PERMUTES a column under a non-deferrable UNIQUE constraint
-- fails row by row, so the constraint has to be deferrable for the first
-- reload after the source renumbers to succeed. It stays INITIALLY
-- IMMEDIATE: ordinary writes are checked exactly as before, and only the
-- importer defers it, inside its own transaction.
ALTER TABLE draft_persons
    DROP CONSTRAINT draft_persons_source_id_dg_person_id_key,
    ADD  CONSTRAINT draft_persons_source_id_dg_person_id_key
         UNIQUE (source_id, dg_person_id) DEFERRABLE INITIALLY IMMEDIATE;
