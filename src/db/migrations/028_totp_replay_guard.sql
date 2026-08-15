-- =====================================================================
-- AFLDB 028 — Single-use TOTP codes
-- =====================================================================
-- RFC 6238 §5.2: a verifier MUST NOT accept the same one-time password
-- twice. Login checked that the submitted code matched the current step
-- (or one either side) but recorded nothing, so a code stayed valid for
-- its whole window — up to ninety seconds across the accepted drift.
-- Anyone who read a code over the owner's shoulder, or captured one in
-- transit, could replay it inside that window; the password is the only
-- thing that stopped them, which is precisely what the second factor
-- exists not to rely on.
--
-- The counter is the RFC 6238 step number, floor(unix_seconds / 30).
-- Login accepts a code only when its step is strictly greater than the
-- one stored, then records it in the same statement, so two concurrent
-- attempts with the same code cannot both win.
--
-- NULL means "no code has been accepted yet", which is every existing
-- account and every freshly enrolled one.
-- =====================================================================

ALTER TABLE auth_users ADD COLUMN totp_last_step bigint;

COMMENT ON COLUMN auth_users.totp_last_step IS
  'RFC 6238 step number of the last accepted TOTP code, floor(unix_seconds/30). '
  'Login requires a strictly greater step, which makes a code single-use. '
  'NULL until the account first signs in; reset to NULL when the secret is re-enrolled.';

-- afldb_auth already holds UPDATE on auth_users from migration 023, and
-- that grant is table-wide rather than column-scoped, so the new column
-- needs no further privilege. Stated here because a column-scoped grant
-- would have silently broken login instead.
