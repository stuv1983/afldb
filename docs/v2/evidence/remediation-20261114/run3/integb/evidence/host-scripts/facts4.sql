\echo --- H2H meetings by period (independent join on club_organizations, as the test oracle does)
WITH o AS (SELECT slug, id FROM club_organizations WHERE slug IN ('adelaide','brisbane-lions','carlton','collingwood'))
SELECT pair, (m.season <= 2025) AS thru_2025, count(*) AS meetings, count(*) FILTER (WHERE m.is_finals_series) AS finals_series
FROM (
  SELECT 'adelaide-v-brisbane-lions' AS pair, m.* FROM matches m JOIN clubs hc ON hc.id=m.home_club_id JOIN clubs ac ON ac.id=m.away_club_id
   WHERE (hc.organization_id=(SELECT id FROM o WHERE slug='adelaide') AND ac.organization_id=(SELECT id FROM o WHERE slug='brisbane-lions'))
      OR (hc.organization_id=(SELECT id FROM o WHERE slug='brisbane-lions') AND ac.organization_id=(SELECT id FROM o WHERE slug='adelaide'))
  UNION ALL
  SELECT 'carlton-v-collingwood', m.* FROM matches m JOIN clubs hc ON hc.id=m.home_club_id JOIN clubs ac ON ac.id=m.away_club_id
   WHERE (hc.organization_id=(SELECT id FROM o WHERE slug='carlton') AND ac.organization_id=(SELECT id FROM o WHERE slug='collingwood'))
      OR (hc.organization_id=(SELECT id FROM o WHERE slug='collingwood') AND ac.organization_id=(SELECT id FROM o WHERE slug='carlton'))
) m GROUP BY pair, 2 ORDER BY pair, 2;
\echo --- attendance status (the release-gates witness 15,187 / 1,651) and the accepted c2 attendance_known 15,405
SELECT attendance_status::text, count(*) FROM matches GROUP BY 1 ORDER BY 2 DESC;
SELECT (m.season <= 2025) AS thru_2025, count(*) FILTER (WHERE attendance_status::text='complete') AS complete FROM matches m GROUP BY 1 ORDER BY 1;
\echo --- club_seasons ranges (release-gates ladder witness)
SELECT c.slug, count(cs.season) AS n, min(cs.season) AS first, max(cs.season) AS last FROM clubs c JOIN club_seasons cs ON cs.club_id=c.id WHERE c.slug IN ('footscray','western-bulldogs','south-melbourne','sydney','kangaroos','north-melbourne') GROUP BY 1 ORDER BY 1;
\echo --- player ids named by id witnesses (club-comparison): Jarryd Lyons, James Cook, Ben Keays
SELECT id, display_name FROM players WHERE display_name IN ('Jarryd Lyons','James Cook','Ben Keays') ORDER BY display_name, id;
