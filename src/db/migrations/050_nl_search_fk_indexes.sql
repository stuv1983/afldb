-- =====================================================================
-- AFLDB 050 — Index the two foreign keys migration 047 added
-- =====================================================================
-- Migration 041 swept the schema for unindexed foreign keys, on the
-- reasoning set out in its header: PostgreSQL indexes a PRIMARY KEY and a
-- UNIQUE constraint for you, never a foreign key's referencing column.
-- Migration 047 then added two more FK columns and neither was covered,
-- because it landed after that sweep rather than before it.
--
-- Both are caught up here, on the same terms 041 used: an index is either
-- for a query that exists or for a parent-side delete that would
-- otherwise scan. Both cases are represented below.
-- =====================================================================

-- nl_search_log.parent_search_id — the self-reference that links a search
-- to the one it likely rephrases. getReformulations()
-- (db/queries/nl-search-log.ts) joins `p.id = l.parent_search_id` and
-- takes only the rows where the link exists, which is what this index
-- offers the planner as a driving path; every other row in the table is
-- irrelevant to that query and the partial form keeps them out of the
-- index entirely. A reformulation is the exception rather than the rule,
-- so that is most of them -- the same selectivity argument, and the same
-- shape, as 047's plan_hash and failure_reason indexes.
--
-- getNlLogOverview()'s `count(*) FILTER (WHERE parent_search_id IS NOT
-- NULL)` is NOT a beneficiary: it sits alongside a plain count(*) over
-- the same period, so that query reads every row whatever this migration
-- does. Worth stating so a later reader does not credit the index with
-- a page it never sped up.
CREATE INDEX IF NOT EXISTS ix_nl_search_log_parent_search_id
  ON nl_search_log (parent_search_id) WHERE parent_search_id IS NOT NULL;

-- nl_search_review.reviewed_by — an auth_users reference in the same
-- family as the nine 041 indexed in its "operational bookkeeping" section,
-- and indexed for the same reason: no query filters on it (the admin read
-- LEFT JOINs from the review row to the user, which uses auth_users' own
-- primary key), but deleting an administrator scans this table without it.
CREATE INDEX IF NOT EXISTS ix_nl_search_review_reviewed_by
  ON nl_search_review (reviewed_by) WHERE reviewed_by IS NOT NULL;

-- nl_search_review.search_log_id needs nothing: it is UNIQUE, and a
-- unique constraint brings its own B-tree.
--
-- nl_search_feedback has no foreign key at all -- migration 049 explains
-- why it correlates to nl_search_log by client_ref instead -- so there is
-- nothing on that table for this migration to cover.
