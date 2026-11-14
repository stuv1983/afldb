\echo == pinned ids -> name + afltables identity (snapshot) ==
SELECT p.id, p.display_name, p.legacy_player_id,
       (SELECT string_agg(e.external_id || '/' || e.status, ' ; ' ORDER BY e.external_id)
          FROM external_identities e JOIN sources s ON s.id = e.source_id
         WHERE e.player_id = p.id AND s.key = 'afltables') AS afltables
  FROM players p
 WHERE p.id IN (2164,11789,3048,11145,11802,4700,4701,10974,
                12550,6244,10377,4386,12775,3195,12378,8193,
                67,481,600,3175,3266,6669,6912,
                6,7,51,1,2,3,5,28,3651,3208)
 ORDER BY p.id;
\echo == fixture prefix / seasons proof ==
SELECT 'seasons 2073/2074', count(*) FROM seasons WHERE year IN (2073,2074);
SELECT 'matches 2073/2074', count(*) FROM matches WHERE season IN (2073,2074);
SELECT 'ext CD_I4060', count(*) FROM external_identities WHERE external_id LIKE 'CD\_I4060%';
SELECT 'players CD_I4060', count(*) FROM players WHERE slug ILIKE 'cd%i4060%' OR display_name ILIKE '%CD_I4060%';
SELECT 'seasons max/2027', max(year), (SELECT status::text FROM seasons WHERE year=2027) FROM seasons;
SELECT 'auth_users', count(*) FROM auth_users;
