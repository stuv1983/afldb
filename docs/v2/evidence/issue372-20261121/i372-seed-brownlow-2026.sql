-- AFLDB-ISSUE-372 qualification (Brownlow flow re-run for 371) reproduction seed (DISPOSABLE database only; never a real database).
-- Makes the rebuild's 2026 season publishable through the real admin path, mirroring the production
-- state before publication: 2026 has NO brownlow_season_votes row (so /brownlow/2026 is 404) and every
-- home-and-away match carries an attached 3/2/1 vote set. The votes are SYNTHETIC: the three players
-- with the most disposals in each match (ties broken by player id). They are not real Brownlow votes.
\set ON_ERROR_STOP 1
BEGIN;
SELECT 'before' AS k, count(*) FROM brownlow_season_votes WHERE season = 2026;
WITH ranked AS (
  SELECT m.id AS match_id, m.season, m.round_number, s.player_id,
         row_number() OVER (PARTITION BY m.id ORDER BY s.disposals DESC NULLS LAST, s.player_id) AS rn
    FROM matches m
    JOIN player_match_stats s ON s.match_id = m.id
   WHERE m.season = 2026 AND m.round_type = 'home_and_away'
)
INSERT INTO brownlow_round_votes (season, player_id, round_number, match_id, played, votes, source_record_id)
SELECT season, player_id, round_number, match_id, true, (4 - rn)::smallint, 'i372-synthetic:' || match_id || ':' || rn
  FROM ranked WHERE rn <= 3;
SELECT 'inserted' AS k, count(*) FROM brownlow_round_votes WHERE source_record_id LIKE 'i372-synthetic:%';
SELECT 'accounted' AS k, count(*) FILTER (WHERE rv.total = 6 AND rv.positives = 3 AND rv.distinct_values = 3) AS accounted, count(*) AS expected
  FROM matches m
  LEFT JOIN LATERAL (SELECT COALESCE(sum(votes), 0) total, count(*) FILTER (WHERE votes > 0) positives,
                            count(DISTINCT votes) FILTER (WHERE votes > 0) distinct_values
                       FROM brownlow_round_votes b WHERE b.match_id = m.id) rv ON true
 WHERE m.season = 2026 AND m.round_type = 'home_and_away';
COMMIT;
