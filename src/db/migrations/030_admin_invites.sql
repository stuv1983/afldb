-- =====================================================================
-- AFLDB 030 — Admin invites
-- =====================================================================
-- Self-service replacement for "create every admin from the server
-- shell": a super admin (or a plain admin delegated can_manage_admins,
-- migration 029) mints a single-use, short-lived, unguessable link that
-- lets the invitee set their own password and enrol their own MFA
-- secret by scanning a QR code nobody else ever sees.
--
-- Shape mirrors beta_login_tokens (migration 023): only the token's
-- sha256 is stored, so a database read alone never yields a usable
-- invite, exactly as for the beta magic links and admin sessions.
-- =====================================================================

CREATE TABLE admin_invites (
  id                integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email             text    NOT NULL,
  role              text    NOT NULL CHECK (role IN ('admin', 'super_admin')),
  can_manage_admins boolean NOT NULL DEFAULT false,
  token_hash        text    NOT NULL UNIQUE,
  invited_by        integer NOT NULL REFERENCES auth_users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  revoked_at        timestamptz,
  -- Set after the invitee's first step (choosing a password) and read on
  -- the second (confirming a live TOTP code). Neither ever round-trips
  -- through the browser: the account row is created only once both are
  -- proven, so an abandoned invite never leaves a half-enrolled account
  -- and a stolen link alone (without also seeing the QR code AND
  -- producing a current code) cannot finish onboarding. Cleared once the
  -- invite is accepted.
  pending_password_hash text,
  pending_totp_secret   text
);
COMMENT ON TABLE admin_invites IS
  'Single-use invite links for self-service admin onboarding (password + QR-code MFA enrolment). Only the token hash is stored.';
COMMENT ON COLUMN admin_invites.can_manage_admins IS
  'Granted to the new auth_users row on acceptance; irrelevant when role = super_admin, which already implies it.';

CREATE INDEX ix_admin_invites_email ON admin_invites (email, created_at DESC);

-- afldb_auth already holds the operational grants from migration 023;
-- extend them to this new table the same way.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT, UPDATE ON admin_invites TO afldb_auth;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO afldb_auth;
  END IF;
END $$;
