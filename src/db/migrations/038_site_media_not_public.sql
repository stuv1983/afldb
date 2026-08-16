-- =====================================================================
-- AFLDB 038 — Revoke afldb_app's automatic SELECT on site_media
-- =====================================================================
-- Migration 037 created site_media and its header claimed the table was
-- "NOT readable by afldb_app ... this table has no such requirement and
-- so gets no such grant". The second half of that sentence was wrong, and
-- migration 031 had already explained why in as many words:
--
--   "Any FUTURE operational table ... MUST add its own REVOKE here in its
--    own migration — the default privilege will grant afldb_app SELECT on
--    it automatically otherwise ... Do not assume 'I didn't grant it' is
--    sufficient."
--
-- The schema-wide default privilege on `public`
-- (ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO afldb_app, set
-- up in tools/maintenance and deliberately left in place for the 100+
-- statistical tables it exists for) granted it the moment 037 ran. Both
-- databases were checked after the fact and did indeed show
-- `afldb_app SELECT`.
--
-- This is a tightening, not an incident. site_media holds marketing
-- screenshots that are published to a public website by design, so
-- nothing confidential was ever reachable. What was wrong is the gap
-- between what the schema says about itself and what it does — and a
-- bytea table the public pool can stream is not something to leave
-- granted merely because today's rows are harmless.
--
-- 037 is left untouched: migrations are SHA-256 checksummed and the
-- runner refuses an edited one, which is the correct trade. The comment
-- there is corrected by this file existing.
-- =====================================================================

REVOKE ALL ON site_media FROM afldb_app;

COMMENT ON TABLE site_media IS
  'Images a super admin uploads at /admin/content, published to disk for the '
  'static apex page. Source of truth: /var/www/afldb-soon is derived from this '
  'table and can be regenerated from it. NOT readable by afldb_app — the '
  'schema-wide default privilege grants that automatically and migration 038 '
  'revokes it, per the rule migration 031 sets out.';
