-- AFLDB V2 — database reversal of migrations 111-114 (docs/v2/rollback-runbook.md section 5).
--
-- DATA-LOSS STEP. Run only after the previous code is live (runbook section 4), only with the
-- owner's approval, as the owner role, AFTER the section 5 exports. It drops the five V2 ledgers
-- and removes their four ledger rows, so the runner and the preflight agree with the pre-V2
-- checkout. It touches no other table: award_winners, brownlow_season_votes, fixtures and every
-- historical table are untouched (each ledger's ROLLBACK block in its migration says so).
--
-- Order: every table that references another V2 table goes first. Migration 114 section 2 only
-- altered CHECK constraints of the two 111 tables, so dropping those tables reverses it too.
-- Rehearsed on the isolated PostgreSQL 16 cluster (docs/v2/final-report.md, Launch F): after this
-- file the schema is byte-identical (pg_dump -s --no-privileges) to 001-110 applied alone, and a
-- re-run of the runner re-applies 111-114 to a schema-and-grants dump identical to the first.

\set ON_ERROR_STOP on
BEGIN;
DROP TABLE IF EXISTS derived_award_projections;        -- 114 ROLLBACK block, section 1 (FK into 112)
DROP TABLE IF EXISTS brownlow_eligibility_decisions;   -- 113 ROLLBACK block
DROP TABLE IF EXISTS derived_award_results;            -- 112 ROLLBACK block
DROP TABLE IF EXISTS award_proposal_decisions;         -- 111 ROLLBACK block (references award_proposals)
DROP TABLE IF EXISTS award_proposals;                  -- 111 ROLLBACK block
DELETE FROM afldb_meta.schema_migrations
 WHERE name IN ('111_curated_award_proposals.sql', '112_derived_award_results.sql',
                '113_brownlow_eligibility_decisions.sql', '114_award_projections_and_curated_revisions.sql');
COMMIT;
