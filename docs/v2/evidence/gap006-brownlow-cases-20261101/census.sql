-- READ-ONLY census (no writes). Rows whose record note text equals a data_edits.note for the same entity.
-- Equality is circumstantial only: a human may legitimately enter the same text in both fields.
SELECT 'sl_rows_with_note='||count(*) FROM season_list_members WHERE note IS NOT NULL;
SELECT 'sl_note_equals_audit='||count(*) FROM season_list_members m WHERE m.note IS NOT NULL AND EXISTS
  (SELECT 1 FROM data_edits d WHERE d.table_name='players' AND d.row_id=m.player_id AND d.field_group LIKE 'season_list_%' AND d.note = m.note);
SELECT 'cl_rows_with_note='||count(*) FROM club_leadership WHERE note IS NOT NULL;
SELECT 'cl_note_equals_audit='||count(*) FROM club_leadership c WHERE c.note IS NOT NULL AND EXISTS
  (SELECT 1 FROM data_edits d WHERE d.table_name='club_leadership' AND d.row_id=c.id AND d.note = c.note);
SELECT 'ov_rows_with_note='||count(*) FROM data_overrides WHERE entity_type IN ('season_list_members','club_leadership') AND override_values ? 'note' AND override_values->>'note' IS NOT NULL;
SELECT 'ov_note_equals_audit='||count(*) FROM data_overrides o WHERE o.entity_type IN ('season_list_members','club_leadership') AND o.override_values->>'note' IS NOT NULL AND EXISTS
  (SELECT 1 FROM data_edits d WHERE (d.field_group LIKE 'season_list_%' OR d.field_group LIKE 'leadership_%') AND d.note = o.override_values->>'note');
SELECT 'audit_rows_editor_families='||count(*) FROM data_edits WHERE field_group LIKE 'season_list_%' OR field_group LIKE 'leadership_%';
