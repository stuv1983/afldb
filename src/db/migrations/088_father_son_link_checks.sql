-- =====================================================================
-- AFLDB 088 — Father–son selections: a link must be evidenced (AFLDB-ISSUE-118 §23.29)
-- =====================================================================
-- father_son_selections (migration 006) carries two independent person
-- links — the drafted son and the qualifying father — each with its own
-- link_status, and nothing has populated it until now. The first loader,
-- tools/migration/father_son.py, resolves both people ONLY through the AFL
-- Tables profile path external_identities holds (never a name), and this
-- migration makes the table itself refuse the failure mode draft_persons
-- (019) already refuses: a trusted status with no player, or a player
-- carried under an untrusted status.
--
-- The table is empty on every environment, so the constraints are added
-- without a data check. player_relationships (006), which the same loader
-- populates with one parent_child row per selection, has no status column
-- — either side may be unlinked by design (many relatives never played) —
-- so it needs nothing here. Both tables are already in the read and write
-- registries (039 / 045 seeded them), so no grant call is needed.
-- =====================================================================

ALTER TABLE father_son_selections
  ADD CONSTRAINT father_son_selections_drafted_link_ck CHECK (
    (drafted_link_status IN ('unique', 'resolved') AND drafted_player_id IS NOT NULL)
    OR (drafted_link_status IN ('ambiguous', 'unmatched', 'implausible') AND drafted_player_id IS NULL)
  );

ALTER TABLE father_son_selections
  ADD CONSTRAINT father_son_selections_father_link_ck CHECK (
    (father_link_status IN ('unique', 'resolved') AND father_player_id IS NOT NULL)
    OR (father_link_status IN ('ambiguous', 'unmatched', 'implausible') AND father_player_id IS NULL)
  );

-- A son is selected under the rule once; a father can qualify several sons
-- (David Cloke three, Peter Daicos two). The pair, not the person, is unique.
ALTER TABLE father_son_selections
  ADD CONSTRAINT father_son_selections_pair_uq
  UNIQUE NULLS NOT DISTINCT (father_player_id, drafted_player_id, draft_year, drafted_player_name);

COMMENT ON CONSTRAINT father_son_selections_drafted_link_ck ON father_son_selections IS
  'A trusted status must carry a player and an untrusted one must not (the draft_persons rule).';
COMMENT ON CONSTRAINT father_son_selections_father_link_ck ON father_son_selections IS
  'A trusted status must carry a player and an untrusted one must not (the draft_persons rule).';
COMMENT ON COLUMN father_son_selections.competition IS
  'national | rookie | pre-draft — how the selection was made: a national-draft pick, a rookie-draft pick, or a pre-draft selection with no pick number (all selections before 1997, and later pre-listings).';
COMMENT ON COLUMN father_son_selections.selection_note IS
  'The loader''s resolution notes and the source''s own club-grain games figures; evidence, never a statistic.';
