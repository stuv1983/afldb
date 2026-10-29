LOCK TABLE public.data_edits IN SHARE ROW EXCLUSIVE MODE;
-- Exactly the snapshot relation inventory. Lock before the SERIALIZABLE snapshot's
-- first data read, and refuse rather than wait on concurrent ordinary activity.
DO $locks$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY[
 'public.data_overrides','public.matches','public.player_match_stats','public.match_period_scores',
 'public.player_match_period_stats','public.player_career_stats','public.player_season_stats',
 'public.player_club_season_stats','public.player_clubs','public.players','public.clubs',
 'public.club_seasons','public.seasons','public.import_batches','public.import_rejections',
 'public.canonical_applications','public.brownlow_season_votes','public.brownlow_round_votes',
 'public.brownlow_vote_entry_state','public.brownlow_season_authority','public.auth_audit_log',
 'staging.afltables_player_match','staging.afltables_match','staging.afl_api_lineup','staging.afl_api_brownlow_vote'] LOOP
   EXECUTE format('LOCK TABLE %s IN SHARE MODE',relation::regclass);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['public.brownlow_eligibility_decisions','public.brownlow_correction_receipts'] LOOP
   IF to_regclass(relation) IS NOT NULL THEN EXECUTE format('LOCK TABLE %s IN SHARE MODE',relation::regclass); END IF;
 END LOOP;
END $locks$;
