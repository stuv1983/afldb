-- The revocation/supersession FK added in 104 is queried during parent-side
-- deletion/reinstatement. Index only its non-NULL references, like migration 041.
-- Additive: no rows, constraints or grants change. Application rollback retains it.
CREATE INDEX ix_afl_api_identity_adjudications_supersedes_id
  ON afl_api_identity_adjudications (supersedes_id)
  WHERE supersedes_id IS NOT NULL;
