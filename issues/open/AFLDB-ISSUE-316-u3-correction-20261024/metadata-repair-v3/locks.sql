-- Plain LOCK utilities only: no DO, SELECT, regclass expression or catalog query.
-- Catalog locks also prevent creating an absent optional relation or renaming its schema.
LOCK TABLE pg_catalog.pg_class, pg_catalog.pg_namespace IN SHARE MODE;
LOCK TABLE public.data_edits IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.auth_users IN SHARE MODE;
LOCK TABLE public.data_overrides IN SHARE MODE;
LOCK TABLE public.matches IN SHARE MODE;
LOCK TABLE public.player_match_stats IN SHARE MODE;
LOCK TABLE public.match_period_scores IN SHARE MODE;
LOCK TABLE public.player_match_period_stats IN SHARE MODE;
LOCK TABLE public.player_career_stats IN SHARE MODE;
LOCK TABLE public.player_season_stats IN SHARE MODE;
LOCK TABLE public.player_club_season_stats IN SHARE MODE;
LOCK TABLE public.player_clubs IN SHARE MODE;
LOCK TABLE public.players IN SHARE MODE;
LOCK TABLE public.clubs IN SHARE MODE;
LOCK TABLE public.club_seasons IN SHARE MODE;
LOCK TABLE public.seasons IN SHARE MODE;
LOCK TABLE public.import_batches IN SHARE MODE;
LOCK TABLE public.import_rejections IN SHARE MODE;
LOCK TABLE public.canonical_applications IN SHARE MODE;
LOCK TABLE public.brownlow_season_votes IN SHARE MODE;
LOCK TABLE public.brownlow_round_votes IN SHARE MODE;
LOCK TABLE public.brownlow_vote_entry_state IN SHARE MODE;
LOCK TABLE public.brownlow_season_authority IN SHARE MODE;
LOCK TABLE public.auth_audit_log IN SHARE MODE;
LOCK TABLE staging.afltables_player_match IN SHARE MODE;
LOCK TABLE staging.afltables_match IN SHARE MODE;
LOCK TABLE staging.afl_api_lineup IN SHARE MODE;
LOCK TABLE staging.afl_api_brownlow_vote IN SHARE MODE;
\if :i316_optional_0
LOCK TABLE public.brownlow_eligibility_decisions IN SHARE MODE;
\endif
\if :i316_optional_1
LOCK TABLE public.brownlow_correction_receipts IN SHARE MODE;
\endif
