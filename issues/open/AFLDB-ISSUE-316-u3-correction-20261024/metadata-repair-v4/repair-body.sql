-- Exactly two logical writes. No catch block: every exception aborts the transaction.
DO $repair$
DECLARE b jsonb := current_setting('afldb.i316.binding')::jsonb;
        audit_id bigint; affected integer; audit_row jsonb;
        oldj jsonb; newj jsonb; audit_note text;
BEGIN
 oldj := jsonb_build_object('target_audit_id',94,'authority_id',93,'note',NULL);
 newj := oldj || jsonb_build_object('note',b->>'note','issue',b->>'issue',
   'approval_reference',b->>'approval_reference','approval_sha256',b->>'approval_sha256',
   'review_manifest_sha256',current_setting('afldb.i316.manifest_sha256'),
   'review_record_sha256',current_setting('afldb.i316.review_sha256'),
   'execution_operator','Codex, delegated by the retained owner instruction; SSH arm -> sudo postgres',
   'database_session_user',session_user,'database_current_user',current_user,
   'reason','Approved correction note was missing from the committed audit record; canonical correction state was already separately verified correct. Metadata-only repair.');
 audit_note := 'AFLDB-ISSUE-316 metadata-only repair of data_edits 94.note; durable removal authority 93 unchanged. Owner approval OWNER-RULING.md SHA-256 '
   || (b->>'approval_sha256') || '; reviewed manifest SHA-256 ' || current_setting('afldb.i316.manifest_sha256')
   || '; independent review record SHA-256 ' || current_setting('afldb.i316.review_sha256') || '.';
 UPDATE public.data_edits d SET note=b->>'note'
 WHERE id=94 AND note IS NULL AND to_jsonb(d)=b->'edit94';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'I316 update cardinality %',affected; END IF;
 INSERT INTO public.data_edits(table_name,row_id,field_group,old_values,new_values,admin_user_id,note,created_at)
 VALUES ('matches',17214,'audit_note_repair',oldj,newj,1,audit_note,transaction_timestamp())
 RETURNING to_jsonb(data_edits),id INTO audit_row,audit_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected <> 1 OR audit_id=94 THEN RAISE EXCEPTION 'I316 insert cardinality/id refused'; END IF;
 PERFORM set_config('afldb.i316.receipt',jsonb_build_object('id',audit_id,'row',audit_row)::text,false);
END $repair$;
