-- =====================================================================
-- AFLDB 042 — Natural keys for the awards family
-- =====================================================================
-- Every table in migration 005 got a surrogate identity key and, with the
-- single exception of honour_team_members (honour_team_uq), nothing else.
-- A surrogate key guarantees the row is distinguishable from itself; it
-- guarantees nothing about the data. Running an importer twice, or a
-- partial reload that missed its truncate, silently doubled the awards
-- and nothing in the schema objected.
--
-- These constraints close that. What took working out is WHICH key each
-- table actually has, because the obvious semantic one is wrong for the
-- biggest table here.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. award_winners / award_nominations — keyed by source record
-- --------------------------------------------------------------------
-- The tempting key is (award_id, season, player_name_raw): one person
-- wins one award once a season. Both halves of that are false in the
-- real data.
--
--   * 2016 All-Australian contains two players named "Josh Kennedy" --
--     Sydney's (player_id 11672) and West Coast's (4169). They are
--     different people who were both selected. Same again in the 2013
--     All-Australian squad. A name is not an identity.
--
--   * 1984 All-Australian holds 48 rows where 1983 and 1985 hold 20:
--     24 club listings ("aah:1984:Robert Flower:Melbourne") and 24 state
--     listings ("aah:1984:Robert Flower*:Vic") for the same players, the
--     1984 Australian Championships being selected on state lines. Two
--     rows per player is what the source says, not a double load.
--
-- Adding (award_id, season, player_name_raw) would have rejected all of
-- that as corrupt. So the key used here is the source's own record
-- identity, which is exactly the thing that must not repeat: 2968 rows,
-- 2968 distinct source_record_id, none null. It is the reload key -- the
-- same import running twice now fails loudly instead of doubling -- and
-- it makes an ON CONFLICT upsert possible later, which the truncate-and-
-- reload importer currently has no way to express.
--
-- NULLS NOT DISTINCT (PG15+; this is 16.14) because both columns are
-- nullable in the schema even though neither is null in practice: without
-- it, a future row with a null source would slip past the constraint
-- unbounded, which is the failure mode the constraint exists to stop.
ALTER TABLE award_winners
  ADD CONSTRAINT award_winners_source_uq
  UNIQUE NULLS NOT DISTINCT (source_id, source_record_id);

ALTER TABLE award_nominations
  ADD CONSTRAINT award_nominations_source_uq
  UNIQUE NULLS NOT DISTINCT (source_id, source_record_id);

-- --------------------------------------------------------------------
-- 2. captaincies — both keys hold, so both are declared
-- --------------------------------------------------------------------
-- The source key, as above (1375 rows, 1375 distinct, none null).
ALTER TABLE captaincies
  ADD CONSTRAINT captaincies_source_uq
  UNIQUE NULLS NOT DISTINCT (source_id, source_record_id);

-- And the semantic one, which unlike award_winners genuinely holds: a
-- person cannot hold the same role at the same club in the same season
-- twice. Co-captains differ by player_name_raw, and a captain who is
-- also vice-captain elsewhere in the season differs by role, so both
-- remain expressible. All four columns are NOT NULL, so no null
-- handling is needed.
--
-- This one is worth stating separately from the source key because it
-- constrains the FACT rather than the paperwork: it would still catch a
-- genuine double-entry that arrived under two different source ids.
ALTER TABLE captaincies
  ADD CONSTRAINT captaincies_natural_uq
  UNIQUE (season, club_id, player_name_raw, role);

-- --------------------------------------------------------------------
-- 3. hall_of_fame — no source record id exists, so the name carries it
-- --------------------------------------------------------------------
-- This table has source_id but no source_record_id, so the source key is
-- unavailable. (name, inducted_year) is clean across all 343 rows, and
-- name alone is currently unique too -- but inducted_year is kept in the
-- key so that two genuinely different people sharing a name can still
-- both be inducted, which is precisely the case that bit award_winners
-- above.
--
-- NULLS NOT DISTINCT is doing real work here: 45 of the 343 rows have no
-- inducted_year. Under the default rule those 45 would be exempt from the
-- constraint entirely, which is the opposite of what is wanted. All 45
-- are distinct by name, so the stricter reading applies cleanly.
ALTER TABLE hall_of_fame
  ADD CONSTRAINT hall_of_fame_name_uq
  UNIQUE NULLS NOT DISTINCT (name, inducted_year);

-- --------------------------------------------------------------------
-- Note on the indexes these create
-- --------------------------------------------------------------------
-- Each UNIQUE constraint builds a B-tree index. award_winners and
-- award_nominations gain an index on (source_id, source_record_id) that
-- no read path uses today -- accepted deliberately, because the write-side
-- guarantee is the point and these tables are reloaded, not appended to.
-- captaincies_natural_uq additionally serves lookups keyed on season,
-- which ix_captaincies_club (club_id, season) cannot answer.
