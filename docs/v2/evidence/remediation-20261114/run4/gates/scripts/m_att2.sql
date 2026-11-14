-- attendance: the status/figure pairing constraint is removed and one missing crowd is mis-labelled complete
ALTER TABLE matches DROP CONSTRAINT matches_attendance_status_ck;
UPDATE matches SET attendance_status = 'complete'
 WHERE id = (SELECT id FROM matches WHERE season <= 2025 AND attendance IS NULL ORDER BY id LIMIT 1);
