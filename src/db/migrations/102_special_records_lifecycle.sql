-- =====================================================================
-- 102 - Special records: the correction / void / suppression lifecycle
-- =====================================================================
-- AFLDB-ISSUE-167 (AFLDB-ISSUE-156 P4) Stage 2. Forward-only. Additive.
--
-- Two curated special-record families exist and neither can be corrected,
-- voided or suppressed by anything in AFLDB:
--
--   player_achievements  (migration 053) - first-kick goal, loaded by
--                        tools/records/import-first-kick-goal.ts;
--   after_siren_kicks    (migration 089) - kicks after the siren, loaded
--                        by tools/migration/after_siren.py.
--
-- Both are curated external facts with a tracked source manifest, and a
-- wrong row today can only be repaired by editing the manifest and
-- reloading. AFLDB-ISSUE-155 Phase E (§12) requires instead that a
-- "delete" be a SUPPRESSION the next curated reload cannot undo, and
-- that a manual addition survive a full supported reload.
--
-- This migration adds the smallest schema that lifecycle needs, and
-- nothing else:
--
--   1. status / status_reason / updated_at on each of the two tables;
--   2. both table names admitted as data_overrides entity types, so the
--      durable decision survives a destructive rebuild and a promotion;
--   3. both table names admitted as data_edits table names, so the
--      mutation is auditable at all.
--
-- THE TWO LAYERS AND WHY BOTH EXIST (AFLDB-ISSUE-167 §5.1).
--
--   status/status_reason on the canonical row survive an ORDINARY scoped
--   reload for free, because neither importer writes them. Proven at
--   AFLDB-ISSUE-167 gate G-8 against current source rather than assumed:
--   import-first-kick-goal.ts's INSERT names 21 columns and its UPDATE
--   names 18, and none of the three appears in either list; after_siren.py
--   reloads through common.py's reload_keyed(), whose UPDATE assigns only
--   the columns its caller lists. That is the same free protection
--   award_winners.sort_order (migration 061) already relies on.
--
--   They do NOT survive a FULL REBUILD. Both tables carry
--   player_id REFERENCES players(id), so a TRUNCATE ... CASCADE on
--   players empties both and the row is gone, and with it every column on
--   it. So the DURABLE record is a data_overrides row replayed by the
--   owning importer, exactly as AFLDB-ISSUE-159/160/161/162/163/165
--   established for coaches, players, season lists, fixtures, club
--   leadership and the honours tables; the columns here are the cheap
--   read-path cache of that decision, re-asserted by the replay.
--
-- TWO STATES, NOT THREE. status IN ('active','void'), the migration 101
-- vocabulary rather than club_leadership's, because a first-kick goal and
-- a kick after the siren are events: neither CEASES the way an office
-- does. A wrong one is void and a right one is active, and voiding is
-- never a DELETE -- the row is kept so its data_edits rows stay
-- resolvable through this issue's lineage identities at the next
-- promotion remap.
--
-- after_siren_kicks.cited IS NOT LIFECYCLE, and this migration does not
-- touch it (AFLDB-ISSUE-167 gate G-3). Migration 089 defines it as
-- "false when the source row carried no reference; recorded as an
-- evidence gap, not dropped" -- a fact about the EVIDENCE for a kick that
-- really happened. 'void' says the AFLDB ROW was entered in error and
-- never should have existed. Conflating them would suppress every
-- uncited kick from the public record, which is the opposite of what 089
-- decided when it kept them. No read path filters on cited today, none
-- may acquire one as part of this issue, and the two must never share a
-- control in the admin UI.
--
-- NO SPECULATIVE INDEXES (AFLDB-ISSUE-165 D-8, carried forward by
-- AFLDB-ISSUE-167 §6.1). Every existing row is 'active' -- 334 in
-- player_achievements and 126 in after_siren_kicks, measured on
-- afldb_test 2026-09-13 -- so a partial index WHERE status = 'active'
-- would today cover the whole table and buy nothing the existing
-- access-path indexes do not already provide. An index is added when a
-- measured plan asks for one.
--
-- NO created_at, for the same reason 101 refused one: nothing reads a
-- creation instant, and the data_edits audit row already carries when a
-- row was made and by whom. A column whose only value for 460 existing
-- rows would be "whenever this migration happened to run" invents
-- evidence.
--
-- SOURCE UNIQUENESS IS DELIBERATELY UNCHANGED. Neither
-- player_achievements_source_uq nor after_siren_kicks_source_uq is a
-- lifecycle key: a voided row keeps its source record id, and a
-- replacement is always a new manual_admin_edit row whose minted uuid
-- cannot collide with it by construction. Unlike migration 101, no
-- ACTIVE-ROW-ONLY uniqueness is needed here, because neither table has a
-- natural-key uniqueness rule a replacement could collide with -- their
-- only uniqueness IS the source key, and a manual replacement never
-- reuses it.
--
-- NO NEW TABLE. AFLDB-ISSUE-155 §12 is explicit: "use the existing
-- player_achievements family; do not add a parallel records table". The
-- suppress operation rides on the existing data_overrides schema via
-- field_group, which needs no new column and no new operation column.
--
-- NO PRIVILEGE CHANGE, and this is a recorded operator decision (D-5,
-- AFLDB-ISSUE-167 §19 / §21.6, 2026-09-13) rather than an omission.
-- Both tables already carry grant_app_read() and grant_import_write()
-- (053:151-152, 089:159-160), so the catalogue-derived registries
-- afldb_meta.app_readable_tables and afldb_meta.import_writable_tables
-- already name them and tools/maintenance/privileges.sql already
-- reconciles them; the grants are table-level, so three new columns need
-- nothing further. afldb_auth is deliberately NOT granted SELECT on
-- either table: the admin surface reads football tables on the APP pool
-- and writes them on a short-lived afldb_import transaction
-- (src/db/queries/admin-awards.ts:274, admin-club-leadership.ts:336,
-- src/db/queries/player-links.ts:86-88 -- "Reads run on the public
-- client"), and src/db/authClient.ts holds afldb_auth to the operational
-- tables precisely so that "a compromise of the auth path still cannot
-- touch statistics". Granting afldb_auth SELECT here would widen that
-- boundary with no caller, so D-5 leaves privileges.sql alone; the whole
-- contract, afldb_auth's absence included, is pinned by
-- tests/integration/special-records-lifecycle.test.ts. See §21.6.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. player_achievements
-- ---------------------------------------------------------------------
-- Identity here is the SOURCE RECORD -- player_achievements_source_uq
-- UNIQUE NULLS NOT DISTINCT (source_id, source_record_id) -- and since
-- the AFLDB-ISSUE-078 rekey every row carries a tracked, committed
-- 'fkg-NNN' from data/records/first-kick-goal-ids.csv. Measured on
-- afldb_test 2026-09-13: 334 of 334 rows carry a source_record_id and 0
-- fall outside '^fkg-[0-9]{3,}$'.
--
-- NOTE ON A NAME COLLISION, so the next reader is not caught by it:
-- this table already has link_status_value, and
-- tools/records/import-first-kick-goal.ts aliases it to `status` in its
-- OwnedRow type. That alias is TypeScript-local and predates this
-- column; the two are unrelated, and the importer writes neither the
-- alias nor this column into the lifecycle columns.
ALTER TABLE player_achievements
  ADD COLUMN status        text        NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason text,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT player_achievements_status_ck
    CHECK (status IN ('active', 'void')),
  ADD CONSTRAINT player_achievements_void_reason_ck
    CHECK (status <> 'void' OR status_reason IS NOT NULL);

COMMENT ON COLUMN player_achievements.status IS
  'active | void. ''void'' = this row was recorded in error and never represented a real achievement; it is kept, never deleted, so its data_edits rows stay resolvable at the next promotion lineage remap, and it is excluded from every public projection and from the admin player-link queue. Never a DELETE, and never a way to record that an achievement was later reassessed — that would be a fact about the record, not about the row.';
COMMENT ON COLUMN player_achievements.status_reason IS
  'Why this row was voided, mandatory whenever status = ''void'' (player_achievements_void_reason_ck). Leaving a void unexplained loses the only thing separating a data-entry error from an achievement that really happened.';
COMMENT ON COLUMN player_achievements.updated_at IS
  'Last administrative mutation. The compare-and-swap column for the optimistic-concurrency contract the AFLDB-ISSUE-167 admin surface uses: a mutation carrying a stale expectedUpdatedAt refuses without writing anything. The importer does NOT maintain it — tools/records/import-first-kick-goal.ts writes only the columns its INSERT and UPDATE name, and this is deliberately not one of them.';


-- ---------------------------------------------------------------------
-- 2. after_siren_kicks
-- ---------------------------------------------------------------------
-- Identity here is the same shape -- after_siren_kicks_source_uq
-- UNIQUE NULLS NOT DISTINCT (source_id, source_record_id) -- carrying the
-- artefact's own event_key. Measured on afldb_test 2026-09-13: 126 of 126
-- rows carry a source_record_id. There is deliberately no pattern
-- assertion for it: an event_key has no fixed regular shape, and its
-- identity guarantee is `with_key = rows` plus the UNIQUE constraint.
ALTER TABLE after_siren_kicks
  ADD COLUMN status        text        NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason text,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT after_siren_kicks_status_ck
    CHECK (status IN ('active', 'void')),
  ADD CONSTRAINT after_siren_kicks_void_reason_ck
    CHECK (status <> 'void' OR status_reason IS NOT NULL);

COMMENT ON COLUMN after_siren_kicks.status IS
  'active | void. ''void'' = this row was recorded in error and never represented a real kick after the siren; it is kept, never deleted, so its data_edits rows stay resolvable at the next promotion lineage remap, and it is excluded from every public projection. Distinct from `cited`, which records whether the SOURCE carried a reference for a kick that did happen (migration 089) — an uncited kick is evidence-thin, not retracted, and the two must never be conflated.';
COMMENT ON COLUMN after_siren_kicks.status_reason IS
  'Why this row was voided, mandatory whenever status = ''void'' (after_siren_kicks_void_reason_ck). Leaving a void unexplained loses the only thing separating a data-entry error from a kick that really happened.';
COMMENT ON COLUMN after_siren_kicks.updated_at IS
  'Last administrative mutation. The compare-and-swap column for the optimistic-concurrency contract the AFLDB-ISSUE-167 admin surface uses: a mutation carrying a stale expectedUpdatedAt refuses without writing anything. The importer does NOT maintain it — tools/migration/after_siren.py reloads through common.py''s reload_keyed(), whose UPDATE assigns only the columns its caller lists, and this is deliberately not one of them.';


-- ---------------------------------------------------------------------
-- 3. data_overrides.entity_type
-- ---------------------------------------------------------------------
-- Every existing literal is retained verbatim; nothing is weakened. The
-- three settle targets migration 073's narrowness proves unrepresentable
-- (match_period_scores, player_match_stats, brownlow_round_votes) are
-- still absent and must stay absent: src/lib/acquisition/manual-authority.ts
-- reads this constraint live and refuses to APPLY those targets if any of
-- them ever appears here.
--
-- ORDER-INDEPENDENCE, re-proven at AFLDB-ISSUE-167 gate G-4 by reading
-- manual-authority.ts directly rather than trusting 101's comment. The
-- proof is overrideScopeProvenFrom(), whose four conditions are: the live
-- CHECK is readable and unambiguous; no UNREPRESENTABLE_OVERRIDE_ENTITY is
-- among its literals; no UNREPRESENTABLE_OVERRIDE_ENTITY is an editor
-- entity; and every editor entity is admitted by the CHECK. Widening the
-- CHECK with an entity that is not a settle target satisfies all four in
-- either deploy order -- condition 4 only ever gets easier as the CHECK
-- grows. Neither table here is a settle target: the nightly settle writes
-- matches and statistics and touches neither a first-kick achievement nor
-- an after-siren event. So this widening is safe to deploy before or
-- after the code.
--
-- THREE FIELD GROUPS, the migration 101 vocabulary unchanged, because the
-- three replay semantics are genuinely different (AFLDB-ISSUE-167 §5.2):
--
--   'lifecycle'   status + status_reason + replacement linkage, for a row
--                 of either ownership. UNCONDITIONALLY re-applied. If the
--                 target row is absent the replay WARNS AND RETAINS the
--                 override: a source manifest that stopped carrying a row
--                 is not a reason to silently discard the human decision
--                 that the row was wrong.
--
--   'correction'  a DELTA over a SOURCE-OWNED row's safely-correctable
--                 metadata. Key presence is the semantics, the migration
--                 086 discipline: an absent key leaves the source value,
--                 an explicit JSON null clears it. A correction whose
--                 target row is absent FAILS CLOSED -- the reload stops
--                 rather than silently reverting a human decision.
--
--   'record'      the whole durable row of a MANUAL (manual_admin_edit)
--                 creation, which a destructive rebuild removes entirely.
--                 The replay re-creates the row and then restores the
--                 payload. A record override that cannot be reconstructed
--                 or resolved FAILS CLOSED.
--
-- entity_key is the row's DURABLE NATURAL identity, never its id -- ids
-- are renumbered by a rebuild and by a promotion. Both families reduce to
-- the same shape, because unlike hall_of_fame and honour_team_members
-- both already carry a real tracked source record id on every row:
--
--   player_achievements  '<sources.key>:<source_record_id>'
--                        e.g. 'wikipedia_first_kick_goal:fkg-042'
--   after_siren_kicks    '<sources.key>:<source_record_id>'
--
-- Everything before the FIRST colon is the source key. That grammar is
-- admissible as measured, not merely as designed: on afldb_test
-- 2026-09-13 no source_record_id in either table contains a colon, in
-- 460 rows. The writer refuses a colon-bearing source_record_id as a
-- forward guard.
--
-- is_active is ALWAYS true for all three groups. The lifecycle lives in
-- the payload's status, because a VOIDED row must be RE-CREATED by the
-- replay and then voided again, not suppressed by it: suppressing it
-- would delete the row whose data_edits rows must stay resolvable. There
-- is no DELETE here and therefore no tombstone (the AFLDB-ISSUE-162 /
-- -163 / -165 shape, not AFLDB-ISSUE-161's).
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
    'honour_team_members',
    'player_achievements',
    'after_siren_kicks'
  ));

