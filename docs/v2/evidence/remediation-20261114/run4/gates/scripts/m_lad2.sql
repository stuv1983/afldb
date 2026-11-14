-- ladder: one Sydney ladder row is lost (the lineage no longer partitions)
DELETE FROM club_seasons
 WHERE season = 1990 AND club_id = (SELECT id FROM clubs WHERE slug = 'sydney');
