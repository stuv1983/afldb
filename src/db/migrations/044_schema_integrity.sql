-- =====================================================================
-- AFLDB 044 — Constraints and indexes the design review found missing
-- =====================================================================
-- Six unrelated gaps, all of the same kind: something the data happens to
-- satisfy today that nothing in the schema requires, or an index whose
-- shape does not match the query that needs it. None is a live defect.
-- Each is a rule that exists only in prose, or in the habits of the one
-- program that currently writes the table.
--
-- The privilege half of the same review is migration 045.
--
-- Two of these add a constraint to existing data, so each is preceded by
-- a check that raises a description of what is wrong rather than letting
-- PostgreSQL report a bare unique violation on a constraint name nobody
-- recognises yet. The whole migration is one transaction: a failure here
-- leaves the database exactly as it was.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Source-scoped natural keys for the two tables 042 did not reach
-- --------------------------------------------------------------------
-- player_relationships and father_son_selections (migration 006) declare
-- `source_record_id text UNIQUE` — the column on its own. Every other
-- table that carries a source key scopes it by the source that issued it:
-- external_identities is UNIQUE (source_id, external_id) (002), and
-- migration 042 gave award_winners, award_nominations and captaincies
-- UNIQUE NULLS NOT DISTINCT (source_id, source_record_id).
--
-- The bare form is wrong twice over:
--
--   * It makes a second source unloadable. Two sources that both number
--     their records from 1 collide on the first row, though they describe
--     different facts from different places.
--   * A plain UNIQUE treats NULLs as distinct, so any row without a
--     source key is exempt from the constraint entirely — the exact
--     failure mode 042's commentary says NULLS NOT DISTINCT exists to
--     stop, sitting in the two tables 042 happened not to cover.
--
-- The existing constraint is found by its shape rather than by name, so
-- this works whichever name PostgreSQL generated for it.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT rel.relname AS table_name, con.conname
      FROM pg_constraint con
      JOIN pg_class rel     ON rel.oid = con.conrelid
      JOIN pg_namespace n   ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public'
       AND rel.relname IN ('player_relationships', 'father_son_selections')
       AND con.contype = 'u'
       AND cardinality(con.conkey) = 1
       AND con.conkey[1] = (
             SELECT attnum FROM pg_attribute
              WHERE attrelid = rel.oid AND attname = 'source_record_id'
           )
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', c.table_name, c.conname);
    RAISE NOTICE 'dropped single-column %.%', c.table_name, c.conname;
  END LOOP;
END
$$;

-- GROUP BY already treats NULLs as equal, which is precisely the rule
-- NULLS NOT DISTINCT applies, so this counts exactly what the constraint
-- would reject.
DO $$
DECLARE
  t text;
  clashes bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['player_relationships', 'father_son_selections'] LOOP
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM public.%I '
      'GROUP BY source_id, source_record_id HAVING count(*) > 1) d', t)
      INTO clashes;
    IF clashes > 0 THEN
      RAISE EXCEPTION
        '% has % (source_id, source_record_id) group(s) with more than one row, '
        'so it cannot take a NULLS NOT DISTINCT unique key yet. Inspect them with: '
        'SELECT source_id, source_record_id, count(*) FROM % '
        'GROUP BY 1, 2 HAVING count(*) > 1; '
        'Rows with a NULL source_record_id count as duplicates of each other -- '
        'give them their source''s own record id, or delete the duplicates, then re-run.',
        t, clashes, t;
    END IF;
  END LOOP;
END
$$;

ALTER TABLE player_relationships
  ADD CONSTRAINT player_relationships_source_uq
  UNIQUE NULLS NOT DISTINCT (source_id, source_record_id);

ALTER TABLE father_son_selections
  ADD CONSTRAINT father_son_selections_source_uq
  UNIQUE NULLS NOT DISTINCT (source_id, source_record_id);

COMMENT ON CONSTRAINT player_relationships_source_uq ON player_relationships IS
  'The source''s own record identity, scoped by source. Replaces a bare UNIQUE on '
  'source_record_id, which forbade a second source and exempted null-keyed rows.';
COMMENT ON CONSTRAINT father_son_selections_source_uq ON father_son_selections IS
  'The source''s own record identity, scoped by source. See player_relationships_source_uq.';

