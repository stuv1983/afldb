-- attendance: one historical missing crowd becomes a recorded one (pairing intact, counts move)
UPDATE matches SET attendance = 1234, attendance_status = 'complete'
 WHERE id = (SELECT id FROM matches WHERE season <= 2025 AND attendance IS NULL ORDER BY id LIMIT 1);
