-- =====================================================================
-- AFLDB 029 — Super admins and delegable admin management
-- =====================================================================
-- Until now auth_users.role has had exactly one legal value ('admin'),
-- and every administrator was created equally from the server shell.
-- This introduces a second tier, 'super_admin', and a per-account flag
-- that lets a super admin delegate just the "may invite/manage other
-- admins" power to a regular admin without promoting them outright.
--
-- A super_admin always has that power regardless of the flag; the flag
-- exists only to grant it to a plain 'admin'. Enforced in application
-- code (src/lib/auth/session.ts), not by a CHECK here, since it is a
-- disjunction across two columns rather than a property of one.
-- =====================================================================

ALTER TABLE auth_users DROP CONSTRAINT auth_users_role_check;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_role_check
  CHECK (role IN ('admin', 'super_admin'));

ALTER TABLE auth_users ADD COLUMN can_manage_admins boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN auth_users.role IS
  'admin or super_admin. super_admin implies can_manage_admins regardless of that column.';
COMMENT ON COLUMN auth_users.can_manage_admins IS
  'Delegated power to invite/manage other admins, independent of role. '
  'A super_admin has this power inherently; this column lets one grant just '
  'that power to a plain admin without a full promotion.';
