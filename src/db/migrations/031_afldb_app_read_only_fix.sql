-- =====================================================================
-- AFLDB 031 — Close afldb_app's read access to operational tables
-- =====================================================================
-- Migration 023 stated "no grant to afldb_app is deliberate" and left it
-- at that. That was not enough: role setup (tools/maintenance) put a
-- SCHEMA-WIDE default privilege on `public`, owned by afldb_owner —
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO afldb_app;
--
-- — meant to spare every future statistical migration a manual grant.
-- It has no way to know "except the auth ones": it silently handed
-- afldb_app SELECT on auth_users (password hashes, TOTP secrets),
-- auth_sessions, auth_audit_log, the beta-access tables and every
-- data_submissions row (uploaded file bytes, byte for byte) the moment
-- each table was created, migration 030's admin_invites included.
--
-- tests/integration/privileges.test.ts already asserted the invariant
-- this restores; it had been silently failing.
--
-- The default privilege itself is left in place — it is genuinely
-- useful for the 100+ statistical tables it was built for. This
-- explicitly revokes what it granted on the tables that must never be
-- readable from the public pool. Any FUTURE operational table (anything
-- alongside auth/beta/submissions/invites, not a statistical one) MUST
-- add its own REVOKE here in its own migration — the default privilege
-- will grant afldb_app SELECT on it automatically otherwise, exactly as
-- it did here. Do not assume "I didn't grant it" is sufficient.
-- =====================================================================

REVOKE ALL ON auth_users, auth_sessions, auth_audit_log,
  beta_access_codes, beta_allowed_emails, beta_login_tokens, beta_join_requests,
  data_submissions, data_submission_rows, admin_invites
FROM afldb_app;
