-- =====================================================================
-- AFLDB 046 — Natural-language search log
-- =====================================================================
-- Phases A-D built a deterministic NL search engine (src/search/nl/,
-- src/db/queries/nl/) with no LLM anywhere in the pipeline; every grain
-- the parser understands now compiles to SQL. This is the last piece of
-- the original plan: a record of what real readers actually type, so
-- the vocabulary and confidence thresholds can be tuned from evidence
-- rather than guesswork (phase F).
--
-- Append-only, the same shape as auth_audit_log: afldb_auth gets SELECT
-- and INSERT, never UPDATE or DELETE. Deliberately NOT app-readable --
-- migration 039 made afldb_app's default privilege fail closed, so this
-- table simply never calls afldb_meta.grant_app_read() and stays
-- invisible to the read-only public role. Nothing here is personal: no
-- IP, no session, no user id, just the question text and how the parser
-- handled it.
--
-- `outcome` is wider than the six values sketched in the original plan
-- doc, because that doc predates two things the actual implementation
-- grew: 'ambiguous' as its own decline reason, distinct from
-- low-confidence (src/search/nl/plan.ts's NlDeclineReason), and a
-- zero-rows-matched branch in answerNlQuestion (a plan that parsed and
-- validated fine but matched nothing -- a genuinely different signal
-- from "the parser didn't understand this" and worth its own bucket
-- for phase F rather than being folded into a catch-all).
-- =====================================================================

CREATE TABLE nl_search_log (
  id                 bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  at                 timestamptz NOT NULL DEFAULT now(),
  question           text NOT NULL CHECK (char_length(question) <= 200),
  outcome            text NOT NULL CHECK (outcome IN (
                       'answered', 'answered_caveat', 'no_results',
                       'declined_low_confidence', 'declined_ambiguous',
                       'unrecognised', 'unanswerable', 'error'
                     )),
  grain              text CHECK (grain IN
                       ('player_career', 'player_game', 'player_season', 'team_match', 'club_season')),
  metric             text,
  plan               jsonb,
  confidence         real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  unsupported_terms  text[],
  result_count       integer CHECK (result_count IS NULL OR result_count >= 0),
  duration_ms        integer CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX ix_nl_search_log_at      ON nl_search_log (at DESC);
CREATE INDEX ix_nl_search_log_outcome ON nl_search_log (outcome, at DESC);

COMMENT ON TABLE nl_search_log IS
  'One row per /search render that reaches the NL engine: the question, '
  'how the parser and compiler handled it, and (for a real answer) the '
  'metric and row count. Not app-readable -- read via afldb_auth or a '
  'superuser role. Mined for vocabulary gaps and confidence tuning '
  '(phase F), never for anything identifying a reader.';

-- ---------------------------------------------------------------------
-- afldb_auth — append-only, matching auth_audit_log's grant shape
-- ---------------------------------------------------------------------
-- Guarded the same way migrations 023/024/030/032/034/037 guard their
-- afldb_auth grants: the role may not exist yet on a fresh install
-- (02_add_auth_role.sh runs after the schema migrations), and
-- tools/maintenance/privileges.sql is the catch-up for that case.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT ON nl_search_log TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE nl_search_log_id_seq TO afldb_auth;
  END IF;
END
$$;
