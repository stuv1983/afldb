-- =====================================================================
-- AFLDB 047 — Natural-language search: failure taxonomy, plan hashing,
-- confidence detail, reformulation tracking, and human review
-- =====================================================================
-- Migration 046 gave every /search render one telemetry row. This is the
-- upgrade a detailed external review asked for before phase F's tuning
-- pass starts: a `outcome` of `declined_low_confidence` tells an admin
-- THAT a question failed, not WHY, and there is nowhere yet to record a
-- human's judgement about a specific search or to notice that three
-- searches in ten seconds were one reader rephrasing the same question.
--
-- Six additions, each traceable to a real gap 046 left open:
--
--   failure_reason    A fixed, fine-grained taxonomy (unsupported_topic,
--                     ambiguous_player, coverage_unavailable, ...) under
--                     the existing coarse `outcome`. Only the values this
--                     codebase can actually produce today are listed --
--                     see db/queries/nl/log.ts's NlFailureReason comment
--                     for which ones a future change would unlock
--                     (fuzzy club/venue matching for ambiguous_club/venue;
--                     a real compiler gap for compiler_not_available,
--                     moot since all five grains compile as of phase D).
--   topic             The unanswerable-topic slug ("streaks", "coaching"),
--                     populated only alongside failure_reason =
--                     'unsupported_topic' -- the input to the "what
--                     should AFLDB build next" report this exists for.
--   parser_version    PARSER_VERSION (plan.ts) at the time of the search,
--                     so a vocabulary change can be measured by comparing
--                     outcomes before and after it shipped, not guessed
--                     at from a deploy timestamp.
--   confidence_components / entity_resolution
--                     The parser already computes these (NlParseReport);
--                     046 only kept the final scalar confidence. Losing
--                     the components on write meant a reviewer could see
--                     THAT a search scored 0.71 but not whether that came
--                     from a low token ratio, a fuzzy player match, or an
--                     unresolved mention -- three different fixes.
--   plan_hash         SHA-256 of the plan's canonical JSON. Distinct
--                     phrasings of one semantic question ("dusty most
--                     disposals", "Dustin Martin's disposal record")
--                     collapse to the same hash, turning "428 raw
--                     searches" into "97 unique things people asked for".
--   session_id / parent_search_id
--                     An anonymous, unsigned per-visit cookie (minted by
--                     middleware.ts, never tied to auth) lets a search
--                     that follows another from the same session within
--                     60 seconds record which one it likely refines --
--                     the single strongest signal that an answer didn't
--                     match what the reader actually meant, and one an
--                     error log can never show.
--
-- Plus nl_search_review: telemetry stays immutable and append-only, so a
-- human's judgement about a specific search (parser_bug, new_alias,
-- correct_decline, ...) lives in its own row, the same separation this
-- codebase already keeps between a fact and an opinion about the fact.
-- =====================================================================

ALTER TABLE nl_search_log
  ADD COLUMN failure_reason        text,
  ADD COLUMN topic                 text,
  ADD COLUMN parser_version        integer,
  ADD COLUMN plan_hash             text,
  ADD COLUMN confidence_components jsonb,
  ADD COLUMN entity_resolution     jsonb,
  ADD COLUMN session_id            uuid,
  ADD COLUMN parent_search_id      bigint REFERENCES nl_search_log(id);

ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_failure_reason_ck CHECK (
  failure_reason IS NULL OR failure_reason IN (
    'unsupported_topic', 'unsupported_term', 'ambiguous_player',
    'low_confidence', 'unrecognised', 'coverage_unavailable',
    'empty_result', 'query_timeout', 'database_error', 'internal_error'
  )
);

-- One-directional rather than requiring the converse (every non-answered
-- outcome MUST carry a reason): that stronger form would need every row
-- already in the table -- written before this column existed -- to
-- satisfy it too, and ADD CONSTRAINT validates existing rows by default.
-- This direction is still the invariant that matters: a successful
-- answer must never carry a stale diagnostic reason.
ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_answered_has_no_reason_ck CHECK (
  outcome NOT IN ('answered', 'answered_caveat') OR failure_reason IS NULL
);

CREATE INDEX ix_nl_search_log_plan_hash      ON nl_search_log (plan_hash)      WHERE plan_hash IS NOT NULL;
CREATE INDEX ix_nl_search_log_failure_reason ON nl_search_log (failure_reason) WHERE failure_reason IS NOT NULL;
CREATE INDEX ix_nl_search_log_session_id     ON nl_search_log (session_id, at DESC) WHERE session_id IS NOT NULL;
CREATE INDEX ix_nl_search_log_parser_version ON nl_search_log (parser_version);

COMMENT ON COLUMN nl_search_log.failure_reason IS
  'Fine-grained taxonomy under outcome -- see the CHECK constraint for the closed list, and log.ts''s NlFailureReason for how each is derived.';
COMMENT ON COLUMN nl_search_log.plan_hash IS
  'SHA-256 of the plan''s canonical (key-sorted) JSON. Groups distinct phrasings of the same semantic question.';
COMMENT ON COLUMN nl_search_log.session_id IS
  'The anonymous nl_sid cookie (lib/nl-session.ts). Not derived from IP or account identity, and not the auth session.';
COMMENT ON COLUMN nl_search_log.parent_search_id IS
  'The most recent search from the same session_id within 60 seconds, if any -- a candidate reformulation chain, not a confirmed one.';

-- ---------------------------------------------------------------------
-- Human review
-- ---------------------------------------------------------------------
CREATE TABLE nl_search_review (
  id                bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  search_log_id     bigint NOT NULL UNIQUE REFERENCES nl_search_log(id),
  status            text NOT NULL DEFAULT 'unreviewed' CHECK (status IN (
                      'unreviewed', 'reviewing', 'accepted', 'fixed',
                      'wont_fix', 'duplicate', 'not_a_problem'
                    )),
  category          text CHECK (category IS NULL OR category IN (
                      'parser_bug', 'new_alias', 'new_metric', 'new_semantic_rule',
                      'ambiguous_language', 'missing_data', 'coverage_limitation',
                      'correct_decline', 'performance', 'database_error', 'user_error', 'other'
                    )),
  notes             text,
  reviewed_by       integer REFERENCES auth_users(id),
  reviewed_at       timestamptz,
  fixed_in_version  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_nl_search_review_status ON nl_search_review (status);

COMMENT ON TABLE nl_search_review IS
  'A human''s judgement about one nl_search_log row -- separate from the immutable telemetry itself, the same way an issue tracker is separate from the error it was filed from. Not app-readable; written by afldb_auth from a future /admin/nl-search page.';

-- ---------------------------------------------------------------------
-- afldb_auth — nl_search_review is read/write, unlike nl_search_log's
-- append-only shape (an admin transitions status/category/notes).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT, UPDATE ON nl_search_review TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE nl_search_review_id_seq TO afldb_auth;
  END IF;
END
$$;
