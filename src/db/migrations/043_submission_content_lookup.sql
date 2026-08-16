-- =====================================================================
-- AFLDB 043 — Look a submission up by the bytes it carries
-- =====================================================================
-- data_submissions has stored content_sha256 since migration 023 but
-- nothing ever read it, so an identical file arriving twice made two
-- submissions and a human had to notice and reconcile them.
--
-- The email intake makes that a normal event rather than an accident.
-- The poller re-sends any message whose POST it could not confirm --
-- a connection dropped after staging, a client timeout while
-- validation was still running -- because "leave it unread and try
-- again" is the only safe response to an unknown outcome. Retrying is
-- only harmless if the second attempt resolves to the first
-- submission, which is what stageSubmission now does.
--
-- An index, not a unique constraint: the same bytes MAY legitimately
-- be submitted twice, once a rejected or promoted submission has
-- reached a terminal state and someone deliberately sends the file
-- again. Uniqueness would forbid that. The pipeline scopes the
-- duplicate check to submissions still in play instead.
-- =====================================================================

CREATE INDEX IF NOT EXISTS ix_data_submissions_content
  ON data_submissions (dataset, content_sha256);

COMMENT ON INDEX ix_data_submissions_content IS
  'Idempotency lookup for stageSubmission: has this exact file, for this dataset, already been staged?';
