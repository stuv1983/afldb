-- =====================================================================
-- 101 - Awards & honours: the correction / void / replacement lifecycle
-- =====================================================================
-- AFLDB-ISSUE-165 (AFLDB-ISSUE-156 P5) Stage 1. Forward-only. Additive.
--
-- /admin/data-editor can CREATE an award winner, a Hall of Fame inductee
-- and an honour-team member (src/db/queries/awards-admin.ts). Nothing in
-- AFLDB can edit, void, replace or restore one afterwards, and there is
-- no reload-survival mechanism of any kind for a correction to a
-- source-owned row: tools/migration/import_awards.py reloads all three
-- through reload_keyed(), whose UPDATE re-asserts every column in the
-- caller's own list from the freshly parsed source on every run and
-- consults data_overrides for none of these tables. A correction made
-- today would be silently reverted by the next reload of that group.
--
-- This migration adds the smallest schema the lifecycle needs, and
-- nothing else:
--
--   1. status / status_reason / updated_at on each of the three tables;
--   2. ACTIVE-ROW-ONLY uniqueness for hall_of_fame and
--      honour_team_members, so a replacement can re-use the identity the
--      voided row still holds;
--   3. the three table names admitted as data_overrides entity types, so
--      the durable decision survives a destructive rebuild and a
--      promotion.
--
-- THE TWO LAYERS AND WHY BOTH EXIST (AFLDB-ISSUE-165 §6.2).
--
--   status/status_reason on the canonical row survive an ORDINARY scoped
--   reload for free: reload_keyed()'s UPDATE sets only the columns the
--   caller lists (common.py: `assignments = [f"{c} = i.{c}" for c in
--   plain]`), and import_awards.py never lists these. That is the same
--   free protection award_winners.sort_order (migration 061) already
--   relies on.
--
--   They do NOT survive a FULL REBUILD. All three tables carry
--   player_id REFERENCES players(id), and a TRUNCATE ... CASCADE on
--   players empties every one of them -- the hazard import_awards.py
--   itself names at its set_reload_scope() call ("Declare what this run
--   rebuilds so TRUNCATE ... CASCADE cannot silently empty a table no
--   group here repopulates"). The row is gone, and with it every column
--   on it. So the DURABLE record is a data_overrides row replayed by
--   replay_admin_overrides(), exactly as AFLDB-ISSUE-159/160/161/162/163
--   established for coaches, players, season lists, fixtures and club
--   leadership; the columns here are the cheap read-path cache of that
--   decision, re-asserted by the replay.
--
-- TWO STATES, NOT THREE. status IN ('active','void'). There is
-- deliberately no club_leadership-style 'ended': an award result, an
-- induction or a team selection does not CEASE the way an office does.
-- A wrong one is void and a right one is active, and voiding is never a
-- DELETE -- the row is kept so its data_edits rows stay resolvable
-- through this issue's lineage identities at the next promotion remap.
--
-- hall_of_fame.removed_year IS NOT LIFECYCLE, and this migration does
-- not touch it. A person inducted and later formally removed from the
-- Hall of Fame is a real, rare historical FACT about the Hall; 'void'
-- says the AFLDB ROW was entered in error and never should have existed.
-- Conflating them would destroy the only record of which happened.
-- removed_year stays ordinary correctable metadata.
--
-- NO SPECULATIVE INDEXES (AFLDB-ISSUE-165 D-8, operator decision
-- 2026-09-13). The planning document proposed a partial index WHERE
-- status = 'active' on each table to keep the public status filter
-- cheap. It is deliberately NOT created: every existing row is 'active',
-- so such an index would today cover the whole table and buy nothing
-- that the existing access-path indexes do not already provide. An index
-- is added when a measured plan asks for one.
--
-- NO created_at. Nothing in this issue reads a creation instant -- the
-- data_edits audit row already carries when a row was made and by whom,
-- and adding a column whose only value for 3,712 existing rows would be
-- "whenever this migration happened to run" invents evidence.
--
-- NO PRIVILEGE CHANGE. All three tables predate migrations 039 and 045
-- (they are migration 005 tables), so the catalogue-derived seeds of
-- afldb_meta.app_readable_tables and afldb_meta.import_writable_tables
-- already carry them and privileges.sql already reconciles them. The
-- grants are table-level, so two new columns and three rebuilt indexes
-- need nothing further; afldb_auth's SELECT on award_winners
-- (privileges.sql, migration 023) is likewise unaffected.
--
-- NO data_edits.table_name CHANGE. Migration 058 already admits all
-- three names. What ISSUE-165 adds is the LINEAGE TARGET that admission
-- always obliged and never had: tools/db/promotion-inventory.ts now
-- resolves a data_edits row for each of these tables through a durable
-- identity string rather than reinstating a renumbered integer.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. award_winners
-- ---------------------------------------------------------------------
-- Identity here is the SOURCE RECORD -- award_winners_source_uq
-- UNIQUE NULLS NOT DISTINCT (source_id, source_record_id), migration 042
-- -- and that uniqueness is DELIBERATELY NOT CHANGED. It is not a
-- lifecycle key: a voided row keeps its source record id, and a
-- replacement is always a new manual_admin_edit row whose minted
-- 'award_winner:<uuid>' can never collide with it by construction.
--
-- And (award_id, season, player_id) must NEVER become a uniqueness rule
-- here, active-row-only or otherwise: migration 042 proved the 1984
-- All-Australian holds 24 club-selection rows AND 24 state-selection
-- rows for the same players, so two rows for one player in one award
-- season are what the source says, not a double load.
ALTER TABLE award_winners
  ADD COLUMN status        text        NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason text,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT award_winners_status_ck
    CHECK (status IN ('active', 'void')),
  ADD CONSTRAINT award_winners_void_reason_ck
    CHECK (status <> 'void' OR status_reason IS NOT NULL);

COMMENT ON COLUMN award_winners.status IS
  'active | void. ''void'' = this row was recorded in error and never represented a real award result; it is kept, never deleted, so its data_edits rows stay resolvable at the next promotion lineage remap, and it is excluded from every public projection and from the admin player-link queues. Never a DELETE and never a way to record that a result was later rescinded — that would be a fact about the award, not about the row.';
COMMENT ON COLUMN award_winners.status_reason IS
  'Why this row was voided, mandatory whenever status = ''void'' (award_winners_void_reason_ck). Leaving a void unexplained loses the only thing separating a data-entry error from a result that really happened.';
COMMENT ON COLUMN award_winners.updated_at IS
  'Last administrative mutation. The compare-and-swap column for the optimistic-concurrency contract in src/db/queries/admin-awards.ts: a mutation carrying a stale expectedUpdatedAt refuses without writing anything. The importer does NOT maintain it — reload_keyed() sets only the columns its caller lists, and this is deliberately not one of them.';


-- ---------------------------------------------------------------------
-- 2. hall_of_fame
-- ---------------------------------------------------------------------
ALTER TABLE hall_of_fame
  ADD COLUMN status        text        NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason text,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT hall_of_fame_status_ck
    CHECK (status IN ('active', 'void')),
  ADD CONSTRAINT hall_of_fame_void_reason_ck
    CHECK (status <> 'void' OR status_reason IS NOT NULL);

COMMENT ON COLUMN hall_of_fame.status IS
  'active | void. ''void'' = this ROW was entered in error. Deliberately NOT the same concept as removed_year, which records that a real inductee was later formally removed from the Hall of Fame — a genuine historical event that leaves the row entirely valid. A voided row is kept, never deleted.';
COMMENT ON COLUMN hall_of_fame.status_reason IS
  'Why this row was voided, mandatory whenever status = ''void'' (hall_of_fame_void_reason_ck).';
COMMENT ON COLUMN hall_of_fame.updated_at IS
  'Last administrative mutation; the compare-and-swap column for src/db/queries/admin-awards.ts. Not maintained by the importer.';

-- The identity key becomes ACTIVE-ROW-ONLY. This is what makes
-- "replace" expressible at all: correcting a wrong name or a wrong
-- induction year is void + a new row (both are identity-bearing under
-- migration 042's key), and the new row necessarily re-uses the name or
-- the year the voided one still carries. Under the global constraint the
-- replacement would collide with the record of its own predecessor.
--
-- NULLS NOT DISTINCT is PRESERVED and is doing the same work migration
-- 042 gave it: 45 of the 343 rows carry no inducted_year, and under the
-- default rule those 45 would be exempt from the constraint entirely --
-- the opposite of what is wanted.
--
-- A UNIQUE INDEX rather than a UNIQUE CONSTRAINT because a constraint
-- cannot be partial. Nothing references the dropped constraint by name:
-- award and honours rows are keyed by source record, not by a foreign
-- key into this table.
ALTER TABLE hall_of_fame
  DROP CONSTRAINT hall_of_fame_name_uq;

CREATE UNIQUE INDEX hall_of_fame_active_name_uq
  ON hall_of_fame (name, inducted_year) NULLS NOT DISTINCT
  WHERE status <> 'void';

COMMENT ON INDEX hall_of_fame_active_name_uq IS
  'One ACTIVE row per (name, inducted_year), replacing migration 042''s global hall_of_fame_name_uq. Voided rows are outside the index so a replacement may re-use the identity its voided predecessor still holds; NULLS NOT DISTINCT is retained from 042 because 45 inductees carry no induction year and must not be exempt from the key.';


-- ---------------------------------------------------------------------
-- 3. honour_team_members
-- ---------------------------------------------------------------------
ALTER TABLE honour_team_members
  ADD COLUMN status        text        NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason text,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT honour_team_members_status_ck
    CHECK (status IN ('active', 'void')),
  ADD CONSTRAINT honour_team_members_void_reason_ck
    CHECK (status <> 'void' OR status_reason IS NOT NULL);

COMMENT ON COLUMN honour_team_members.status IS
  'active | void. ''void'' = this row was recorded in error. Kept, never deleted, and outside both active identity indexes so a replacement may re-use the team place.';
COMMENT ON COLUMN honour_team_members.status_reason IS
  'Why this row was voided, mandatory whenever status = ''void'' (honour_team_members_void_reason_ck).';
COMMENT ON COLUMN honour_team_members.updated_at IS
  'Last administrative mutation; the compare-and-swap column for src/db/queries/admin-awards.ts. Not maintained by the importer.';

-- Migration 059's two partial indexes, rebuilt with the lifecycle
-- predicate added and NOTHING ELSE changed. 059's decision stands
-- unaltered: a linked row is keyed by player_id (a name is not an
-- identity, AFLDB-ISSUE-025), and a raw name is the honest fallback only
-- while no stable identity exists. All that is added is that a VOIDED
-- row no longer occupies its team place -- which is what lets a wrongly
-- recorded member be replaced by the right one in the same team.
--
-- The mixed linked/unlinked same-name case still has no database
-- backstop (059), so the transaction-scoped advisory lock
-- (AFLDB-ISSUE-080 §5.3) that serialises createHonourTeamMember() and
-- import_awards.py remains load-bearing and is reused unchanged by every
-- ISSUE-165 mutation that can move honour-team identity.
DROP INDEX honour_team_linked_player_uq;
DROP INDEX honour_team_unlinked_name_uq;

CREATE UNIQUE INDEX honour_team_linked_player_uq
  ON honour_team_members (team_name, player_id)
  WHERE player_id IS NOT NULL AND status <> 'void';

CREATE UNIQUE INDEX honour_team_unlinked_name_uq
  ON honour_team_members (team_name, player_name_raw)
  WHERE player_id IS NULL AND status <> 'void';

COMMENT ON INDEX honour_team_linked_player_uq IS
  'One ACTIVE row per stable player identity in an honour team; same-display-name players remain distinct (migration 059), and a voided row no longer holds its team place.';

COMMENT ON INDEX honour_team_unlinked_name_uq IS
  'Name-based duplicate protection for ACTIVE rows that do not yet have a stable player identity; a voided row no longer holds its team place.';


-- ---------------------------------------------------------------------
-- 4. data_overrides.entity_type
-- ---------------------------------------------------------------------
-- Every existing literal is retained verbatim; nothing is weakened. The
-- three settle targets migration 073's narrowness proves unrepresentable
-- (match_period_scores, player_match_stats, brownlow_round_votes) are
-- still absent and must stay absent: src/lib/acquisition/manual-authority.ts
-- reads this constraint live and refuses to APPLY those targets if any of
-- them ever appears here. That proof is order-independent about entities
-- which are NOT settle targets (AFLDB-ISSUE-159 §3.1, D-1), and none of
-- these three is one -- the nightly settle writes matches and statistics
-- and neither reads nor writes an award, an induction or an honour team
-- -- so this widening is safe to deploy before or after the code.
--
-- THREE FIELD GROUPS, one per kind of decision, because the three have
-- genuinely different replay semantics (AFLDB-ISSUE-165 §6.2, D-9):
--
--   'lifecycle'   status + status_reason + replacement linkage, for a row
--                 of either ownership. UNCONDITIONALLY re-applied. If the
--                 target row is absent the replay WARNS AND RETAINS the
--                 override: a source manifest that stopped carrying a row
--                 is not a reason to silently discard the human decision
--                 that the row was wrong (D-9).
--
--   'correction'  a DELTA over a SOURCE-OWNED row's safely-correctable
--                 metadata. Key presence is the semantics, the migration
--                 086 discipline: an absent key leaves the source value,
--                 an explicit JSON null clears it. A correction whose
--                 target row is absent FAILS CLOSED (D-9) -- the reload
--                 stops rather than silently reverting a human decision.
--
--   'record'      the whole durable row of a MANUAL (manual_admin_edit)
--                 creation, which a destructive rebuild removes entirely.
--                 The replay re-creates the row and then restores the
--                 payload. A record override that cannot be reconstructed
--                 or resolved FAILS CLOSED (D-9).
--
-- entity_key is the row's DURABLE NATURAL identity, never its id -- ids
-- are renumbered by a rebuild and by a promotion, and
-- promotion-inventory.ts has said so about these exact tables since
-- AFLDB-ISSUE-151 (player_link_resolutions.target_id, "no stable
-- identity exists for an honours row"). The shapes are:
--
--   award_winners        '<sources.key>:<source_record_id>'
--   hall_of_fame         '<sources.key>:<name>|<inducted_year>'
--   honour_team_members  '<sources.key>:<team_name>|<player identity>'
--
-- where <player identity> is an AFL Tables profile identity
-- ('afltables:players/...') or a manual token for a LINKED row, and
-- 'name:<player_name_raw>' for an unlinked one -- the same convention
-- every other replay branch resolves. Everything before the FIRST colon
-- is the source key; for hall_of_fame the LAST '|' separates the name
-- from the induction year (a year never contains one); for
-- honour_team_members the FIRST '|' separates the team from the player
-- identity (a team name never contains one, and the writer refuses one
-- that does).
--
-- is_active is ALWAYS true for all three groups. The lifecycle lives in
-- the payload's status, because a VOIDED row must be RE-CREATED by the
-- replay and then voided again, not suppressed by it: suppressing it
-- would delete the row whose data_edits rows must stay resolvable. There
-- is no DELETE here and therefore no tombstone (the AFLDB-ISSUE-162 /
-- -163 shape, not AFLDB-ISSUE-161's).
ALTER TABLE data_overrides
  DROP CONSTRAINT data_overrides_entity_type_check,
  ADD CONSTRAINT data_overrides_entity_type_check CHECK (entity_type IN (
    'players',
    'matches',
    'draft_picks',
    'coaches',
    'match_coaches',
    'season_list_members',
    'fixtures',
    'club_leadership',
    'award_winners',
    'hall_of_fame',
    'honour_team_members'
  ));

COMMENT ON CONSTRAINT data_overrides_entity_type_check ON data_overrides IS
  'Entities whose durable human decisions destructive reloads replay. A settle target must never be admitted here: src/lib/acquisition/manual-authority.ts proves from this constraint that an override for match_period_scores, player_match_stats or brownlow_round_votes is unrepresentable, and admitting one degrades the nightly settle from apply to propose-only.';
