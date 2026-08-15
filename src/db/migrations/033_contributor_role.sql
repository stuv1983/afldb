-- =====================================================================
-- AFLDB 033 — Contributor role: upload-only staff accounts
-- =====================================================================
-- A third auth_users.role, below 'admin': a contributor can sign in
-- (password + TOTP, exactly like an admin) and reach /admin/upload and
-- the status page of a submission they themselves uploaded, but nothing
-- else in /admin. Enforced in application code (src/lib/auth/session.ts):
-- requireAdmin() now redirects a contributor session straight to
-- /admin/upload rather than letting it through, so every existing
-- requireAdmin()-gated page and action is closed to a contributor
-- without having to touch each one individually; requireUploader() is
-- the new, narrower guard that admits all three roles, used only by the
-- upload page/action and the submission-status page.
-- =====================================================================

ALTER TABLE auth_users DROP CONSTRAINT auth_users_role_check;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_role_check
  CHECK (role IN ('admin', 'super_admin', 'contributor'));

COMMENT ON COLUMN auth_users.role IS
  'admin, super_admin or contributor. super_admin implies can_manage_admins '
  'regardless of that column. contributor is upload-only: requireAdmin() '
  'redirects it to /admin/upload rather than admitting it.';

-- The invite flow (migration 030) mints the account, so its own role
-- check needs the same third option.
ALTER TABLE admin_invites DROP CONSTRAINT admin_invites_role_check;
ALTER TABLE admin_invites ADD CONSTRAINT admin_invites_role_check
  CHECK (role IN ('admin', 'super_admin', 'contributor'));
