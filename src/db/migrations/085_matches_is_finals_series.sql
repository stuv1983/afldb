-- =====================================================================
-- AFLDB 085 — matches.is_finals_series: one canonical finals-series
--             predicate, separate from the structural is_final flag
-- =====================================================================
-- AFLDB-ISSUE-129, implementing the operator decision recorded verbatim in
-- issues/open/AFLDB-ISSUE-129.md §8.4 (approved 2026-09-03), items 4, 11
-- and 12. Runs after 084 because it USES the 'wildcard_final' label, which
-- PostgreSQL forbids in the same transaction that adds it.
--
-- WHY TWO FLAGS
--
-- Until 2026 AFLDB had exactly one non-home-and-away class of match, so
-- one boolean answered two different questions at once:
--
--   (a) "is this outside the home-and-away premiership-points season?"
--   (b) "is this part of the finals series?"
--
-- The Wildcard Round is the first round in AFL history where those answers
-- differ. It is played after the home-and-away season and before the finals
-- series, between the clubs seeded 7-10, to decide finals places 7 and 8.
-- It awards no premiership points, does not move the ladder and is not
-- polled for the Brownlow -- so (a) is true. A club eliminated in it
-- finished outside the eight and did not play in the finals series -- so
-- (b) is false.
--
--   is_final          answers (a). Structural. UNCHANGED, still
--                     CHECK-derived as (round_type <> 'home_and_away').
--   is_finals_series  answers (b). New, and the ONLY definition of it.
--
-- Consumers asking "made finals", "finals appearances", "played in
-- finals", "won a final" and the like must read is_finals_series. The
-- sharpest case: club_seasons.finals_played feeds nl/club-season.ts
-- made_finals / missed_finals, so building it from is_final would answer
-- "made the finals" for a 9th-placed club eliminated in the Wildcard
-- Round.
--
-- WHY A GENERATED COLUMN RATHER THAN A REPEATED PREDICATE
--
-- §8.4 item 12: one canonical definition, not
-- `round_type NOT IN ('home_and_away','wildcard_final')` copied into ~20
-- call sites across TypeScript and Python where one could silently drift.
-- GENERATED ALWAYS ... STORED cannot disagree with round_type, needs no
-- backfill or trigger, is readable from plain SQL by both toolchains, and
-- is indexable. The expression is immutable (enum equality), which the
-- generated-column contract requires.
--
-- Grants: this is a new COLUMN on an existing table, and privileges.sql
-- grants at table level (GRANT SELECT ON public.%I), so afldb_app and
-- afldb_import inherit it. No db:privileges run is required.
-- =====================================================================

ALTER TABLE matches
  ADD COLUMN is_finals_series boolean
  GENERATED ALWAYS AS (round_type NOT IN ('home_and_away', 'wildcard_final')) STORED;

-- Mirrors ix_matches_finals, which serves the is_final predicate.
CREATE INDEX ix_matches_finals_series
  ON matches (season, round_type) WHERE is_finals_series;

COMMENT ON COLUMN matches.is_final IS
  'STRUCTURAL: this match is not a home-and-away premiership-points match. '
  'CHECK-derived as (round_type <> ''home_and_away''). It is NOT a '
  'finals-series membership flag -- a wildcard final is is_final = true and '
  'is_finals_series = false. Use it for ladder, premiership-points and '
  'Brownlow-eligibility scoping. See AFLDB-ISSUE-129 §8.4.';

COMMENT ON COLUMN matches.is_finals_series IS
  'SEMANTIC: this match is part of the traditional AFL finals series '
  '(elimination/qualifying/semi/preliminary/grand final). False for '
  'home_and_away and for wildcard_final. The single canonical answer to '
  '"made finals" / "finals appearances" / "played in finals"; never '
  're-spell this predicate at a call site. See AFLDB-ISSUE-129 §8.4.';

COMMENT ON COLUMN matches.round_type IS
  'Canonical round identity. wildcard_final (added in 084) is the AFL '
  'Wildcard Round played between the home-and-away season and the finals '
  'series; it is deliberately NOT collapsed into any existing finals type.';
