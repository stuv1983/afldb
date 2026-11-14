-- SCRATCH ONLY (ISSUE-363 run 4 clubcmp): a synthetic later COMPLETED season 2067, inserted into a disposable
-- copy of a base to prove the historical assertions do not go stale merely because another season completes.
-- Never committed as a fixture, never run against anything but a scratch copy. Prefix CD_I4030, season 2067.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO seasons (year, league, status) VALUES (2067, 'AFL', 'complete'::season_status);
-- club lifespans roll forward with a new season (as they would in production): active identities end at the newest season
UPDATE clubs SET last_season = 2067 WHERE last_season = (SELECT max(last_season) FROM clubs);

CREATE TEMP TABLE cand (kind text PRIMARY KEY, player_id int NOT NULL, club_id int NOT NULL, round_type text NOT NULL,
                        is_final boolean NOT NULL, goals int NOT NULL);

-- A: enters "200-249 games with 16 or more finals": 199 games, >= 16 finals, one more home-and-away game.
INSERT INTO cand SELECT 'A_enter_200_249_f16', c.player_id,
       (SELECT s.club_id FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE s.player_id = c.player_id ORDER BY m.match_date DESC, s.id DESC LIMIT 1),
       'home_and_away', false, 0
  FROM player_career_stats c WHERE c.games = 199 AND c.finals >= 16 ORDER BY c.player_id LIMIT 1;
-- C: enters "50-199 goals and no Brownlow votes": 49 goals, no votes, 3 goals in 2067.
INSERT INTO cand SELECT 'C_enter_goals_50_199_nobv', c.player_id,
       (SELECT s.club_id FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE s.player_id = c.player_id ORDER BY m.match_date DESC, s.id DESC LIMIT 1),
       'home_and_away', false, 3
  FROM player_career_stats c WHERE c.goals = 49 AND c.brownlow_votes = 0 ORDER BY c.player_id LIMIT 1;
-- D: enters "200+ games, 100+ goals and 15+ finals": 14 finals, one more finals-series game (an elimination final).
INSERT INTO cand SELECT 'D_enter_200_100_f15', c.player_id,
       (SELECT s.club_id FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE s.player_id = c.player_id ORDER BY m.match_date DESC, s.id DESC LIMIT 1),
       'elimination_final', true, 1
  FROM player_career_stats c WHERE c.games >= 200 AND c.goals >= 100 AND c.finals = 14 ORDER BY c.player_id LIMIT 1;

SELECT * FROM cand ORDER BY kind;

-- one match per candidate: the candidate's club at home against a club of another organisation
INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final,
                     match_date, venue_raw, home_club_id, away_club_id,
                     home_score, away_score, result, winner_club_id, margin,
                     attendance, attendance_status, source_id)
SELECT 'CD_I4030-2067-' || k.kind, 2067,
       CASE WHEN k.round_type = 'elimination_final' THEN 'EF' ELSE '1' END,
       CASE WHEN k.round_type = 'elimination_final' THEN NULL ELSE 1 END,
       k.round_type::round_type, k.is_final,
       CASE WHEN k.round_type = 'elimination_final' THEN DATE '2067-09-04' ELSE DATE '2067-03-20' END,
       'CD_I4030 Fixture Oval', k.club_id,
       (SELECT c.id FROM clubs c WHERE c.organization_id IS NOT NULL
           AND c.last_season = 2067
           AND c.organization_id <> (SELECT organization_id FROM clubs WHERE id = k.club_id) ORDER BY c.id LIMIT 1),
       100, 80, 'home_win'::match_result, k.club_id, 20, NULL, 'not_collected'::coverage_status,
       (SELECT id FROM sources WHERE key = 'afltables')
  FROM cand k;

-- plus ONE Adelaide v Brisbane Lions home-and-away meeting in 2067 (the Lions win), so the head-to-head witnesses move too
INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final,
                     match_date, venue_raw, home_club_id, away_club_id,
                     home_score, away_score, result, winner_club_id, margin,
                     attendance, attendance_status, source_id)
