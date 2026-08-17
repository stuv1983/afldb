-- =====================================================================
-- AFLDB 048 — Repair double-encoded jsonb in nl_search_log
-- =====================================================================
-- Migrations 046/047 gave nl_search_log three jsonb columns -- `plan`,
-- `confidence_components` and `entity_resolution` -- and db/queries/nl/log.ts
-- bound all three with JSON.stringify(). That is the wrong way to bind a
-- jsonb parameter through postgres.js: the driver JSON-encodes whatever JS
-- value it is handed, so an already-stringified object arrives as a jsonb
-- STRING SCALAR whose contents are JSON text, not as a jsonb object.
--
-- The practical damage is that the columns are opaque to SQL. On a row
-- written the wrong way:
--
--   SELECT plan->>'grain' FROM nl_search_log;   -->  NULL, every row
--   SELECT jsonb_typeof(plan) FROM nl_search_log;  -->  'string'
--
-- which defeats the entire stated point of storing the plan: that an
-- administrator can ask what AFLDB thought the reader meant without
-- reconstructing it from application logs.
--
-- Verified empirically against the dev database before writing this, and
-- worth recording because the intuitive fix does not work: an explicit
-- `${JSON.stringify(x)}::jsonb` cast produces a string scalar too, because
-- the driver encodes the parameter before the cast is ever applied. Only
-- `sql.json(x)` produces a real object. log.ts now does that.
--
-- This migration repairs the rows already written. `col #>> '{}'` extracts
-- a jsonb scalar as its raw text, and casting that text back to jsonb
-- parses it as the object it was always meant to be. The WHERE clause
-- makes it self-limiting: once a value is an object, jsonb_typeof stops
-- returning 'string' and re-running matches nothing.
--
-- Volumes here are tiny (logging shipped days ago and the site is still
-- behind the beta gate), which is exactly why this is worth doing now
-- rather than after months of accumulated telemetry.
--
-- NOT IN SCOPE, deliberately: auth_audit_log.detail carries the identical
-- shape from lib/auth/session.ts's audit(), which predates all of this and
-- has ~100 rows. Nothing reads that column structurally -- the admin
-- dashboard renders `action` and `actor_label` only -- so changing its
-- write path is a separate decision with its own blast radius, not a
-- detail to slip into a natural-language-search migration.
-- =====================================================================

UPDATE nl_search_log
   SET plan = (plan #>> '{}')::jsonb
 WHERE jsonb_typeof(plan) = 'string';

UPDATE nl_search_log
   SET confidence_components = (confidence_components #>> '{}')::jsonb
 WHERE jsonb_typeof(confidence_components) = 'string';

UPDATE nl_search_log
   SET entity_resolution = (entity_resolution #>> '{}')::jsonb
 WHERE jsonb_typeof(entity_resolution) = 'string';

-- Guard the repair so a future regression in the write path is caught by
-- the database rather than by an administrator wondering why every
-- plan->>'grain' is NULL. A scalar is never a valid value for any of
-- these three: a plan is an object, entity resolution is an array of
-- objects, and confidence components are an object.
ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_plan_is_object_ck
  CHECK (plan IS NULL OR jsonb_typeof(plan) = 'object');

ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_components_is_object_ck
  CHECK (confidence_components IS NULL OR jsonb_typeof(confidence_components) = 'object');

ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_entities_is_array_ck
  CHECK (entity_resolution IS NULL OR jsonb_typeof(entity_resolution) = 'array');
