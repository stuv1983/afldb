-- v5 exact database principal: the existing non-superuser owner role afldb_owner, explicitly pinned.
-- Shared by production and the private-cluster fixture; the instance identity stays in identity.sql.
-- Privilege-derived acceptance alone is never enough: the role, its attributes, its memberships,
-- the ownership state and the audit table's exact ACLs must all match what discovery observed.
DO $principal$
DECLARE me oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='afldb_owner');
        seq regclass := pg_catalog.pg_get_serial_sequence('public.data_edits','id')::regclass;
        required text[] := ARRAY['public.data_edits','public.auth_users','public.data_overrides','public.matches','public.player_match_stats','public.match_period_scores','public.player_match_period_stats','public.player_career_stats','public.player_season_stats','public.player_club_season_stats','public.player_clubs','public.players','public.clubs','public.club_seasons','public.seasons','public.import_batches','public.import_rejections','public.canonical_applications','public.brownlow_season_votes','public.brownlow_round_votes','public.brownlow_vote_entry_state','public.brownlow_season_authority','public.auth_audit_log','staging.afltables_player_match','staging.afltables_match','staging.afl_api_lineup','staging.afl_api_brownlow_vote','afldb_meta.schema_migrations'];
BEGIN
 IF me IS NULL OR session_user <> 'afldb_owner' OR current_user <> 'afldb_owner'
 THEN RAISE EXCEPTION 'I316 principal session/current user refused'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE oid=me AND rolcanlogin AND rolinherit AND NOT rolsuper
     AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=me OR roleid=me)
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=me)
 THEN RAISE EXCEPTION 'I316 principal role attributes/membership refused'; END IF;
 IF (SELECT datdba FROM pg_catalog.pg_database WHERE datname=current_database()) <> me
 OR EXISTS (SELECT 1 FROM unnest(required) r WHERE pg_catalog.to_regclass(r) IS NULL
     OR (SELECT relowner FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass(r)) <> me)
 OR seq IS NULL OR (SELECT relowner FROM pg_catalog.pg_class WHERE oid=seq) <> me
 THEN RAISE EXCEPTION 'I316 principal ownership refused'; END IF;
 IF (SELECT relacl::text FROM pg_catalog.pg_class WHERE oid='public.data_edits'::regclass)
      IS DISTINCT FROM '{afldb_owner=arwdDxt/afldb_owner,afldb_auth=ar/afldb_owner,afldb_import=ar/afldb_owner}'
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.data_edits'::regclass AND attnum>0 AND attacl IS NOT NULL)
 OR (SELECT relacl::text FROM pg_catalog.pg_class WHERE oid=seq)
      IS DISTINCT FROM '{afldb_owner=rwU/afldb_owner,afldb_import=U/afldb_owner,afldb_auth=rU/afldb_owner}'
 OR (SELECT array_agg(rolname::text ORDER BY rolname::text COLLATE "C") FROM pg_catalog.pg_roles r WHERE NOT r.rolsuper
       AND pg_catalog.has_column_privilege(r.oid,'public.data_edits'::regclass,'note','UPDATE'))
      IS DISTINCT FROM ARRAY['afldb_owner','pg_write_all_data']
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='pg_write_all_data'::regrole)
 OR NOT pg_catalog.has_column_privilege('public.data_edits','note','UPDATE')
 OR NOT pg_catalog.has_table_privilege('public.data_edits','INSERT')
 THEN RAISE EXCEPTION 'I316 principal privilege state refused'; END IF;
END $principal$;
SELECT 'I316_PRINCIPAL=' || jsonb_build_object('session_user',session_user,'current_user',current_user,
 'superuser',(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user),
 'database_owner',(SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=current_database()),
 'read_only',current_setting('transaction_read_only'))::text;
