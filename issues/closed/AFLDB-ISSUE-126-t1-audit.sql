-- AFLDB-ISSUE-126 T1 — restore the 92 pre-cutover auth_audit_log rows with their ORIGINAL ids.
--
-- Run on afldb-prod as the owner role, PGOPTIONS unset, after AFLDB-ISSUE-126-export.sh:
--   rehearsal (rolls back):  psql "$PROD_OWNER_DSN" -f issues/open/AFLDB-ISSUE-126-t1-audit.sql
--   real run:                psql "$PROD_OWNER_DSN" -v commit=1 -f issues/open/AFLDB-ISSUE-126-t1-audit.sql
-- PROD_OWNER_DSN is AFLDB_OWNER_DATABASE_URL with the database name forced to afldb_prod.
-- Refuses unless current_database() = afldb_prod, the session is read-write and
-- afldb_prod_auth_recovery still exists. Every count is asserted before and after the write.
-- Prints no secret: the staged rows carry event names, ips and named detail fields only.
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

CREATE TEMP TABLE i126_audit (
  id bigint, at timestamptz, actor_user_id integer, actor_label text,
  action text, detail jsonb, ip inet
) ON COMMIT DROP;
\copy i126_audit FROM '/home/arm/i126/audit.csv' WITH (FORMAT csv, HEADER)

-- Preconditions: the staged set is exactly the set measured on 2026-09-04 (§3.5), and
-- production is exactly as measured (11 rows, ids 16-26, nothing in 90-181).
DO $$
DECLARE s record; p record; seq bigint; u record;
BEGIN
  SELECT count(*) AS n, min(id) AS lo, max(id) AS hi, min(at) AS first, max(at) AS last,
         count(*) FILTER (WHERE actor_user_id IS NOT NULL AND actor_user_id <> 1) AS foreign_actor,
         count(*) FILTER (WHERE detail IS NOT NULL AND jsonb_typeof(detail) <> 'object') AS bad_detail,
         count(DISTINCT id) AS distinct_ids
    INTO s FROM i126_audit;
  IF s.n <> 92 OR s.lo <> 90 OR s.hi <> 181 OR s.distinct_ids <> 92 THEN
    RAISE EXCEPTION 'REFUSED staged set: % rows, ids %-% (expected 92 rows, 90-181)', s.n, s.lo, s.hi;
  END IF;
  IF s.first <> '2026-08-16 13:28:19.054484+10'::timestamptz
     OR s.last <> '2026-09-02 10:16:18.319137+10'::timestamptz THEN
    RAISE EXCEPTION 'REFUSED staged at-range % .. % differs from the measured range', s.first, s.last;
  END IF;
  IF s.foreign_actor <> 0 THEN RAISE EXCEPTION 'REFUSED: % staged rows name an actor other than user 1', s.foreign_actor; END IF;
  IF s.bad_detail <> 0 THEN RAISE EXCEPTION 'REFUSED: % staged rows have a non-object detail', s.bad_detail; END IF;

  SELECT count(*) AS n, min(id) AS lo, max(id) AS hi, min(at) AS first,
         count(*) FILTER (WHERE id BETWEEN 90 AND 181) AS overlap
    INTO p FROM auth_audit_log;
  IF p.n <> 11 OR p.lo <> 16 OR p.hi <> 26 THEN
    RAISE EXCEPTION 'REFUSED production auth_audit_log: % rows, ids %-% (expected 11 rows, 16-26); re-measure before restoring', p.n, p.lo, p.hi;
  END IF;
  IF p.overlap <> 0 THEN RAISE EXCEPTION 'REFUSED: production already holds % rows in id range 90-181', p.overlap; END IF;
  IF p.first <= s.last THEN RAISE EXCEPTION 'REFUSED: production rows are not all later than the staged rows'; END IF;

  SELECT last_value INTO seq FROM auth_audit_log_id_seq;
  IF seq <> 26 THEN RAISE EXCEPTION 'REFUSED: auth_audit_log_id_seq is at %, expected 26', seq; END IF;

  SELECT id, email, role, created_at INTO u FROM auth_users WHERE id = 1;
  IF u.id IS NULL OR u.role <> 'super_admin' OR u.created_at <> '2026-08-16 13:00:47.926753+10'::timestamptz THEN
    RAISE EXCEPTION 'REFUSED: auth_users id 1 is not the pre-cutover super admin';
  END IF;
  RAISE NOTICE 'preconditions OK: staged % rows (ids %-%), production % rows (ids %-%)', s.n, s.lo, s.hi, p.n, p.lo, p.hi;
END $$;

INSERT INTO auth_audit_log (id, at, actor_user_id, actor_label, action, detail, ip)
OVERRIDING SYSTEM VALUE
SELECT id, at, actor_user_id, actor_label, action, detail, ip FROM i126_audit ORDER BY id;

-- Post-assertions (max(id) comes from the rows; the sequence is advanced only on the real run, below).
DO $$
DECLARE n bigint; r bigint; hi bigint; keep bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE id BETWEEN 90 AND 181), max(id),
         count(*) FILTER (WHERE id BETWEEN 16 AND 26)
    INTO n, r, hi, keep FROM auth_audit_log;
  IF n <> 103 OR r <> 92 OR hi <> 181 OR keep <> 11 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: total %, restored %, max id %, post-cutover rows % (expected 103/92/181/11)', n, r, hi, keep;
  END IF;
  RAISE NOTICE 'post-check OK: % rows, 92 restored (ids 90-181), 11 post-cutover rows (ids 16-26) untouched', n;
END $$;

SELECT action, count(*) AS rows, min(at) AS first, max(at) AS last
  FROM auth_audit_log GROUP BY action ORDER BY min(at);

\if :commit
  -- setval is NOT transactional: a ROLLBACK does not undo it. The 2026-09-04 20:19 rehearsal left the
  -- production sequence at 181 (then 182 after the T6 rehearsal), so the sequence is touched only here.
  SELECT setval('auth_audit_log_id_seq', 181, true) AS sequence_now;
  COMMIT;
  \echo 'T1 COMMITTED'
\else
  ROLLBACK;
  \echo 'T1 REHEARSAL ONLY — rolled back; the sequence was not touched (re-run with -v commit=1 to apply)'
\endif
