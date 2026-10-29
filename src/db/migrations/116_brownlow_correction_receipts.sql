-- Separately approved prerequisite for the guarded Brownlow correction runner.
-- No correction data is written by this migration. Owner-operated; no app/import grants.
CREATE TABLE brownlow_correction_receipts (
  plan_digest text PRIMARY KEY CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  operation text NOT NULL CHECK (operation IN ('backfill', 'adopt', 'eligibility', 'observe', 'resolve', 'reverse-backfill', 'reverse-adopt')),
  code_revision text NOT NULL CHECK (code_revision ~ '^[0-9a-f]{40}$'),
  approval_reference text NOT NULL CHECK (length(approval_reference) >= 20),
  before_digest text NOT NULL,
  after_digest text NOT NULL,
  result jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION refuse_brownlow_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Brownlow correction receipts are append-only'; END $$;
CREATE TRIGGER brownlow_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON brownlow_correction_receipts FOR EACH STATEMENT EXECUTE FUNCTION refuse_brownlow_receipt_mutation();
REVOKE ALL ON brownlow_correction_receipts FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['afldb_app', 'afldb_import', 'afldb_auth'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON brownlow_correction_receipts FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
COMMENT ON TABLE brownlow_correction_receipts IS
  'Owner-operated correction receipts; commit atomically with the reviewed correction. Never an execution approval.';
