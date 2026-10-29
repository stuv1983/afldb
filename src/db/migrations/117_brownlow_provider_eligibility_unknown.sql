-- BP-2025-ELIGIBILITY-v1: a provider eligibility value that is absent, null or not a boolean is UNKNOWN.
-- It must stay distinguishable from an explicit false, so the typed staging projection may hold NULL.
-- Forward-only, additive in effect: relaxes one NOT NULL constraint. Rewrites no row, changes no
-- default, index, key, grant or ownership. Existing rows are all explicit booleans and stay as they are.
-- Application writers store NULL (never false) when the provider value is not an explicit boolean;
-- readers treat NULL as unknown (src/db/queries/brownlow-eligibility.ts, brownlow-reconciliation-inputs.ts).
-- ROLLBACK: (comment lines only; the migration runner executes this whole file)
-- ROLLBACK:   Do NOT convert NULL to false: that would reintroduce the silent unknown-to-ineligible
-- ROLLBACK:   conversion. First re-project or delete the rows with eligible IS NULL from the retained
-- ROLLBACK:   provider observation, then: ALTER TABLE staging.afl_api_brownlow_vote ALTER COLUMN eligible SET NOT NULL;
ALTER TABLE staging.afl_api_brownlow_vote ALTER COLUMN eligible DROP NOT NULL;
COMMENT ON COLUMN staging.afl_api_brownlow_vote.eligible IS
  'The provider''s explicit Brownlow eligibility boolean for this vote record. NULL = the provider value was absent, null or not a boolean (UNKNOWN); never an implicit false. BP-2025-ELIGIBILITY-v1.';
