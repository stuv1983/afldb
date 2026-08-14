-- =====================================================================
-- AFLDB 023 — Authentication, beta access and vetted data submissions
-- =====================================================================
-- Two features share this migration because they share an access model.
--
--   Beta gate      While the site is in beta, a visitor needs either an
--                  access code or a verified email on the allowlist.
--   Admin          A small number of administrators sign in with a
--                  password AND a TOTP code to upload data.
--
-- The website's afldb_app role stays read-only on the statistical
-- schema; that invariant is load-bearing and verified by test. These
-- operational tables are therefore written by a NEW role, afldb_auth,
-- which in turn has no privileges on the statistical tables beyond what
-- login needs (none). Promotion of vetted data into the real tables
-- runs under afldb_import, exactly like any other import.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Accounts and sessions
-- --------------------------------------------------------------------
CREATE TABLE auth_users (
  id            integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email         text    NOT NULL UNIQUE,
  role          text    NOT NULL CHECK (role IN ('admin')),
  -- scrypt: salt$N$r$p$hash, all base64url. NULL until the account is
  -- activated by the bootstrap tool.
  password_hash text,
  -- Base32 TOTP secret (RFC 6238). NULL until enrolment; login requires
  -- it, so an un-enrolled account cannot sign in.
  totp_secret   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);
COMMENT ON TABLE auth_users IS
  'Administrators only. Beta visitors are not accounts; they hold codes or allowlisted emails.';

CREATE TABLE auth_sessions (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- sha256 of the cookie token: a database read never yields a usable session.
  token_hash    text    NOT NULL UNIQUE,
  user_id       integer NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  ip            inet,
  user_agent    text
);
CREATE INDEX ix_auth_sessions_user ON auth_sessions (user_id, expires_at);

-- --------------------------------------------------------------------
-- 2. Beta access
-- --------------------------------------------------------------------
CREATE TABLE beta_access_codes (
  id            integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- sha256 of the code. The clear text is shown once, at creation.
  code_hash     text    NOT NULL UNIQUE,
  label         text    NOT NULL,
  max_uses      integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count     integer NOT NULL DEFAULT 0,
  created_by    integer REFERENCES auth_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz
);
COMMENT ON COLUMN beta_access_codes.label IS
  'Who or what the code was cut for — a name, "footy forum wave 1" — so a code can be revoked meaningfully.';

CREATE TABLE beta_allowed_emails (
  id            integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email         text    NOT NULL UNIQUE,
  note          text,
  added_by      integer REFERENCES auth_users(id),
  added_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

-- Magic-link tokens for allowlisted emails. Single use, short lived.
CREATE TABLE beta_login_tokens (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email         text    NOT NULL,
  token_hash    text    NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz
);
CREATE INDEX ix_beta_login_tokens_email ON beta_login_tokens (email, created_at);

-- --------------------------------------------------------------------
-- 3. Audit
-- --------------------------------------------------------------------
-- Append-only. afldb_auth receives INSERT but not UPDATE or DELETE, so
-- the trail cannot be edited through the application.
CREATE TABLE auth_audit_log (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_user_id integer REFERENCES auth_users(id),
  actor_label   text,
  action        text    NOT NULL,
  detail        jsonb,
  ip            inet
);
CREATE INDEX ix_auth_audit_at ON auth_audit_log (at DESC);

-- --------------------------------------------------------------------
-- 4. Data submissions: staged -> validated -> approved -> promoted
-- --------------------------------------------------------------------
-- A submission is one uploaded CSV. It is staged verbatim, validated
-- into a per-row report, approved by a human, and only then promoted —
-- by the import role — into the statistical tables. Every earlier state
-- is kept, so a bad file is refused with reasons rather than partially
-- applied.
CREATE TYPE submission_status AS ENUM (
  'staged',      -- uploaded and parsed; nothing checked yet
  'validated',   -- checked; per-row report attached; awaiting a human
  'rejected',    -- a human said no (or validation found fatal errors)
  'approved',    -- a human said yes; eligible for promotion
  'promoted',    -- applied to the statistical tables
  'failed'       -- promotion raised; nothing was applied (transactional)
);

CREATE TABLE data_submissions (
  id               integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  dataset          text    NOT NULL,
  filename         text    NOT NULL,
  content          bytea   NOT NULL,
  content_sha256   text    NOT NULL,
  uploaded_by      integer NOT NULL REFERENCES auth_users(id),
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  status           submission_status NOT NULL DEFAULT 'staged',
  row_count        integer,
  validation_report jsonb,
  reviewed_by      integer REFERENCES auth_users(id),
  reviewed_at      timestamptz,
  promoted_at      timestamptz,
  import_batch_id  bigint REFERENCES import_batches(id),
  error            text
);
COMMENT ON COLUMN data_submissions.content IS
  'The uploaded file, byte for byte. Kept so a promotion is always reproducible from what was actually reviewed.';

CREATE INDEX ix_data_submissions_status ON data_submissions (status, uploaded_at DESC);

-- Parsed rows, one per CSV line, with the validator's verdict.
CREATE TABLE data_submission_rows (
  submission_id integer NOT NULL REFERENCES data_submissions(id) ON DELETE CASCADE,
  row_no        integer NOT NULL,
  payload       jsonb   NOT NULL,
  -- ok | warning | error, with reasons. Errors block approval.
  verdict       text,
  reasons       jsonb,
  PRIMARY KEY (submission_id, row_no)
);

-- --------------------------------------------------------------------
-- 5. Promotion bookkeeping on the target tables
-- --------------------------------------------------------------------
-- Promotion upserts by source record. award_nominations already carries
-- source_record_id; give it the unique index the upsert needs. Partial,
-- because bulk-imported rows may lack one.
CREATE UNIQUE INDEX uq_award_nominations_source
  ON award_nominations (award_id, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE UNIQUE INDEX uq_award_winners_source
  ON award_winners (award_id, source_record_id)
  WHERE source_record_id IS NOT NULL;

-- --------------------------------------------------------------------
-- 6. Privileges
-- --------------------------------------------------------------------
-- afldb_auth may not exist on databases bootstrapped before this
-- migration; grants are applied only when it does, and the install
-- script now creates it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT USAGE ON SCHEMA public TO afldb_auth;
    GRANT SELECT, INSERT, UPDATE ON auth_users, auth_sessions,
      beta_access_codes, beta_allowed_emails, beta_login_tokens,
      data_submissions, data_submission_rows TO afldb_auth;
    GRANT INSERT ON auth_audit_log TO afldb_auth;
    GRANT SELECT ON auth_audit_log TO afldb_auth;
    GRANT DELETE ON data_submission_rows TO afldb_auth;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO afldb_auth;
    -- Validation resolves names against the statistical tables.
    GRANT SELECT ON players, player_clubs, clubs, club_aliases, seasons,
      awards, award_nominations, award_winners, import_batches TO afldb_auth;
  END IF;
END $$;

-- The import role promotes approved submissions and records the batch.
GRANT SELECT ON data_submissions, data_submission_rows TO afldb_import;
GRANT UPDATE (status, promoted_at, import_batch_id, error) ON data_submissions TO afldb_import;

-- The read-only site role sees none of this. No grant to afldb_app is
-- deliberate: these tables never render on a public page.
