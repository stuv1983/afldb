-- birth dates: one historical player loses his date and its evidence link (the date is "recovered" no more)
WITH p AS (
  SELECT pl.id FROM players pl
   WHERE pl.dob IS NOT NULL
     AND EXISTS (SELECT 1 FROM player_match_stats s JOIN matches m ON m.id = s.match_id
                  WHERE s.player_id = pl.id AND m.season <= 2025)
   ORDER BY pl.id LIMIT 1
)
UPDATE players SET dob = NULL, dob_evidence_id = NULL, dob_confidence = 'unknown'
 WHERE id IN (SELECT id FROM p);
