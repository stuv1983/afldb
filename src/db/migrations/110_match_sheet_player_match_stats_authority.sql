-- ---------------------------------------------------------------------
-- 110 — data_overrides admits player_match_stats (AFLDB-ISSUE-257)
-- ---------------------------------------------------------------------
-- A Data Editor Match Sheet correction to player_match_stats is a durable
-- administrative decision (D-257-0). The Match Sheet writer records it in
-- data_overrides under entity_type 'player_match_stats', keyed
-- '<matches.match_key>|<player identity>' (runbook §18.3), with field
-- groups 'match_sheet' (a field delta) and 'lineup' ({"present": bool},
-- an addition or a removal). The settles answer it from rows, the fitzRoy
-- stats reload and the promotion replay re-apply it, and Return to source
-- withdraws it (is_active = false).
--
-- Every existing literal migration 102 left is retained verbatim; exactly
-- one literal is added. The two remaining settle targets migration 073's
-- narrowness proves unrepresentable (match_period_scores,
-- brownlow_round_votes) stay absent and must stay absent:
-- src/lib/acquisition/manual-authority.ts reads this constraint live and
-- refuses to APPLY either target if it ever appears here.
--
-- DEPLOY ORDER (runbook §18.13; mandatory). The application that
-- understands player_match_stats authority MUST be live BEFORE this
-- migration. An older application treats player_match_stats as
-- unrepresentable: with this CHECK applied its proof fails and the nightly
-- settle refuses all three settle targets (match_period_scores,
-- player_match_stats, brownlow_round_votes). The new application is safe
-- under either CHECK (State A without this migration, State B with it).
--
-- ROLLBACK (D-257-7). Re-adding migration 102's narrow CHECK validates the
-- existing rows, so it fails while ANY player_match_stats row exists,
-- active or not. Before the first such record, rollback may restore the
-- old CHECK and then the old application. Once one exists, the old
-- application is not a supported rollback target: roll forward only. The
-- read-only guard tools/db/issue257-rollback-guard.ts runs that count and
-- refuses; docs/deployment.md §11 and docs/production-promotion.md §10
-- require it before any rollback.
--
-- PRIVILEGES. None change. afldb_import already holds SELECT, INSERT and
-- column UPDATE (override_values, admin_user_id, is_active, updated_at) on
-- data_overrides (migrations 073 / 078; tools/maintenance/privileges.sql),
-- which is every column the Match Sheet writer, Return to source and the
-- rekey carry write. No DELETE is granted or needed.
-- ---------------------------------------------------------------------

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
    'after_siren_kicks',
    'player_match_stats'
  ));

COMMENT ON CONSTRAINT data_overrides_entity_type_check ON data_overrides IS
  'Entities whose durable human decisions destructive reloads replay. player_match_stats is admitted by migration 110 (AFLDB-ISSUE-257): its Match Sheet authority is answered from rows by the settles. The other two settle targets must never be admitted here: src/lib/acquisition/manual-authority.ts proves from this constraint that an override for match_period_scores or brownlow_round_votes is unrepresentable, and admitting either degrades the nightly settle from apply to propose-only. Once any player_match_stats row exists, rollback below migration 110 is unsupported (roll forward only).';