SELECT 'CD_I4030-2067-adl-lions', 2067, '2', 2, 'home_and_away'::round_type, false,
       DATE '2067-04-01', 'CD_I4030 Fixture Oval', a.id, l.id, 70, 88, 'away_win'::match_result, l.id, 18,
       NULL, 'not_collected'::coverage_status, (SELECT id FROM sources WHERE key = 'afltables')
  FROM clubs a, clubs l WHERE a.slug = 'adelaide' AND l.slug = 'brisbane-lions';

-- a completed season carries per-period scores for every match and a stat_availability row per statistic (copied from 2026)
-- cumulative period scores whose fourth period equals the full-time score (points = 6 * goals + behinds)
INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points)
SELECT m.id, c.club_id, p.period,
       (c.score / 6) * p.period / 4, (c.score % 6) * p.period / 4,
       6 * ((c.score / 6) * p.period / 4) + (c.score % 6) * p.period / 4
  FROM matches m
  CROSS JOIN LATERAL (VALUES (m.home_club_id, m.home_score), (m.away_club_id, m.away_score)) AS c(club_id, score)
  CROSS JOIN generate_series(1, 4) AS p(period)
 WHERE m.season = 2067;
-- a ladder row per participating club (every 2067 match counted; illustrative, scratch only)
INSERT INTO club_seasons (season, club_id, played, wins, draws, losses, points_for, points_against,
                          premiership_points, percentage, ladder_rank)
SELECT 2067, t.club_id, count(*), sum(t.win), sum(t.draw), sum(t.loss), sum(t.pf), sum(t.pa),
       4 * sum(t.win) + 2 * sum(t.draw), round(100.0 * sum(t.pf) / sum(t.pa), 4),
       row_number() OVER (ORDER BY 4 * sum(t.win) + 2 * sum(t.draw) DESC, t.club_id)
  FROM (SELECT home_club_id AS club_id, home_score AS pf, away_score AS pa, (home_score > away_score)::int AS win, (home_score = away_score)::int AS draw, (home_score < away_score)::int AS loss
          FROM matches WHERE season = 2067
        UNION ALL
        SELECT away_club_id, away_score, home_score, (away_score > home_score)::int, (away_score = home_score)::int, (away_score < home_score)::int
          FROM matches WHERE season = 2067) t
 GROUP BY t.club_id;
CREATE TEMP TABLE sa2067 AS SELECT * FROM stat_availability WHERE season = 2026;
UPDATE sa2067 SET season = 2067;
INSERT INTO stat_availability SELECT * FROM sa2067;

-- player rows
INSERT INTO player_match_stats (player_id, match_id, club_id, kicks, marks, handballs, disposals,
                                goals, behinds, hitouts, tackles, frees_for, frees_against, source_id)
SELECT k.player_id, m.id, k.club_id, 12, 4, 8, 20, k.goals, 1, 0, 3, 1, 1, (SELECT id FROM sources WHERE key = 'afltables')
  FROM cand k JOIN matches m ON m.match_key = 'CD_I4030-2067-' || k.kind;

-- Ben Keays (Adelaide) and Charlie Cameron (Brisbane Lions) in the Adelaide v Lions meeting, by AFL Tables identity
INSERT INTO player_match_stats (player_id, match_id, club_id, kicks, marks, handballs, disposals,
                                goals, behinds, hitouts, tackles, frees_for, frees_against, source_id)
SELECT ei.player_id, (SELECT id FROM matches WHERE match_key = 'CD_I4030-2067-adl-lions'),
       (SELECT id FROM clubs WHERE slug = CASE ei.external_id WHEN 'players/B/Ben_Keays.html' THEN 'adelaide' ELSE 'brisbane-lions' END),
       15, 5, 10, 25, CASE ei.external_id WHEN 'players/B/Ben_Keays.html' THEN 1 ELSE 4 END, 1, 0, 3, 1, 1, (SELECT id FROM sources WHERE key = 'afltables')
  FROM external_identities ei JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
 WHERE ei.external_id IN ('players/B/Ben_Keays.html', 'players/C/Charlie_Cameron.html');

SELECT m.match_key, m.season, m.round_type::text, m.is_final, m.is_finals_series FROM matches m WHERE m.season = 2067 ORDER BY m.match_key;
COMMIT;
