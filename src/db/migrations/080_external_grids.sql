-- =====================================================================
-- AFLDB 080 — captured external grid boards (AFLDB-ISSUE-118 Stage 1)
-- =====================================================================
-- Gridley publishes one 3x3 board per day. AFLDB keeps those boards as a
-- Grid Solver compatibility corpus: what an independent implementation
-- asked, on a known date, in the source's own words.
--
-- NOTHING HERE IS CANONICAL AFL DATA. No row in these tables is a fact
-- about a player, a club or a match. They record what an external puzzle
-- said, so a later stage can compare AFLDB's answers against it. There is
-- no trigger, default or foreign key from here into a canonical table,
-- and the mapping from a source criterion to an AFLDB Grid Solver builder
-- is deliberately absent: it is a reviewed decision, it belongs to its own
-- table, and it arrives in Stage 3 (ISSUE-118 §11, §18).
--
-- CAPTURED EVIDENCE IS IMMUTABLE (ISSUE-118 §10.4). The legacy scraper
-- this corpus is rescued from did the opposite: save_grid() UPDATEd the
-- stored board in place whenever it re-fetched a date, so a board captured
-- from a partial or wrong upstream response destroyed the earlier capture
-- and left no trace that it had. AFLDB never overwrites a captured board.
-- A board whose upstream content later differs is a NEW revision, the
-- previous revision keeps its bytes and stops being current, and the
-- divergence is a finding. The importer refuses to overwrite; the grants
-- at the foot of this file make that refusal structural rather than
-- merely intended.
--
-- WHY THE RAW PAYLOAD IS KEPT (ISSUE-118 §10.3). The legacy archive
-- proves the cost of not keeping it: its capture flattened the source's
-- `title` and `subtitle` into one label and discarded the split, the
-- stable criterion `id`, the source's own `description` and its item
-- `type`. That loss is not reversible, so 1,123 archived boards can never
-- be enriched without re-fetching. Parsed columns are for querying; the
-- payload is the evidence they were parsed from, and a reparse must never
-- require the network. jsonb TOASTs and compresses the payload without
-- any further declaration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ingest registry
-- ---------------------------------------------------------------------
-- One `sources` row, because there is one upstream dataset. The two
-- acquisition paths — the rescued SQLite archive and the Gridley JSON
-- endpoint — are recorded per captured row in `external_grids.provenance`
-- rather than as two datasets, so a board captured twice by two paths is
-- visibly the same board from the same publisher.
INSERT INTO sources (key, name, url, kind, description) VALUES (
  'gridley',
  'Gridley',
  'https://gridleygame.com/',
  'scrape',
  'Daily AFL 3x3 grid puzzle. Boards are read from the undocumented JSON '
  || 'endpoint https://gridleygame.com/data/grids/YYYY-MM-DD.json, which was '
  || 'confirmed on 2026-08-31 to still serve every board back to #1 '
  || '(2023-07-17). Captured as an external compatibility corpus for the '
  || 'AFLDB Grid Solver, never as a source of AFL facts.'
) ON CONFLICT (key) DO NOTHING;

