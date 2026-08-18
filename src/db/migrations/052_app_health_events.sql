-- =====================================================================
-- AFLDB 052 — Application health events
-- =====================================================================
-- 2026-08-18: an extensive investigation into a production-only React
-- #418 hydration mismatch on /search (see project memory) ruled out
-- seven candidate mechanisms and closed the root cause as unknown, but
-- non-blocking: testing found no evidence of wrong content, missing
-- content, broken navigation/interaction, or a crash. The open question
-- beta traffic needs to answer is whether that holds for real readers,
-- not synthetic corpus load -- which needs a way to tell a harmless
-- recoverable hydration mismatch apart from something that actually
-- breaks the page.
--
-- One row per client-observed TECHNICAL FAILURE, not per page load --
-- there is deliberately no page-view/volume counter here, only events.
-- The critical distinction this table exists to make is
-- RECOVERABLE_HYDRATION_ERROR vs the rest: React repairing a mismatched
-- subtree client-side is not automatically the same thing as a reader
-- seeing something broken, and conflating the two is exactly the mistake
-- the 2026-08-18 investigation's conclusion warns against.
--
-- Same shape as nl_search_log (migration 046): afldb_auth gets SELECT
-- and INSERT, never UPDATE or DELETE, and this deliberately never calls
-- afldb_meta.grant_app_read() -- migration 039 made afldb_app's default
-- privilege fail closed, so it simply stays invisible to the read-only
-- public role. Read via afldb_auth (the super-admin dashboard) or a
-- superuser role, same as nl_search_log.
-- =====================================================================

CREATE TABLE app_health_events (
  id                       bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  at                       timestamptz NOT NULL DEFAULT now(),
  event_type               text NOT NULL CHECK (event_type IN (
                             'RECOVERABLE_HYDRATION_ERROR', 'UNHANDLED_CLIENT_ERROR',
                             'PAGE_CRASH', 'NAVIGATION_FAILURE', 'INTERACTION_FAILURE',
                             'CONTENT_MISMATCH', 'API_ERROR', 'DATABASE_ERROR'
                           )),
  route                    text CHECK (char_length(route) <= 200),
  build_version            text,
  session_id               uuid,
  navigation_id            uuid,
  react_error_code         text CHECK (char_length(react_error_code) <= 20),
  recovered                boolean,
  -- The search this event happened alongside, when there is one -- most
  -- events won't have one (this table isn't /search-specific), and the
  -- ones that do are resolved server-side from the clientRef the answer
  -- panel already carries (migration 049), never trusted from the client
  -- as a raw id.
  related_search_id        bigint REFERENCES nl_search_log (id) ON DELETE SET NULL,
  worker_id                text,
  request_id               text,
  time_since_navigation_ms integer CHECK (time_since_navigation_ms IS NULL OR time_since_navigation_ms >= 0),
  -- A short, truncated error message for debugging context. NOT a stack
  -- trace, NOT DOM/HTML content, NOT a screenshot -- the 2026-08-18
  -- investigation already showed those don't earn their storage cost for
  -- every event; see the migration comment above.
  detail                   text CHECK (char_length(detail) <= 500)
);

CREATE INDEX ix_app_health_events_at              ON app_health_events (at DESC);
CREATE INDEX ix_app_health_events_type_at         ON app_health_events (event_type, at DESC);
CREATE INDEX ix_app_health_events_related_search   ON app_health_events (related_search_id);

COMMENT ON TABLE app_health_events IS
  'One row per client-observed technical failure (hydration mismatch, uncaught '
  'exception, crash) -- not per page load, and not app-readable. Distinguishes '
  'RECOVERABLE_HYDRATION_ERROR (React repaired it, reader may have seen nothing) '
  'from failures with demonstrated user impact. Read via afldb_auth or a '
  'superuser role.';

-- ---------------------------------------------------------------------
-- afldb_auth — append-only, matching nl_search_log's grant shape exactly
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT ON app_health_events TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE app_health_events_id_seq TO afldb_auth;
  END IF;
END
$$;
