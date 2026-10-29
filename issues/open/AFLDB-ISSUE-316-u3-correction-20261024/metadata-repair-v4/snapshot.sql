-- Logical row fingerprints, not an eligibility/source census. Hash every column,
-- including NULLs and provenance. Ordered row hashes preserve multiplicity without
-- aggregating full historical JSON payloads into memory. Full Brownlow representations
-- and full protected tables are compared, including optional later-schema tables.
DO $snapshot$
DECLARE result jsonb := '{}'::jsonb; optional_schema jsonb := '{}'::jsonb; relation text; fingerprint jsonb; schema_state jsonb;
        required text[] := ARRAY[
 'public.data_overrides','public.matches','public.player_match_stats','public.match_period_scores',
 'public.player_match_period_stats','public.player_career_stats','public.player_season_stats',
 'public.player_club_season_stats','public.player_clubs','public.players','public.clubs',
 'public.club_seasons','public.seasons','public.import_batches','public.import_rejections',
 'public.canonical_applications','public.brownlow_season_votes','public.brownlow_round_votes',
 'public.brownlow_vote_entry_state','public.brownlow_season_authority','public.auth_audit_log',
 'staging.afltables_player_match','staging.afltables_match','staging.afl_api_lineup','staging.afl_api_brownlow_vote','afldb_meta.schema_migrations'];
BEGIN
 FOREACH relation IN ARRAY required || ARRAY['public.brownlow_eligibility_decisions','public.brownlow_correction_receipts'] LOOP
   IF NOT relation=ANY(required) THEN
     SELECT jsonb_build_object('present',true,'oid',c.oid,'namespace_oid',c.relnamespace,'kind',c.relkind,
       'relation',to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'],
       'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attnum)
         FROM pg_catalog.pg_attribute a WHERE attrelid=c.oid AND attnum>0),
       'defaults',(SELECT jsonb_agg(pg_get_expr(adbin,adrelid) ORDER BY adnum) FROM pg_catalog.pg_attrdef WHERE adrelid=c.oid),
       'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid) FROM pg_catalog.pg_index WHERE indrelid=c.oid),
       'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_catalog.pg_trigger WHERE tgrelid=c.oid),
       'rules',(SELECT jsonb_agg(pg_get_ruledef(oid) ORDER BY oid) FROM pg_catalog.pg_rewrite WHERE ev_class=c.oid),
       'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY oid) FROM pg_catalog.pg_constraint WHERE conrelid=c.oid))
       INTO schema_state FROM pg_catalog.pg_class c WHERE c.oid=to_regclass(relation);
     optional_schema := optional_schema || jsonb_build_object(relation,COALESCE(schema_state,'{"present":false}'::jsonb));
   END IF;
   IF to_regclass(relation) IS NULL THEN
     IF relation=ANY(required) THEN RAISE EXCEPTION 'I316 missing protected relation %',relation; END IF;
     result := result || jsonb_build_object(relation,jsonb_build_object('absent',true));
   ELSIF current_setting('afldb.i316.postcommit',true)='true'
     AND current_setting('afldb.i316.before',true)::jsonb->'protected'->relation = '{"absent":true}'::jsonb THEN
     -- Newly appeared unrelated optional table: record schema, do not read its data.
     result := result || jsonb_build_object(relation,jsonb_build_object('environment_only',true));
   ELSE
     EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''sha256'',encode(sha256(convert_to(COALESCE(string_agg(h,'''' ORDER BY h COLLATE "C"),''''),''UTF8'')),''hex'')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') h FROM %s t) rows',to_regclass(relation)) INTO fingerprint;
     result := result || jsonb_build_object(relation,fingerprint);
   END IF;
 END LOOP;
 -- Only safe actor identity fields; credentials/session material are never selected.
 result := result || jsonb_build_object('repair_actor',(SELECT jsonb_build_object('id',id,'email',email,'role',role,'disabled_at',disabled_at) FROM public.auth_users WHERE id=1));
 PERFORM set_config('afldb.i316.snapshot',jsonb_build_object('protected',result,'optional_schema',optional_schema,
   'audit_rows',(SELECT COALESCE(jsonb_object_agg(id::text,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex')),'{}'::jsonb) FROM public.data_edits d))::text,false);
END $snapshot$;
