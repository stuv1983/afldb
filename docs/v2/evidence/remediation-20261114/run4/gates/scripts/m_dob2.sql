-- birth dates: a dated historical player's club-list evidence row is dropped AND his link cleared (evidence lost, date kept)
WITH p AS (
  SELECT pl.id AS player_id, pl.dob_evidence_id AS eid FROM players pl
   JOIN player_birth_evidence e ON e.id = pl.dob_evidence_id AND e.evidence_type = 'afltables_club_list'
   WHERE pl.dob IS NOT NULL
   ORDER BY pl.id LIMIT 1
), u AS (
  UPDATE players SET dob_evidence_id = NULL WHERE id IN (SELECT player_id FROM p) RETURNING 1
)
DELETE FROM player_birth_evidence WHERE id IN (SELECT eid FROM p);
