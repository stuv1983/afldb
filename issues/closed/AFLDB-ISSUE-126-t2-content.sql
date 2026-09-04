-- AFLDB-ISSUE-126 T2 — restore the 7 operator-override site_settings rows and the 1 site_media row.
--
--   rehearsal:  psql "$PROD_OWNER_DSN" -f issues/open/AFLDB-ISSUE-126-t2-content.sql
--   real run:   psql "$PROD_OWNER_DSN" -v commit=1 -f issues/open/AFLDB-ISSUE-126-t2-content.sql
-- Refuses if production already holds ANY site_settings or site_media row (someone saved
-- settings since the 2026-09-04 measurement — stop and re-decide), or if a staged value's
-- md5 differs from the one measured read-only in the recovery database (runbook §3.3).
-- The four keys equal to compiled defaults are deliberately NOT restored.
\set ON_ERROR_STOP on
\if :{?commit}
\else
  \set commit 0
\endif
SELECT current_database() = 'afldb_prod'                                          AS ok_db,
       current_setting('default_transaction_read_only') = 'off'                   AS ok_rw,
       EXISTS (SELECT 1 FROM pg_database WHERE datname = 'afldb_prod_auth_recovery') AS ok_recovery
\gset
\if :ok_db
\else
  \echo 'REFUSED: this script runs against afldb_prod only'
  \quit
\endif
\if :ok_rw
\else
  \echo 'REFUSED: session is read-only (unset PGOPTIONS)'
  \quit
\endif
\if :ok_recovery
\else
  \echo 'REFUSED: afldb_prod_auth_recovery must still exist'
  \quit
\endif

BEGIN;

CREATE TEMP TABLE i126_settings (key text, value jsonb, updated_at timestamptz, updated_by integer) ON COMMIT DROP;
CREATE TEMP TABLE i126_media (name text, mime text, bytes bytea, byte_size integer, width integer,
                              height integer, alt text, uploaded_at timestamptz, uploaded_by integer) ON COMMIT DROP;
\copy i126_settings FROM '/home/arm/i126/settings.csv' WITH (FORMAT csv, HEADER)
\copy i126_media FROM '/home/arm/i126/media.csv' WITH (FORMAT csv, HEADER)

CREATE TEMP TABLE i126_expected (key text PRIMARY KEY, md5 text NOT NULL) ON COMMIT DROP;
INSERT INTO i126_expected VALUES
  ('apex.content',            'ae55790ba330126f651b2e3679fb5979'),
  ('early_access.intro',      '374e60c9e0004f6fb547c373c015fa61'),
  ('early_access.notify',     'ebc576222020c2a2ae2fc769169f1d2a'),
  ('early_access.questions',  '809973713c551ce4249971220dbb1a17'),
  ('home.aflw_leaders',       '5e77934b05c7ad04e1bfeace24db12de'),
  ('home.record_of_the_week', 'bbf84626ac30cd0da3f87cff8feece22'),
  ('site.footer',             '84df03c00994145c9c9f3c676f4943b2');

DO $$
DECLARE n bigint; bad bigint; m record; p_settings bigint; p_media bigint; owner_ok boolean;
BEGIN
  SELECT count(*) INTO p_settings FROM site_settings;
  SELECT count(*) INTO p_media FROM site_media;
  IF p_settings <> 0 THEN RAISE EXCEPTION 'REFUSED: production site_settings has % rows (expected 0) — settings were saved after the measurement', p_settings; END IF;
  IF p_media <> 0 THEN RAISE EXCEPTION 'REFUSED: production site_media has % rows (expected 0)', p_media; END IF;

  SELECT count(*) INTO n FROM i126_settings;
  IF n <> 7 THEN RAISE EXCEPTION 'REFUSED: staged % settings rows, expected 7', n; END IF;
  SELECT count(*) INTO bad
    FROM i126_expected e FULL JOIN i126_settings s USING (key)
   WHERE s.key IS NULL OR e.key IS NULL OR md5(s.value::text) <> e.md5;
  IF bad <> 0 THEN RAISE EXCEPTION 'REFUSED: % staged settings rows differ from the measured keys/md5s', bad; END IF;
  SELECT count(*) INTO bad FROM i126_settings WHERE updated_by IS DISTINCT FROM 1;
  IF bad <> 0 THEN RAISE EXCEPTION 'REFUSED: % staged settings rows have updated_by <> 1', bad; END IF;

  SELECT * INTO m FROM i126_media;
  IF m.name IS DISTINCT FROM 'screenshot-2026-08-16-175814.png' OR m.byte_size <> 81118
     OR length(m.bytes) <> m.byte_size OR m.mime <> 'image/png' OR m.width <> 1903 OR m.height <> 909 THEN
    RAISE EXCEPTION 'REFUSED: staged media row differs from the measured row';
  END IF;
  IF (SELECT count(*) FROM i126_media) <> 1 THEN RAISE EXCEPTION 'REFUSED: expected exactly 1 staged media row'; END IF;

  SELECT EXISTS (SELECT 1 FROM auth_users WHERE id = 1 AND role = 'super_admin') INTO owner_ok;
  IF NOT owner_ok THEN RAISE EXCEPTION 'REFUSED: auth_users id 1 is not the super admin'; END IF;
  RAISE NOTICE 'preconditions OK: 7 settings rows and 1 media row staged; production empty';
END $$;

INSERT INTO site_settings (key, value, updated_at, updated_by)
SELECT key, value, updated_at, updated_by FROM i126_settings ORDER BY key;

INSERT INTO site_media (name, mime, bytes, byte_size, width, height, alt, uploaded_at, uploaded_by)
SELECT name, mime, bytes, byte_size, width, height, alt, uploaded_at, uploaded_by FROM i126_media;

DO $$
DECLARE s bigint; m bigint;
BEGIN
  SELECT count(*) INTO s FROM site_settings;
  SELECT count(*) INTO m FROM site_media;
  IF s <> 7 OR m <> 1 THEN RAISE EXCEPTION 'POST-CHECK FAILED: site_settings %, site_media % (expected 7, 1)', s, m; END IF;
  RAISE NOTICE 'post-check OK: site_settings 7, site_media 1';
END $$;

SELECT key, updated_at, updated_by, md5(value::text) AS md5,
       CASE WHEN key = 'apex.content' THEN '(document)' ELSE left(value::text, 80) END AS value
  FROM site_settings ORDER BY key;
SELECT name, mime, byte_size, width, height, uploaded_at, uploaded_by FROM site_media;

\if :commit
  COMMIT;
  \echo 'T2 COMMITTED'
\else
  ROLLBACK;
  \echo 'T2 REHEARSAL ONLY — rolled back (re-run with -v commit=1 to apply)'
\endif
