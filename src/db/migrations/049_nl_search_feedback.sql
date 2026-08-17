-- ---------------------------------------------------------------------
-- 049 — reader feedback on a natural-language answer
-- ---------------------------------------------------------------------
-- A third kind of judgement about a search, deliberately kept apart from
-- the two that already exist:
--
--   nl_search_log     what the ENGINE did.    Immutable, append-only.
--   nl_search_feedback what a READER said.    Immutable, append-only.
--   nl_search_review  what an ADMIN concluded. Mutable.
--
-- Reader feedback is append-only for the same reason the telemetry is: a
-- reader having pressed "no" at 8:04pm is a fact that happened, not a
-- field to be corrected later. An admin who disagrees records that in
-- nl_search_review, against the same search, without touching what the
-- reader actually said.
--
-- CORRELATION, AND WHY IT IS NOT search_log_id
--
-- nl_search_log rows are written from `after()` — deferred until the
-- response has already been sent — so the page that renders an answer
-- cannot know the id its own log row will get. Rather than make logging
-- blocking (it is on the hot path of every search) or have the client
-- guess, answerNlQuestion mints a client_ref up front, writes it into
-- the log row, and returns it with the answer. The feedback row carries
-- the same value.
--
-- client_ref is a random v4 UUID with no meaning beyond joining these
-- two tables. It is NOT the nl_sid session cookie and must never be set
-- to it: nl_sid spans many searches, so reusing it would let one
-- feedback submission attach itself to a different search than the one
-- the reader was looking at.
-- ---------------------------------------------------------------------

ALTER TABLE nl_search_log ADD COLUMN client_ref uuid;

-- Unique so a feedback row can never be ambiguous about which search it
-- describes; partial so the 40k rows logged before this migration, which
-- have no ref, do not all collide on NULL.
CREATE UNIQUE INDEX ux_nl_search_log_client_ref
  ON nl_search_log (client_ref) WHERE client_ref IS NOT NULL;

COMMENT ON COLUMN nl_search_log.client_ref IS
  'Opaque per-search token returned to the browser so reader feedback can be attached to this exact search. Random, meaningless, and NOT the nl_sid session cookie.';

CREATE TABLE nl_search_feedback (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_ref      uuid NOT NULL UNIQUE,
  verdict         text NOT NULL CHECK (verdict IN ('correct', 'incorrect')),
  -- Bounded in the database as well as in the action: this is unvetted
  -- text from an anonymous browser, and the column is the last line that
  -- holds whatever the action forgets to.
  expected_answer text CHECK (
                    expected_answer IS NULL
                    OR (length(expected_answer) > 0 AND length(expected_answer) <= 2000)
                  ),
  -- "Yes, correct" carries no prose. Accepting text there would create a
  -- second, unread place for a reader to report a problem.
  CONSTRAINT nl_search_feedback_correct_has_no_text_ck
    CHECK (verdict = 'incorrect' OR expected_answer IS NULL),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Deliberately NOT a foreign key to nl_search_log. The log row is
-- written from after(), so a reader who answers the prompt fast enough
-- could submit before it lands, and an FK would reject the feedback
-- outright -- losing the report to protect a join. The admin read is a
-- LEFT JOIN on client_ref, so an early row simply shows its search
-- detail once the log catches up.
COMMENT ON TABLE nl_search_feedback IS
  'What a reader said about one answer: correct, or incorrect with what it should have said. Append-only, anonymous, and joined to nl_search_log by client_ref rather than by a foreign key -- see the migration for why.';
COMMENT ON COLUMN nl_search_feedback.client_ref IS
  'Matches nl_search_log.client_ref. Carries no identity and is not the nl_sid session cookie.';

CREATE INDEX ix_nl_search_feedback_created ON nl_search_feedback (created_at DESC);
CREATE INDEX ix_nl_search_feedback_verdict ON nl_search_feedback (verdict, created_at DESC);

-- ---------------------------------------------------------------------
-- afldb_auth — INSERT for the public submission, SELECT for /admin.
-- No UPDATE and no DELETE: the table is append-only, and the absent
-- grant is what enforces that, rather than a convention someone has to
-- remember. nl_search_log needs no new grant either -- client_ref is
-- written by the same INSERT that writes the row.
--
-- The sequence grant matches nl_search_review's in 047. It is redundant
-- for an IDENTITY column, which Postgres advances internally, but it
-- costs nothing and the two tables reading differently would invite a
-- reviewer to wonder which one is wrong.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT ON nl_search_feedback TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE nl_search_feedback_id_seq TO afldb_auth;
  END IF;
END
$$;
