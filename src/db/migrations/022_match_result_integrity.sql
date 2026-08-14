-- =====================================================================
-- AFLDB 022 — Match result integrity, and the draft column that was read
--             but never stored
-- =====================================================================
-- Two unrelated gaps, both of the same kind: something the data happens
-- to satisfy today but nothing prevents tomorrow.
--
-- 1. matches carried a result label the schema did not check against the
--    scores. 003 constrained margin and winner identity, so a row could
--    still say 'home_win' with the away team scoring more, or a 'draw'
--    with unequal scores, and be accepted. The present data is correct
--    only because the importer derives result from the scores; nothing
--    made that derivation binding. A wrong label is worse than a missing
--    one here, because Match Search filters on it and a match page
--    states it as fact.
--
-- 2. import_draft.py has always read signing_detail from the source and
--    then dropped it: there was no column to write it to. 593 non-empty
--    values, every one different from detail, were lost on each import.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. The result label must follow from the scores
-- --------------------------------------------------------------------
ALTER TABLE matches
  ADD CONSTRAINT matches_result_scores_ck CHECK (
    (result = 'home_win' AND home_score > away_score) OR
    (result = 'away_win' AND away_score > home_score) OR
    (result = 'draw'     AND home_score = away_score)
  );

COMMENT ON CONSTRAINT matches_result_scores_ck ON matches IS
  'result is a restatement of the scores, not an independent field. Enforced here so a contradictory row cannot be inserted, whatever writes it.';

-- Scores are counts. A negative one is not a low score, it is a bug.
ALTER TABLE matches
  ADD CONSTRAINT matches_scores_nonnegative_ck CHECK (
    home_score >= 0 AND away_score >= 0
    AND (home_goals   IS NULL OR home_goals   >= 0)
    AND (home_behinds IS NULL OR home_behinds >= 0)
    AND (away_goals   IS NULL OR away_goals   >= 0)
    AND (away_behinds IS NULL OR away_behinds >= 0)
  );

-- A goal is six points and a behind is one. Where the breakdown is
-- recorded it must add up to the total; where it is not recorded the
-- total still stands on its own.
ALTER TABLE matches
  ADD CONSTRAINT matches_score_components_ck CHECK (
    (home_goals IS NULL OR home_behinds IS NULL
     OR home_score = 6 * home_goals + home_behinds)
    AND
    (away_goals IS NULL OR away_behinds IS NULL
     OR away_score = 6 * away_goals + away_behinds)
  );

COMMENT ON CONSTRAINT matches_score_components_ck ON matches IS
  'Goals and behinds must reconcile with the total where both are recorded. Either component may be NULL for early matches whose breakdown was never published.';

-- The same reconciliation for the quarter-by-quarter table, which feeds
-- the match page's scoreline row.
ALTER TABLE match_period_scores
  ADD CONSTRAINT match_period_nonnegative_ck CHECK (
    (goals   IS NULL OR goals   >= 0)
    AND (behinds IS NULL OR behinds >= 0)
    AND (points  IS NULL OR points  >= 0)
  );

ALTER TABLE match_period_scores
  ADD CONSTRAINT match_period_components_ck CHECK (
    goals IS NULL OR behinds IS NULL OR points IS NULL
    OR points = 6 * goals + behinds
  );

-- --------------------------------------------------------------------
-- 2. Draft signing detail
-- --------------------------------------------------------------------
ALTER TABLE draft_picks
  ADD COLUMN signing_detail text;

COMMENT ON COLUMN draft_picks.signing_detail IS
  'The source''s signing_detail, distinct from detail: 593 rows carry one and none of them repeat the detail column. Populated by import_draft.py.';
