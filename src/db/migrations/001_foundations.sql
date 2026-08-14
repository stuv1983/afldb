-- =====================================================================
-- AFLDB 001 — Foundations: provenance, import tracking, uncertainty
-- =====================================================================
-- Every later migration depends on the vocabulary established here.
--
-- Design principle: the schema must be able to record what we do NOT
-- know. Unresolved links, disputed values and rejected rows are all
-- first-class, so that better sources can be applied later without a
-- schema rewrite.
-- =====================================================================

-- Schemas -------------------------------------------------------------
-- staging: verbatim copies of source rows. Never read by the website.
-- public:  normalised AFLDB entities.
CREATE SCHEMA IF NOT EXISTS staging;
COMMENT ON SCHEMA staging IS
  'Raw source rows imported verbatim. Reprocessable; never queried by the application.';

-- Enumerations --------------------------------------------------------

-- How confidently a source record was linked to an AFLDB entity.
-- Mirrors the legacy vocabulary so migration is lossless.
CREATE TYPE link_status AS ENUM (
  'unique',       -- exactly one candidate; trusted
  'resolved',     -- multiple candidates, resolved deliberately; trusted
  'ambiguous',    -- multiple candidates, unresolved; NOT trusted
  'unmatched',    -- no candidate found; NOT trusted
  'implausible'   -- candidate found but rejected on evidence; NOT trusted
);
COMMENT ON TYPE link_status IS
  'Only ''unique'' and ''resolved'' may be treated as a confirmed link.';

CREATE TYPE import_status AS ENUM ('running', 'completed', 'failed', 'rolled_back');

CREATE TYPE issue_severity AS ENUM ('info', 'warning', 'error');

-- Whether a value is directly sourced, estimated, or derived.
CREATE TYPE value_confidence AS ENUM ('sourced', 'estimated', 'derived', 'unknown');

-- Sources -------------------------------------------------------------
CREATE TABLE sources (
  id            smallint     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  key           text         NOT NULL UNIQUE,
  name          text         NOT NULL,
  url           text,
  kind          text         NOT NULL,
  description   text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT sources_kind_ck CHECK (kind IN ('upstream_dataset','scrape','manual','derived'))
);
COMMENT ON TABLE sources IS 'Registry of every dataset AFLDB ingests.';

-- Import batches ------------------------------------------------------
CREATE TABLE import_batches (
  id                bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_id         smallint     NOT NULL REFERENCES sources(id),
  tool              text         NOT NULL,
  target_table      text,
  started_at        timestamptz  NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  status            import_status NOT NULL DEFAULT 'running',
  records_read      bigint       NOT NULL DEFAULT 0,
  records_inserted  bigint       NOT NULL DEFAULT 0,
  records_updated   bigint       NOT NULL DEFAULT 0,
  records_rejected  bigint       NOT NULL DEFAULT 0,
  validation_result jsonb,
  error             text,
  notes             text
);
COMMENT ON TABLE import_batches IS
  'One row per import run. records_rejected must always equal the number of import_rejections rows for the batch.';

CREATE INDEX ix_import_batches_source  ON import_batches (source_id, started_at DESC);
CREATE INDEX ix_import_batches_status  ON import_batches (status) WHERE status <> 'completed';

-- Rejected rows -------------------------------------------------------
-- Requirement: never silently ignore a failed row.
CREATE TABLE import_rejections (
  id                bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  import_batch_id   bigint      NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_record_id  text,
  reason            text        NOT NULL,
  payload           jsonb,
  rejected_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_import_rejections_batch ON import_rejections (import_batch_id);

-- Data quality issues -------------------------------------------------
-- Backs the internal data-quality report. Sources that disagree are
-- recorded here rather than being silently reconciled.
CREATE TABLE data_issues (
  id            bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  entity_type   text         NOT NULL,
  entity_id     bigint,
  issue_type    text         NOT NULL,
  severity      issue_severity NOT NULL DEFAULT 'warning',
  description   text         NOT NULL,
  details       jsonb,
  detected_at   timestamptz  NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolution    text
);
CREATE INDEX ix_data_issues_open ON data_issues (entity_type, issue_type)
  WHERE resolved_at IS NULL;
COMMENT ON TABLE data_issues IS
  'Open data-quality findings. Unresolved source conflicts are flagged here, never silently resolved.';

-- Reusable provenance columns ----------------------------------------
-- Applied to every table carrying imported facts.
CREATE OR REPLACE FUNCTION add_provenance_columns(target regclass)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'ALTER TABLE %s
       ADD COLUMN source_id        smallint REFERENCES sources(id),
       ADD COLUMN source_record_id text,
       ADD COLUMN import_batch_id  bigint   REFERENCES import_batches(id),
       ADD COLUMN imported_at      timestamptz NOT NULL DEFAULT now()', target);
END $$;
COMMENT ON FUNCTION add_provenance_columns IS
  'Adds the standard source_id / source_record_id / import_batch_id / imported_at provenance quartet.';
