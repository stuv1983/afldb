-- Read-only assertions: usable before COMMIT and in the independent postcommit transaction.
DO $post$
DECLARE b jsonb := current_setting('afldb.i316.binding')::jsonb;
        beforej jsonb := current_setting('afldb.i316.before')::jsonb;
        afterj jsonb := current_setting('afldb.i316.snapshot')::jsonb;
        receipt jsonb := current_setting('afldb.i316.receipt')::jsonb;
        rid bigint := (receipt->>'id')::bigint;
        n text; relation text; beforep jsonb := beforej->'protected'; afterp jsonb := afterj->'protected';
        postcommit boolean := COALESCE(current_setting('afldb.i316.postcommit',true),'false')='true';
        drift boolean := afterj->'optional_schema' IS DISTINCT FROM beforej->'optional_schema';
BEGIN
 SELECT note INTO n FROM public.data_edits WHERE id=94;
 IF n IS DISTINCT FROM b->>'note' OR length(n)<>967
 OR encode(sha256(convert_to(n,'UTF8')),'hex') <> '3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d'
 OR (SELECT to_jsonb(d)-'note' FROM public.data_edits d WHERE id=94) IS DISTINCT FROM (b->'edit94')-'note'
 THEN RAISE EXCEPTION 'I316 repaired note/target postcondition refused'; END IF;
 IF (SELECT to_jsonb(d) FROM public.data_edits d WHERE id=rid) IS DISTINCT FROM receipt->'row'
 OR (SELECT count(*) FROM public.data_edits WHERE field_group='audit_note_repair'
   AND (old_values->>'target_audit_id'='94' OR new_values->>'target_audit_id'='94')) <> 1
 OR receipt->'row'->>'field_group' <> 'audit_note_repair'
 OR receipt->'row'->>'admin_user_id' <> '1'
 OR receipt->'row'->'new_values'->>'approval_sha256' <> b->>'approval_sha256'
 OR receipt->'row'->'new_values'->>'review_record_sha256' <> current_setting('afldb.i316.review_sha256')
 THEN RAISE EXCEPTION 'I316 linked audit postcondition refused'; END IF;
 IF (afterj->'audit_rows')-rid::text-'94' IS DISTINCT FROM (beforej->'audit_rows')-'94'
 OR (beforej->'audit_rows') ? rid::text
 OR (SELECT count(*) FROM jsonb_object_keys(afterj->'audit_rows')) <>
    (SELECT count(*)+1 FROM jsonb_object_keys(beforej->'audit_rows'))
 THEN RAISE EXCEPTION 'I316 additional/missing/changed audit row refused'; END IF;
 IF postcommit THEN
   FOREACH relation IN ARRAY ARRAY['public.brownlow_eligibility_decisions','public.brownlow_correction_receipts'] LOOP
     IF beforep->relation = '{"absent":true}'::jsonb THEN
       beforep := beforep-relation; afterp := afterp-relation;
     END IF;
   END LOOP;
 END IF;
 IF afterp IS DISTINCT FROM beforep
 THEN RAISE EXCEPTION 'I316 protected canonical/derived/history/Brownlow state changed'; END IF;
 IF (SELECT to_jsonb(o) FROM public.data_overrides o WHERE id=93) IS DISTINCT FROM b->'authority93'
 THEN RAISE EXCEPTION 'I316 authority postcondition refused'; END IF;
 IF drift AND NOT postcommit THEN RAISE EXCEPTION 'I316 optional schema drift before commit'; END IF;
 PERFORM set_config('afldb.i316.environment_status',CASE WHEN drift THEN 'CONCURRENT_SCHEMA_DRIFT' ELSE 'CLEAN' END,false);
END $post$;
