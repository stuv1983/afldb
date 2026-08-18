-- =====================================================================
-- AFLDB 051 — nl_search_log.run_tag: provenance for synthetic runs
-- =====================================================================
-- Qualification sweeps (tools/nl/, the Playwright NL UI sweep) write real
-- rows through the real request path -- deliberately, so they exercise
-- production truthfully -- but that makes them indistinguishable from a
-- genuine reader's search once written. The 2026-08-18 12k UI sweep was
-- identified after the fact by timestamp window instead (see project
-- memory), which is exact for one isolated run but does not scale: two
-- overlapping sweeps, or a sweep running alongside real beta traffic,
-- would leave no way to tell which row belongs to which.
--
-- run_tag is nullable and defaults to nothing: a genuine reader's search
-- never sets it, so ordinary logging behaviour is unchanged. A sweep sets
-- it once -- a header on every request, threaded through
-- globalSearch -> answerNlQuestion -> logNlSearch -- to a label
-- identifying that run, e.g. 'ui-12k-20260818' or 'stress-v10-250k'.
-- =====================================================================

ALTER TABLE nl_search_log ADD COLUMN IF NOT EXISTS run_tag text;

COMMENT ON COLUMN nl_search_log.run_tag IS
  'Set only by a synthetic qualification run (a header threaded through to logNlSearch); NULL means real reader traffic.';
