-- AFLDB-ISSUE-126 T4 (optional) — restore the single pending beta_join_requests row.
--
--   rehearsal:  psql "$PROD_OWNER_DSN" -f issues/open/AFLDB-ISSUE-126-t4-join-request.sql
--   real run:   psql "$PROD_OWNER_DSN" -v commit=1 -f issues/open/AFLDB-ISSUE-126-t4-join-request.sql
-- Refuses if production already holds any join request or its sequence has been used.
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

CREATE TEMP TABLE i126_join (id integer, email text, name text, message text, status text,
  requested_at timestamptz, reviewed_by integer, reviewed_at timestamptz, ip inet, answers jsonb) ON COMMIT DROP;
\copy i126_join FROM '/home/arm/i126/join.csv' WITH (FORMAT csv, HEADER)

DO $$
DECLARE r record; p bigint; seq record;
BEGIN
  SELECT count(*) INTO p FROM beta_join_requests;
  IF p <> 0 THEN RAISE EXCEPTION 'REFUSED: production beta_join_requests has % rows (expected 0)', p; END IF;
  SELECT last_value, is_called INTO seq FROM beta_join_requests_id_seq;
  IF seq.is_called THEN RAISE EXCEPTION 'REFUSED: beta_join_requests_id_seq has been used (last_value %)', seq.last_value; END IF;
  IF (SELECT count(*) FROM i126_join) <> 1 THEN RAISE EXCEPTION 'REFUSED: expected exactly 1 staged row'; END IF;
  SELECT * INTO r FROM i126_join;
  IF r.id <> 1 OR r.status <> 'pending' OR r.reviewed_by IS NOT NULL
     OR r.requested_at <> '2026-08-16 20:32:13.27126+10'::timestamptz THEN
    RAISE EXCEPTION 'REFUSED: staged row differs from the measured row (id %, status %, requested %)', r.id, r.status, r.requested_at;
  END IF;
  RAISE NOTICE 'preconditions OK';
END $$;

INSERT INTO beta_join_requests (id, email, name, message, status, requested_at, reviewed_by, reviewed_at, ip, answers)
OVERRIDING SYSTEM VALUE
SELECT id, email, name, message, status, requested_at, reviewed_by, reviewed_at, ip, answers FROM i126_join;

SELECT setval('beta_join_requests_id_seq', 1, true) AS sequence_now;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM beta_join_requests;
  IF n <> 1 THEN RAISE EXCEPTION 'POST-CHECK FAILED: % rows (expected 1)', n; END IF;
  RAISE NOTICE 'post-check OK: 1 pending join request';
END $$;

SELECT id, left(email, 2) || '***@' || split_part(email, '@', 2) AS email_masked, status, requested_at
  FROM beta_join_requests;

\if :commit
  COMMIT;
  \echo 'T4 COMMITTED'
\else
  ROLLBACK;
  \echo 'T4 REHEARSAL ONLY — rolled back (re-run with -v commit=1 to apply)'
\endif
