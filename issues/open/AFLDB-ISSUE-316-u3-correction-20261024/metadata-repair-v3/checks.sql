-- Read-only checks shared by preflight and the locked repair transaction.
DO $checks$
DECLARE b jsonb := current_setting('afldb.i316.binding')::jsonb;
        n text := b->>'note';
BEGIN
 IF n IS NULL OR length(n) <> 967 OR octet_length(n) <> 967
 OR encode(sha256(convert_to(n,'UTF8')),'hex') <> '3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d'
 THEN RAISE EXCEPTION 'I316 note input refused'; END IF;
 IF b->'actor' <> '{"id":1,"email":"stuart.villanti@gmail.com","role":"super_admin"}'::jsonb
 OR (SELECT count(*) FROM public.auth_users WHERE id=1 AND email=b->'actor'->>'email'
     AND role='super_admin' AND disabled_at IS NULL) <> 1
 THEN RAISE EXCEPTION 'I316 actor refused'; END IF;
 IF b->>'approval_sha256' IS DISTINCT FROM current_setting('afldb.i316.approval_sha256')
 OR b->>'approval_reference' IS DISTINCT FROM 'OWNER-RULING.md (retained 2026-10-24 owner instruction: Accept F-004 as a valid stopping MED finding.)'
 OR b->>'issue' IS DISTINCT FROM 'AFLDB-ISSUE-316'
 THEN RAISE EXCEPTION 'I316 approval refused'; END IF;
 IF (SELECT count(*) FROM public.data_edits WHERE id=94) <> 1
 OR (SELECT to_jsonb(d) FROM public.data_edits d WHERE id=94) IS DISTINCT FROM b->'edit94'
 OR (SELECT note FROM public.data_edits WHERE id=94) IS NOT NULL
 THEN RAISE EXCEPTION 'I316 target identity/null guard refused'; END IF;
 IF (SELECT count(*) FROM public.data_overrides WHERE id=93) <> 1
 OR (SELECT to_jsonb(o) FROM public.data_overrides o WHERE id=93) IS DISTINCT FROM b->'authority93'
 THEN RAISE EXCEPTION 'I316 authority refused'; END IF;
 IF EXISTS (SELECT 1 FROM public.data_edits WHERE field_group='audit_note_repair'
   AND (old_values->>'target_audit_id'='94' OR new_values->>'target_audit_id'='94'))
 THEN RAISE EXCEPTION 'I316 prior repair refused'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid IN ('public.data_edits'::regclass,'public.data_overrides'::regclass) AND NOT tgisinternal)
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite WHERE ev_class IN ('public.data_edits'::regclass,'public.data_overrides'::regclass))
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.data_edits'::regclass,'public.data_overrides'::regclass) AND (relrowsecurity OR relforcerowsecurity OR relkind<>'r'))
 THEN RAISE EXCEPTION 'I316 unexpected audit/authority trigger/rule/RLS/relation'; END IF;
 IF (SELECT jsonb_agg(def ORDER BY def COLLATE "C") FROM
    (SELECT pg_get_constraintdef(oid) AS def FROM pg_catalog.pg_constraint
     WHERE conrelid='public.data_edits'::regclass) c) IS DISTINCT FROM b->'audit_constraints'
 OR (SELECT attidentity FROM pg_catalog.pg_attribute WHERE attrelid='public.data_edits'::regclass AND attname='id') IS DISTINCT FROM 'a'
 THEN RAISE EXCEPTION 'I316 audit schema/constraint drift'; END IF;
 IF NOT has_column_privilege(current_user,'public.data_edits','note','UPDATE')
 OR NOT has_table_privilege(current_user,'public.data_edits','INSERT')
 THEN RAISE EXCEPTION 'I316 existing role lacks repair privileges'; END IF;
END $checks$;