COMMENT ON CONSTRAINT data_overrides_entity_type_check ON data_overrides IS
  'Entities whose durable human decisions destructive reloads replay. A settle target must never be admitted here: src/lib/acquisition/manual-authority.ts proves from this constraint that an override for match_period_scores, player_match_stats or brownlow_round_votes is unrepresentable, and admitting one degrades the nightly settle from apply to propose-only.';


-- ---------------------------------------------------------------------
-- 4. data_edits.table_name
-- ---------------------------------------------------------------------
-- Every existing literal is retained verbatim. Unlike migration 101 --
-- whose three tables migration 058 had already admitted -- neither table
-- here is admitted today, so without this widening the AFLDB-ISSUE-027
-- contract is unsatisfiable for both families: the canonical mutation and
-- its data_edits row commit in ONE transaction, so a refused audit insert
-- refuses the mutation, and every special-record edit would fail closed.
-- Read live from afldb_test 2026-09-13 as the eleven literals below,
-- which is also the eleven migration 098 left.
--
-- Purely additive: it admits two more names and refuses none, so unlike
-- the data_overrides CHECK it carries no fail-closed introspection hazard
-- in either deploy order. Nothing reads this constraint to prove a
-- negative -- manual-authority.ts deliberately does not consult
-- data_edits at all, because afldb_import holds INSERT and no SELECT on
-- it (AFLDB-ISSUE-096 §7: evidence, not authority).
--
-- AND IT OBLIGES A LINEAGE TARGET. Admitting a table here creates audit
-- rows whose row_id is an integer in a table a promotion RENUMBERS, and
-- four times that obligation has been missed and found later --
-- draft_picks (057, found by AFLDB-ISSUE-160 D-3) and the three honours
-- tables (058, found by AFLDB-ISSUE-165). Both names are therefore given
-- lineage targets in tools/db/promotion-inventory.ts in this same change,
-- resolved through the durable identity '<sources.key>|<source_record_id>'
-- rather than the renumbered integer, and
-- tests/db-promotion-check.test.ts enforces that pairing by reading this
-- allowlist out of the migrations.
ALTER TABLE data_edits
  DROP CONSTRAINT data_edits_table_name_check,
  ADD CONSTRAINT data_edits_table_name_check CHECK (table_name IN (
    'players',
    'matches',
    'draft_picks',
    'award_winners',
    'hall_of_fame',
    'honour_team_members',
    'brownlow_vote_entry_state',
    'brownlow_season_authority',
    'coaches',
    'fixtures',
    'club_leadership',
    'player_achievements',
    'after_siren_kicks'
  ));

COMMENT ON CONSTRAINT data_edits_table_name_check ON data_edits IS
  'Allowlisted entities whose manual mutations are recorded in this append-only audit log. match_coaches is absent by design: its primary key is composite, so a coaching-assignment edit is audited against its match (table_name = ''matches'', field_group = ''coach_assignment''). season_list_members is absent by the same reasoning applied to deletability: a membership is audited against its player. fixtures, club_leadership, player_achievements and after_siren_kicks ARE here because none of them is ever deleted, so their ids always resolve — through fixture_key, appointment_key, first_kick_goal_key and after_siren_key at a lineage remap.';