-- --------------------------------------------------------------------
-- 2. Email uniqueness that survives a capital letter
-- --------------------------------------------------------------------
-- auth_users.email, beta_allowed_emails.email (023) and the one-live-
-- request-per-address index on beta_join_requests (024) are all byte-wise
-- unique, so Foo@example.com and foo@example.com are two different admin
-- accounts, two allowlist entries, and two simultaneous pending requests.
--
-- Every write path lowercases before it stores — login, the invite flow,
-- /admin/access, the beta gate, the early-access API and the email intake
-- all call .trim().toLowerCase() — so nothing produces such a pair today.
-- That is the point: the rule is real and is enforced in seven places in
-- application code, none of which the database knows about. An eighth
-- write path that forgets creates a second account for an address the
-- allowlist check will then match only sometimes.
--
-- These are added ALONGSIDE the existing unique constraints rather than
-- replacing them: `ON CONFLICT (email)` in the invite and allowlist
-- upserts needs an index on the bare column to arbitrate against.
DO $$
DECLARE
  spec CONSTANT text[][] := ARRAY[
    ['auth_users',          ''],
    ['beta_allowed_emails', ''],
    ['beta_join_requests',  'WHERE status = ''pending''']
  ];
  i int;
  clashes bigint;
BEGIN
  FOR i IN 1 .. array_length(spec, 1) LOOP
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM public.%I %s '
      'GROUP BY lower(email) HAVING count(*) > 1) d', spec[i][1], spec[i][2])
      INTO clashes;
    IF clashes > 0 THEN
      RAISE EXCEPTION
        '% holds % address(es) that differ only by letter case, so a '
        'case-insensitive unique index cannot be built. Inspect them with: '
        'SELECT lower(email), count(*) FROM % GROUP BY 1 HAVING count(*) > 1; '
        'Merge or remove the duplicates -- deciding which account survives is '
        'not something a migration may do on its own -- then re-run.',
        spec[i][1], clashes, spec[i][1];
    END IF;
  END LOOP;
END
$$;

CREATE UNIQUE INDEX uq_auth_users_email_lower
  ON auth_users (lower(email));
CREATE UNIQUE INDEX uq_beta_allowed_emails_lower
  ON beta_allowed_emails (lower(email));
CREATE UNIQUE INDEX uq_beta_join_requests_pending_email_lower
  ON beta_join_requests (lower(email)) WHERE status = 'pending';

COMMENT ON INDEX uq_auth_users_email_lower IS
  'One account per address regardless of case. The application lowercases on every '
  'write path; this is the guarantee that does not depend on it remembering to.';

-- --------------------------------------------------------------------
-- 3. Foreign-key indexes the integrity check can actually use
-- --------------------------------------------------------------------
-- Four indexes cover a player_id foreign key but are partial on the link
-- status:
--
--   ix_external_identities_player   WHERE status IN ('unique','resolved')
--   ix_award_winners_player         WHERE link_status_value IN (...)
--   ix_captaincies_player           WHERE link_status_value IN (...)
--   ix_draft_player                 WHERE link_status_value IN (...)
--
-- They serve the reads they were built for. What they cannot serve is the
-- reason a foreign key wants an index in the first place: deleting a
-- player makes PostgreSQL prove no child row references it, and that
-- probe is `WHERE player_id = $1` with no mention of link status. A
-- partial index is only usable when the query implies its predicate, so
-- every one of these tables is sequentially scanned instead.
--
-- Migration 041 already established the shape that works — `WHERE
-- player_id IS NOT NULL` (ix_honour_team_player) — which the delete probe
-- does imply, since it is looking for a specific non-null id. That
-- predicate is also a superset of the link-status one, so the reads keep
-- their index and re-check the status against the heap row they were
-- going to fetch anyway.
--
-- Each keeps its name: same purpose, wider predicate.
-- IF EXISTS on the drops, as migration 041 used: these run against
-- databases that have been restored with --no-privileges and rebuilt more
-- than once, and a missing index should not stop the rest of the file.
DROP INDEX IF EXISTS ix_external_identities_player;
CREATE INDEX ix_external_identities_player
  ON external_identities (player_id) WHERE player_id IS NOT NULL;

DROP INDEX IF EXISTS ix_award_winners_player;
CREATE INDEX ix_award_winners_player
  ON award_winners (player_id) WHERE player_id IS NOT NULL;

DROP INDEX IF EXISTS ix_captaincies_player;
CREATE INDEX ix_captaincies_player
  ON captaincies (player_id) WHERE player_id IS NOT NULL;

DROP INDEX IF EXISTS ix_draft_player;
CREATE INDEX ix_draft_player
  ON draft_picks (player_id) WHERE player_id IS NOT NULL;

COMMENT ON INDEX ix_award_winners_player IS
  'Predicated on player_id IS NOT NULL rather than on link status, so the foreign '
  'key check behind a players delete can use it as well as the honours queries.';

