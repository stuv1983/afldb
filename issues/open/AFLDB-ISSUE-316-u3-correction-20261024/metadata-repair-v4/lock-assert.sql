-- First runs after every plain LOCK statement and production identity.
DO $held$
DECLARE relname text; expected_mode text;
        required text[] := ARRAY['public.data_edits','public.auth_users','public.data_overrides','public.matches','public.player_match_stats','public.match_period_scores','public.player_match_period_stats','public.player_career_stats','public.player_season_stats','public.player_club_season_stats','public.player_clubs','public.players','public.clubs','public.club_seasons','public.seasons','public.import_batches','public.import_rejections','public.canonical_applications','public.brownlow_season_votes','public.brownlow_round_votes','public.brownlow_vote_entry_state','public.brownlow_season_authority','public.auth_audit_log','staging.afltables_player_match','staging.afltables_match','staging.afl_api_lineup','staging.afl_api_brownlow_vote','afldb_meta.schema_migrations'];
BEGIN
 FOREACH relname IN ARRAY required || ARRAY['public.brownlow_eligibility_decisions','public.brownlow_correction_receipts'] LOOP
  IF to_regclass(relname) IS NULL THEN
   IF relname=ANY(required) THEN RAISE EXCEPTION 'I316 required lock relation absent %',relname; END IF;
  ELSE
   expected_mode := CASE WHEN relname='public.data_edits' THEN 'ShareRowExclusiveLock' ELSE 'ShareLock' END;
   IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE pid=pg_backend_pid() AND locktype='relation'
     AND relation=to_regclass(relname) AND mode=expected_mode AND granted)
   THEN RAISE EXCEPTION 'I316 complete protected lock set not held %',relname; END IF;
  END IF;
 END LOOP;
END $held$;
