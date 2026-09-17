-- =====================================================================
-- 095 - Coach administration: override scope, audit scope, manual namespace
-- =====================================================================
-- AFLDB-ISSUE-159 (AFLDB-ISSUE-156 P3) Stage 1. Forward-only.
--
-- No new table, no new column, no NOT NULL relaxed, no backfill, and no
-- change to migration 087. This migration does exactly three things:
--
--   1. admits 'coaches' and 'match_coaches' as data_overrides entity types,
--      so a human decision about a coach or a coaching assignment has a
--      durable record that destructive reloads replay (073/078, §5.1);
--   2. admits 'coaches' -- and ONLY 'coaches' -- as a data_edits table_name,
--      so a coach mutation is audited in the same transaction as the write
--      (057/058/094, §5.2);
--   3. makes the manual coach identity namespace a database guarantee
--      rather than a convention (§5.3).
--
-- Why a manual coach needs a namespace at all
-- -------------------------------------------
-- coaches.afltables_coach_path is NOT NULL UNIQUE and coaches.name_key is
-- NOT NULL UNIQUE (087:38,41). An admin-created coach is a person AFL
-- Tables does not publish a page for, so it has no path and no index
-- string -- but it cannot have NULL for either, and it must not be given a
-- name-derived one:
--
--   * data_edits.row_id is lineage-bound (tools/db/promotion-inventory.ts),
--     so every coach a human edits must carry a stable text identity that
--     exists on BOTH databases across a rebuild. name_key is a name, and a
--     name-derived identity is forbidden outright -- two footballers share a
--     name often enough that it would silently retarget a human decision.
--   * the importer's coach upsert conflicts on afltables_coach_path ALONE
--     (import_match_coaches.py). A manual row holding the real
--     "Surname, Given" string would therefore violate coaches_name_key_key
--     -- a unique violation on a NON-target constraint, which is not an
--     upsert: it aborts the whole nightly batch -- the first time AFL
--     Tables publishes a page for that person.
--
-- So a manual coach carries a synthetic permanent identity minted once at
-- creation and never derived from a name:
--
--   afltables_coach_path = 'manual:' || <opaque permanent token>
--   name_key             = 'manual:' || <the same token>
--   source_id            = sources.id WHERE key = 'manual_admin_edit' (057)
--
-- Every AFL Tables path begins 'coaches/' and every AFL Tables name_key is
-- a "Surname, Given" string, so the two namespaces cannot collide. The
-- CHECKs below make that structural instead of conventional.
--
-- What this migration deliberately does NOT do
-- --------------------------------------------
--   * it does not widen coaches_link_ck (AFLDB-ISSUE-159 D-3);
--   * it does not add superseded_by or any merge/delete path: a manual
--     coach that later gains an AFL Tables identity is P9-class identity
--     lifecycle work, reported and stopped (§13). Stage 1 delivers
--     duplicate PREVENTION only;
--   * it does not admit 'match_coaches' into data_edits.table_name -- see
--     the note on that constraint below;
--   * it changes no privilege: both tables are registry-driven through
--     grant_app_read / grant_import_write (087:112-115), and the import
--     role's narrow data_overrides column grants are already migration 078.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. data_overrides.entity_type
-- ---------------------------------------------------------------------
-- Every existing literal is retained verbatim; nothing is weakened. The
-- three settle targets migration 073's narrowness proves unrepresentable
-- (match_period_scores, player_match_stats, brownlow_round_votes) are
-- still absent, and must stay absent: src/lib/acquisition/manual-authority.ts
-- reads this constraint live and refuses to APPLY those targets if any of
-- them ever appears here. That proof is order-independent about entities
-- which are NOT settle targets (AFLDB-ISSUE-159 §3.1, D-1), which is what
-- makes this widening safe to deploy before or after the code.
ALTER TABLE data_overrides
  DROP CONSTRAINT data_overrides_entity_type_check,
  ADD CONSTRAINT data_overrides_entity_type_check CHECK (entity_type IN (
    'players',
    'matches',
    'draft_picks',
    'coaches',
    'match_coaches'
  ));

