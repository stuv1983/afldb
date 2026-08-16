-- =====================================================================
-- AFLDB 035 — Configurable answers on a beta join request
-- =====================================================================
-- Migration 024 gave a join request three fixed fields: email, name and
-- message. The public "request early access" form on the apex now asks
-- whatever questions a super admin has configured
-- (site_settings 'early_access.questions', migration 034), so the answers
-- no longer fit a fixed column each.
--
-- One jsonb object, keyed by question id: {"interest": "…"}. Deliberately
-- NOT a normalised answers table — these rows are read one at a time by a
-- human on /admin/access, never aggregated or joined, and a question that
-- is later renamed or deleted must not orphan or cascade anything. The
-- shape is owned by src/lib/site-settings.ts, the same way every
-- site_settings value is.
--
-- `message` is kept and is still written by the older /beta gate form,
-- which is unchanged. A row therefore carries whichever of the two the
-- form that created it collects, and the review UI renders both.
--
-- NOTE for readers: postgres.js hands jsonb back as raw TEXT on this
-- project's client configuration, so anything reading this column must
-- JSON.parse it. src/db/queries/early-access.ts does exactly that.
-- =====================================================================

ALTER TABLE beta_join_requests ADD COLUMN answers jsonb;

COMMENT ON COLUMN beta_join_requests.answers IS
  'Answers to the super-admin-configured questions, keyed by question id. '
  'Null for requests made through the /beta gate form, which collects the '
  'fixed message column instead. Shape owned by src/lib/site-settings.ts.';

-- The public role never reads this table (migration 024 established that);
-- only afldb_auth touches it, and its existing table-level grants already
-- cover a new column. Stated here so the omission reads as deliberate
-- rather than forgotten.
