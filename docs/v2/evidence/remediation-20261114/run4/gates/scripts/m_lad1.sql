-- ladder: one Footscray season is filed under Sydney (a row on the wrong identity, outside its era)
UPDATE club_seasons SET club_id = (SELECT id FROM clubs WHERE slug = 'sydney')
 WHERE season = 1950 AND club_id = (SELECT id FROM clubs WHERE slug = 'footscray');
