-- AFLDB 061 — Source order for seasonal representative teams
-- =====================================================================
-- Position labels alone sort lexically (B, C, F, HB...) and captain-first
-- ordering pulls a player out of the supplied formation. A nullable order
-- preserves source layout where the source provides one while leaving every
-- existing award row's behaviour unchanged.

ALTER TABLE award_winners
  ADD COLUMN sort_order smallint,
  ADD CONSTRAINT award_winners_sort_order_ck
    CHECK (sort_order IS NULL OR sort_order BETWEEN 1 AND 100);

COMMENT ON COLUMN award_winners.sort_order IS
  'Optional one-based source display order within an award season; NULL when the source supplies no order.';