-- --------------------------------------------------------------------
-- 4. The validator's vocabulary, enforced
-- --------------------------------------------------------------------
-- data_submission_rows.verdict (023) documents 'ok | warning | error' in
-- a comment and accepts anything. It is the only status-like column in
-- the schema without a CHECK or an enum behind it, and it gates approval:
-- promoteSubmission refuses a submission when any row reads 'error', so a
-- typo'd verdict is a row that silently stops blocking.
--
-- NULL stays legal and means "staged, not yet validated", which is the
-- state every row is inserted in.
ALTER TABLE data_submission_rows
  ADD CONSTRAINT data_submission_rows_verdict_ck
  CHECK (verdict IS NULL OR verdict IN ('ok', 'warning', 'error'));

COMMENT ON COLUMN data_submission_rows.verdict IS
  'ok, warning or error, or NULL while the row is staged and not yet validated. '
  'Enforced: an unrecognised verdict would neither block approval nor show as a warning.';

-- --------------------------------------------------------------------
-- 5. site_media.byte_size must describe the bytes it sits next to
-- --------------------------------------------------------------------
-- 037 constrains this table thoroughly — the name is a safe filename, the
-- MIME type is an allowlist, the dimensions are positive — and then lets
-- byte_size be any positive number at all. It is written as bytes.length
-- by the one uploader, and it is what /admin/content reports and what the
-- 2 MB-per-image ceiling is checked against after the fact.
ALTER TABLE site_media
  ADD CONSTRAINT site_media_byte_size_matches_bytes
  CHECK (byte_size = octet_length(bytes));

COMMENT ON COLUMN site_media.byte_size IS
  'Size of the bytes column, enforced equal to octet_length(bytes) so the figure '
  'shown at /admin/content cannot drift from the image it describes.';

-- --------------------------------------------------------------------
-- 6. Three notes that correct or record a decision
-- --------------------------------------------------------------------

-- (a) Migration 017 introduces clubs_org_span_ck under a comment reading
-- "Every organization must have at least one identity, and an identity
-- cannot belong to an organization that does not exist". The constraint
-- underneath checks neither: it checks that a club's season span runs
-- forwards. The second half of that sentence is the organization_id
-- foreign key's job; the first half is enforced by the importer and
-- tools/validation/validate_migration.py, because migration 021 had to
-- drop the NOT NULL to make a full reload possible. 017 cannot be edited
-- — the runner checksums applied migrations — so the constraint says what
-- it does here instead.
COMMENT ON CONSTRAINT clubs_org_span_ck ON clubs IS
  'A club identity''s first season is not after its last. Despite the comment above '
  'it in migration 017, this says nothing about organizations: the FK covers the '
  'reference, and "every identity has an organization" is enforced by the importer '
  'and the migration validator, since 021 dropped the NOT NULL for reloads.';

-- (b) The provenance foreign keys (add_provenance_columns, migration 001,
-- and the same quartet spelled out on the fact tables) are deliberately
-- unindexed. Recorded here because migration 041 set the rule that every
-- index names its caller, and the absence of these deserves the same
-- explicitness as a presence would.
COMMENT ON COLUMN player_match_stats.import_batch_id IS
  'Provenance. Deliberately unindexed, here and on every other table carrying the '
  'provenance quartet: import_batches and sources are append-only, so nothing '
  'deletes a parent and no read path filters 694K rows by batch. An index becomes '
  'necessary the day old batches are pruned -- that job must add one first, or each '
  'delete sequentially scans this table.';

-- (c) The review asked whether uq_award_winners_source and
-- uq_award_nominations_source (023) — UNIQUE (award_id, source_record_id)
-- WHERE source_record_id IS NOT NULL — became redundant when 042 added
-- UNIQUE NULLS NOT DISTINCT (source_id, source_record_id). They did not,
-- and they are kept.
--
-- They are the live ON CONFLICT arbiters in src/lib/ingest/datasets.ts
-- (the rising_star and all_australian promotions), and the two keys are
-- not interchangeable: every submission promotes under the single
-- 'sports_data_lab' source id, so source_id is constant and
-- (source_id, source_record_id) reduces to the record id alone, while the
-- ids those datasets generate — "1984:Robert Flower:Melbourne" — carry no
-- award. Switching the arbiter would let a promotion of one award update
-- another award's row. Making it safe means award-scoping the generated
-- record ids, which changes the key of every row already promoted and so
-- belongs to its own migration with a backfill, not to a tidy-up.
COMMENT ON INDEX uq_award_winners_source IS
  'ON CONFLICT arbiter for the all_australian promotion. Not made redundant by '
  'award_winners_source_uq (042): submissions all share one source id, so that '
  'constraint cannot distinguish two awards carrying the same source record id.';
COMMENT ON INDEX uq_award_nominations_source IS
  'ON CONFLICT arbiter for the rising_star promotion. See uq_award_winners_source.';
