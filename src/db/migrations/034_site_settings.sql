-- =====================================================================
-- AFLDB 034 — Site settings: the few choices a super admin makes at runtime
-- =====================================================================
-- Three things the site used to hard-code now belong to whoever runs it:
-- which record leads the home page, which sections the home page shows
-- and in what order, and who may reach the grid solver. None of them are
-- statistics, so none belong in a statistical table; none of them are
-- secrets, so unlike every other operational table added since migration
-- 023 this one is deliberately READABLE by the public role — the home
-- page is a public page and has to render the choice.
--
-- Keys are namespaced strings ('home.sections', 'grid_solver.audience')
-- and values are jsonb. Application code (src/lib/site-settings.ts) owns
-- the shape of each value and falls back to a compiled-in default when a
-- row is missing or unparseable, so a value written by a newer deploy
-- and read by an older one degrades to the default rather than throwing
-- on a public page. That is also why there is no CHECK on the key: the
-- allowlist that matters is the one in the code that reads it.
-- =====================================================================

CREATE TABLE site_settings (
  key         text PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  integer     REFERENCES auth_users(id)
);

COMMENT ON TABLE site_settings IS
  'Runtime configuration a super admin sets from /admin/settings. Public-readable '
  'by design: the home page renders these choices. Never put a secret here.';
COMMENT ON COLUMN site_settings.key IS
  'Namespaced key, e.g. home.sections, home.record_of_the_week, grid_solver.audience. '
  'The authoritative list lives in src/lib/site-settings.ts.';
COMMENT ON COLUMN site_settings.value IS
  'jsonb, shaped per key by src/lib/site-settings.ts. An unparseable value falls '
  'back to that module''s default rather than failing the page.';

-- afldb_app: SELECT only. The schema-wide default privilege (migration
-- 031) already grants it, but this states the intent explicitly, because
-- for this table public readability is the point rather than an accident
-- to be revoked. No write grant: the public pool stays read-only, and
-- tests/integration/privileges.test.ts fails the build if that changes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_app') THEN
    GRANT SELECT ON site_settings TO afldb_app;
  END IF;
END $$;

-- afldb_auth writes them: /admin/settings runs on the auth pool, the same
-- way every other admin write does.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT, UPDATE ON site_settings TO afldb_auth;
  END IF;
END $$;