CREATE TABLE external_grid_sources (
  id               smallint    PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  code             text        NOT NULL UNIQUE,
  name             text        NOT NULL,
  base_url         text,
  ingest_source_id smallint    NOT NULL UNIQUE REFERENCES sources(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_grid_sources_code_ck CHECK (code ~ '^[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE external_grid_sources IS
  'The grid platforms AFLDB captures boards from. Gridley is the only one, and this table is deliberately NOT an abstract multi-source platform: add a row when a second publisher actually exists, not before.';
COMMENT ON COLUMN external_grid_sources.ingest_source_id IS
  'The matching sources row, so the grid registry and AFLDB''s ingest registry cannot disagree about who published a board. UNIQUE: one platform, one dataset.';

INSERT INTO external_grid_sources (code, name, base_url, ingest_source_id, notes)
SELECT
  'gridley',
  'Gridley',
  'https://gridleygame.com/',
  s.id,
  'Board number is the upstream `level` field. Across the whole rescued '
  || 'archive (#1 2023-07-17 to #1123 2026-08-12) level = 2023-07-16 + n days '
  || 'holds without exception, and still held at the live probe on 2026-08-31 '
  || '(#1142). The relationship is an observation about the publisher, not a '
  || 'rule this schema enforces.'
FROM sources s
WHERE s.key = 'gridley'
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Captured boards
-- ---------------------------------------------------------------------
CREATE TABLE external_grids (
  id              bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_id       smallint    NOT NULL REFERENCES external_grid_sources(id),
  -- Which acquisition path produced these bytes. Part of the revision
  -- key: see the partial unique indexes below.
  provenance      text        NOT NULL,
  board_number    integer     NOT NULL,
  board_date      date        NOT NULL,
  revision        integer     NOT NULL DEFAULT 1,
  is_current      boolean     NOT NULL DEFAULT true,
  payload_sha256  char(64)    NOT NULL,
  raw_payload     jsonb       NOT NULL,
  -- NULL is the honest value for a rescued archive row: the legacy
  -- capture recorded no fetch timestamp, so there is nothing to state.
  -- now() here would be a fabricated capture time for a board captured
  -- years earlier. Missing means not recorded, never "just now".
  fetched_at      timestamptz,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  import_batch_id bigint      NOT NULL REFERENCES import_batches(id),
  CONSTRAINT external_grids_provenance_ck
    CHECK (provenance IN ('legacy_sqlite', 'gridley_api')),
  CONSTRAINT external_grids_board_number_ck CHECK (board_number >= 1),
  CONSTRAINT external_grids_revision_ck     CHECK (revision >= 1),
  CONSTRAINT external_grids_sha_ck          CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT external_grids_payload_ck      CHECK (jsonb_typeof(raw_payload) = 'object'),
  -- The revision chain. A board is identified by its number within one
  -- provenance, and every revision of it keeps its own row and its own
  -- bytes forever.
  UNIQUE (source_id, provenance, board_number, revision)
);

-- Exactly one current revision per board, per acquisition path.
--
-- ISSUE-118 §11 proposed keying these on (source_id, board_number) alone.
-- Implementation proves that contradicts §10.1 and §12B of the same
-- runbook, which require the rescued archive and the Gridley backfill to
-- be held SIMULTANEOUSLY as independent records of the same board — one
-- as the contemporaneous provenance record, the other as the richer
-- re-acquisition, each a cross-check on the other. Without `provenance`
-- in the key the second path could only land by displacing the first,
-- which is the cross-check destroying the thing it checks. Divergence
-- between the two paths is therefore an ordinary comparison query, not a
-- constraint violation, and it must stay that way.
CREATE UNIQUE INDEX ux_external_grids_current_number
  ON external_grids (source_id, provenance, board_number)
  WHERE is_current;

-- Board number and board date are 1:1 across the entire rescued archive,
-- so a collision here is a genuine finding about the publisher and not a
-- schema inconvenience. Asserted only over CURRENT revisions: a superseded
-- revision legitimately keeps the date it was captured under, and
-- constraining the superseded rows would forbid recording a correction.
CREATE UNIQUE INDEX ux_external_grids_current_date
  ON external_grids (source_id, provenance, board_date)
  WHERE is_current;

CREATE INDEX ix_external_grids_date  ON external_grids (source_id, board_date);
CREATE INDEX ix_external_grids_batch ON external_grids (import_batch_id);
CREATE INDEX ix_external_grids_sha   ON external_grids (source_id, payload_sha256);

COMMENT ON TABLE external_grids IS
  'One row per captured REVISION of one external grid board. Immutable historical evidence: a captured board is never overwritten and never re-parsed in place. Upstream content that differs from the current revision is recorded as an additional revision and flagged, so the earlier capture survives intact.';
COMMENT ON COLUMN external_grids.provenance IS
  'The acquisition path these bytes came from: legacy_sqlite (the rescued Sports Data Lab archive, label text only) or gridley_api (the live JSON endpoint, full item detail). Part of the revision key so both paths can hold the same board at once and cross-check each other.';
COMMENT ON COLUMN external_grids.revision IS
  'Additive capture history, per board per provenance. Revision 1 is the first capture; a later capture with different content becomes revision 2 and the earlier row keeps its bytes with is_current = false. Revisions are never renumbered and never deleted.';
COMMENT ON COLUMN external_grids.payload_sha256 IS
  'SHA-256 of the canonical serialisation of raw_payload. The change oracle: identical content re-imported is a no-op, different content for a captured board is a conflict the importer refuses and reports.';
COMMENT ON COLUMN external_grids.raw_payload IS
  'The source record exactly as captured, kept so a later stage can extract detail the current parse ignores WITHOUT re-fetching. The legacy archive lost the criterion id, the title/subtitle split, the source description and the item type by not doing this, irreversibly.';
COMMENT ON COLUMN external_grids.fetched_at IS
  'When the source was read, when the capture recorded it. NULL for rescued archive rows, which carry no capture timestamp: an invented one would be a fabricated provenance claim.';

-- ---------------------------------------------------------------------
-- Captured axes: exactly six per board revision
-- ---------------------------------------------------------------------
-- Rows are the vertical axis and columns are the horizontal axis, which is
-- the orientation the upstream payload itself uses (`vItems` / `hItems`).
CREATE TABLE external_grid_axes (
  id              bigint   PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  grid_id         bigint   NOT NULL REFERENCES external_grids(id) ON DELETE CASCADE,
  orientation     text     NOT NULL,
  position        smallint NOT NULL,
  -- The source's own stable criterion key (e.g. 'height195',
  -- 'debut-team-richmond'). NULL for rescued archive rows: the legacy
  -- capture never stored it. NULL means "the capture did not record it",
  -- never "this criterion has no key".
  criterion_key   text,
  raw_title       text,
  raw_subtitle    text,
  raw_description text,
  -- The flattened label. Always present, because it is the only form the
  -- rescued archive has, and it is what makes archive and API captures of
  -- the same board comparable.
  raw_label       text     NOT NULL,
  item_type       text,
  CONSTRAINT external_grid_axes_orientation_ck CHECK (orientation IN ('row', 'col')),
  CONSTRAINT external_grid_axes_position_ck    CHECK (position BETWEEN 0 AND 2),
  CONSTRAINT external_grid_axes_label_ck       CHECK (btrim(raw_label) <> ''),
  CONSTRAINT external_grid_axes_key_ck
    CHECK (criterion_key IS NULL OR btrim(criterion_key) <> ''),
  UNIQUE (grid_id, orientation, position)
);

CREATE INDEX ix_external_grid_axes_key
  ON external_grid_axes (criterion_key) WHERE criterion_key IS NOT NULL;
CREATE INDEX ix_external_grid_axes_label ON external_grid_axes (raw_label);

COMMENT ON TABLE external_grid_axes IS
  'The six criteria of one captured board revision, as rows for mapping and reporting. Immutable with the revision that owns them: a corrected board is a new revision with its own six axes, never an edit of these.';
COMMENT ON COLUMN external_grid_axes.orientation IS
  'row = the vertical axis (upstream vItems), col = the horizontal axis (upstream hItems). Verified against the live payload, not assumed from the legacy column names.';
COMMENT ON COLUMN external_grid_axes.raw_label IS
  'The criterion as one string, preserved exactly as the source gave it. Deliberately not normalised, not title-cased and not deduplicated: normalisation is an analysis step, and the raw text is the evidence.';
COMMENT ON COLUMN external_grid_axes.criterion_key IS
  'The source''s stable criterion identifier, when the capture recorded one. NULL on rescued archive rows. Mapping a key to an AFLDB Grid Solver builder is a reviewed Stage 3 decision and lives in its own table, never here.';

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
-- App read is fail-closed since migration 039: a new public table is
-- invisible to afldb_app until it is registered, and privileges.sql
-- revokes anything absent from the registry.
SELECT afldb_meta.grant_app_read('external_grid_sources');
SELECT afldb_meta.grant_app_read('external_grids');
SELECT afldb_meta.grant_app_read('external_grid_axes');

-- DELIBERATELY NOT registered in afldb_meta.import_writable_tables.
--
-- grant_import_write() hands out UPDATE, DELETE and TRUNCATE, and
-- privileges.sql regenerates the whole set from that registry every run —
-- so a REVOKE here would be silently undone at the next reconcile and the
-- corpus would stop being immutable without anyone touching this file.
-- That is exactly the reasoning migration 074 applied to
-- promotion_decisions and migrations 066/073/078 applied to data_edits
-- and data_overrides, and it matters more here: the whole value of this
-- corpus is that a captured board cannot be quietly rewritten.
--
-- So the importer gets the narrow set its contract actually needs — read,
-- append, and the single column that supersedes a revision — and
-- privileges.sql re-grants exactly this after its revoke loop.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    -- Reference data seeded by this migration. Read only: the importer
    -- resolves a platform, it never registers one.
    GRANT SELECT ON external_grid_sources TO afldb_import;

    -- Append-only by grant: no DELETE, no TRUNCATE, and no UPDATE of any
    -- captured byte. is_current is the one mutable column, because
    -- superseding a revision is additive history, not a rewrite.
    GRANT SELECT, INSERT ON external_grids TO afldb_import;
    GRANT UPDATE (is_current) ON external_grids TO afldb_import;
    GRANT USAGE, SELECT ON SEQUENCE external_grids_id_seq TO afldb_import;

    GRANT SELECT, INSERT ON external_grid_axes TO afldb_import;
    GRANT USAGE, SELECT ON SEQUENCE external_grid_axes_id_seq TO afldb_import;
  END IF;
END
$$;