COMMENT ON CONSTRAINT data_overrides_entity_type_check ON data_overrides IS
  'Entities whose durable human decisions destructive reloads replay. A settle target must never be admitted here: src/lib/acquisition/manual-authority.ts proves from this constraint that an override for match_period_scores, player_match_stats or brownlow_round_votes is unrepresentable, and admitting one degrades the nightly settle from apply to propose-only.';


-- ---------------------------------------------------------------------
-- 2. data_edits.table_name
-- ---------------------------------------------------------------------
-- 'coaches' only. Every existing entry is retained verbatim.
--
-- 'match_coaches' is deliberately ABSENT. data_edits.row_id is a single
-- bigint (057:18) and match_coaches has the composite primary key
-- (match_id, club_id) (087:86), so it has no row id to audit against. A
-- coaching-assignment change is audited as a property of the match:
--
--   table_name  = 'matches'      (already allowlisted, already lineage-
--   row_id      = matches.id      remappable by match_key, already rendered
--   field_group = 'coach_assignment'   by /admin/audit/entity/matches/<id>)
--
-- That removes an allowlist entry, a lineage target and a whole class of
-- promotion work from this phase without losing a single audited fact.
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
    'coaches'
  ));

COMMENT ON CONSTRAINT data_edits_table_name_check ON data_edits IS
  'Allowlisted statistical entities whose manual mutations are recorded in this append-only audit log. match_coaches is absent by design: its primary key is composite, so a coaching-assignment edit is audited against its match (table_name = ''matches'', field_group = ''coach_assignment'').';


-- ---------------------------------------------------------------------
-- 3. The manual coach identity namespace, enforced
-- ---------------------------------------------------------------------
-- Pre-checked on afldb_test before this migration was written: 386 coach
-- rows, 0 whose path is not 'coaches/%', 0 whose name_key is already in the
-- manual namespace. Both ALTERs therefore validate against existing data.
ALTER TABLE coaches
  ADD CONSTRAINT coaches_path_namespace_ck
    CHECK (afltables_coach_path LIKE 'coaches/%' OR afltables_coach_path LIKE 'manual:%'),
  ADD CONSTRAINT coaches_manual_identity_ck
    CHECK ((afltables_coach_path LIKE 'manual:%') = (name_key LIKE 'manual:%'));

COMMENT ON CONSTRAINT coaches_path_namespace_ck ON coaches IS
  'A coach identity comes from exactly one of two namespaces: an AFL Tables coach page path (coaches/<Given>_<Surname><n>.html) or a minted manual identity (manual:<opaque permanent token>). Nothing else is an identity, so the two can never collide.';

COMMENT ON CONSTRAINT coaches_manual_identity_ck ON coaches IS
  'A row is manual in both identity columns or in neither. A half-namespaced row -- a manual path carrying a real "Surname, Given" name_key -- is exactly the shape that aborts the nightly coach import batch: the upsert conflicts on afltables_coach_path alone, so the real name_key raises a unique violation on a non-target constraint the moment AFL Tables publishes a page for that person.';

COMMENT ON COLUMN coaches.afltables_coach_path IS
  'The coach''s permanent identity, and the only one stable across a rebuild or a promotion. ''coaches/<Given>_<Surname><n>.html'' for a coach AFL Tables publishes; ''manual:<opaque permanent token>'' for an admin-created coach (AFLDB-ISSUE-159 §1). Minted once, never edited, and NEVER derived from a name: this is what data_edits.row_id and data_overrides.entity_key are remapped through when the id lineage changes.';

COMMENT ON COLUMN coaches.name_key IS
  'The exact "Surname, Given" string the fitzRoy per-match Coach column prints; unique across the AFL Tables index, so the column joins here by exact string and nowhere else. For an admin-created coach it is instead ''manual:<the same token as the path>'' (AFLDB-ISSUE-159 §1.3): a manual coach exists precisely because the source does not name them, so no snapshot Coach string can or should ever match it.';
