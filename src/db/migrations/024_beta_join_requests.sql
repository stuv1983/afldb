-- =====================================================================
-- AFLDB 024 — Self-serve beta join requests
-- =====================================================================
-- Beta admission (023) was fully admin-initiated: an admin either cuts a
-- code or allowlists an email before a visitor can get in. This adds a
-- third path — a visitor asks — without changing how admission itself
-- works: a request only ever RESULTS in an allowlisted email via the
-- same beta_allowed_emails table an admin would use directly, reviewed
-- by a human before it does anything.
-- =====================================================================

CREATE TABLE beta_join_requests (
  id            integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email         text    NOT NULL,
  name          text,
  message       text,
  status        text    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'denied')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_by   integer REFERENCES auth_users(id),
  reviewed_at   timestamptz,
  ip            inet
);
COMMENT ON TABLE beta_join_requests IS
  'Visitor-submitted requests for beta access. Approving one allowlists the email in beta_allowed_emails; the request row is the record of who asked and who decided.';

-- One live request per email at a time: resubmitting while pending must
-- not pile up duplicate rows for the same address.
CREATE UNIQUE INDEX uq_beta_join_requests_pending_email
  ON beta_join_requests (email) WHERE status = 'pending';
CREATE INDEX ix_beta_join_requests_status ON beta_join_requests (status, requested_at DESC);

-- Same defensive guard as migration 023: afldb_auth exists on every
-- environment that has run that migration, but this keeps both
-- migrations consistent and safe to review side by side.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT, UPDATE ON beta_join_requests TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE beta_join_requests_id_seq TO afldb_auth;
  END IF;
END $$;

-- The read-only site role sees none of this, same as every other
-- operational table from migration 023.
