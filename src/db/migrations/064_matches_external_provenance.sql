-- =====================================================================
-- AFLDB 064 - Match provenance for external current-season refreshes
-- =====================================================================
-- Current-season API refreshes can add match rows before the legacy source
-- catches up. Those rows need the same provenance columns carried by the
-- other imported fact tables, so later reconciliation can see exactly where
-- they came from.
-- =====================================================================

SELECT add_provenance_columns('matches');

COMMENT ON COLUMN matches.source_id IS
  'Source for match rows inserted or reconciled after the original legacy import.';
COMMENT ON COLUMN matches.source_record_id IS
  'External source match identifier, scoped by source_id.';
