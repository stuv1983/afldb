-- AFLDB-ISSUE-265 D-265-13: read-only settle timing evidence for afldb_prod.
--
-- Operator-run only (runbook §16). Requires psql (it uses \gset and \if).
-- Read-only transaction, 30 s statement timeout, target proof before any data read.
-- It prints no credentials: role and database names only.
--
-- Source of every figure: public.import_batches (migration 001_foundations.sql:54-69).
-- Each settle run opens one row INSIDE its own transaction and stamps it on the way out:
--   AFL Tables: tool 'settle-afltables.ts'  (settle-afltables.ts:1839-1847, closed :1942-1948)
--   AFL API:    tool 'settle-afl-api.ts'    (settle-afl-api.ts:179, :1906-1913, closed by
--               settle-core.ts:1060-1086 finalizeSettleImportBatch)
-- Evidence limits (runbook §16.1):
--   * A run that rolls back (failure, dry run, HALT, --require-complete-source refusal) leaves NO row.
--     These records can show only committed runs, never failures.
--   * started_at defaults to now() = the settle TRANSACTION start, after acquisition.
--   * AFL Tables closes with completed_at = now(), the transaction start again, so its duration is NOT
--     recorded (completed_at = started_at). AFL API closes with clock_timestamp(), so it is recorded,
--     from transaction start to just before commit. The query classifies each row; it never assumes.
--   * Rows show when runs happened. They cannot prove the installed systemd timer schedule.
--
-- Exit status (psql, with ON_ERROR_STOP on, which the first line below sets and the operator command
-- also passes as -v ON_ERROR_STOP=1 before the script is read):
--   0  every section ran; '== Done.' is the last line.
--   3  a REFUSED target or schema proof (each raises a deliberate error after its ROLLBACK, because
--      \quit would exit 0), or ANY failed statement (missing column or type, statement_timeout, ...).
--   2  the connection failed or was lost;  1  psql's own fatal error (for example no input).
-- A run that does not end in '== Done.' with status 0 is not evidence.

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset null '(null)'
\pset footer on

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

\echo '== 0. Target proof'
SELECT current_database()                         AS database,
       current_user                               AS role,
       inet_server_addr()                         AS server_addr,
       inet_server_port()                         AS server_port,
       pg_is_in_recovery()                        AS in_recovery,
       current_setting('server_version')          AS server_version,
       current_setting('transaction_read_only')   AS transaction_read_only,
       current_setting('statement_timeout')       AS statement_timeout,
       current_setting('TimeZone')                AS session_timezone,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC' AS db_now;

SELECT (current_database() = 'afldb_prod'
        AND current_setting('transaction_read_only') = 'on') AS target_ok \gset
\if :target_ok
\echo 'TARGET OK: afldb_prod, read-only transaction.'
\else
\echo 'REFUSED: the database is not afldb_prod, or the transaction is not read-only. Nothing was read.'
ROLLBACK;
-- \quit would exit 0; this error ends psql with status 3 under ON_ERROR_STOP.
DO $$ BEGIN RAISE EXCEPTION 'AFLDB-ISSUE-265 timing query REFUSED: target proof failed'; END $$;
\endif

\echo '== 1. Schema proof (the import_batches columns this query reads, and the import_status labels)'
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'import_batches'
   AND column_name IN ('id', 'tool', 'started_at', 'completed_at', 'status', 'notes', 'validation_result')
 ORDER BY column_name;

SELECT count(*) = 7 AS schema_ok
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'import_batches'
   AND column_name IN ('id', 'tool', 'started_at', 'completed_at', 'status', 'notes', 'validation_result') \gset
\if :schema_ok
\echo 'SCHEMA OK: all seven columns present.'
\else
\echo 'REFUSED: import_batches does not have the expected columns; no metric is reported.'
ROLLBACK;
-- \quit would exit 0; this error ends psql with status 3 under ON_ERROR_STOP.
DO $$ BEGIN RAISE EXCEPTION 'AFLDB-ISSUE-265 timing query REFUSED: schema proof failed'; END $$;
\endif

SELECT enum_range(NULL::import_status)::text AS import_status_labels;

\echo '== 2. Coverage, all time (are there any settle rows at all, and how old)'
SELECT p.provider,
       count(b.id)                                                        AS rows_all_time,
       to_char(min(b.started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS first_start_utc,
       to_char(max(b.started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS last_start_utc,
       count(b.id) FILTER (WHERE b.started_at >= now() - interval '30 days') AS rows_last_30_days
  FROM (VALUES ('afltables', 'settle-afltables.ts'), ('afl_api', 'settle-afl-api.ts')) AS p(provider, tool)
  LEFT JOIN import_batches b ON b.tool = p.tool
 GROUP BY p.provider
 ORDER BY p.provider;

\echo '== 3. Every run in the last 30 days (database time; the start is the settle transaction start)'
WITH runs AS (
  SELECT b.id,
         CASE b.tool WHEN 'settle-afltables.ts' THEN 'afltables' ELSE 'afl_api' END AS provider,
         b.status::text AS status, b.started_at, b.completed_at, b.notes, b.validation_result
    FROM import_batches b
   WHERE b.tool IN ('settle-afltables.ts', 'settle-afl-api.ts')
     AND b.started_at >= now() - interval '30 days'
)
SELECT provider,
       id::text                                                                          AS batch_id,
       status,
       to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')                   AS started_utc,
       to_char(started_at AT TIME ZONE 'Australia/Melbourne', 'YYYY-MM-DD HH24:MI:SS')   AS started_melbourne,
       to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')                 AS completed_utc,
       CASE WHEN completed_at IS NULL           THEN 'no_end_time'
            WHEN completed_at =  started_at     THEN 'not_recorded'
            WHEN completed_at <  started_at     THEN 'inconsistent'
            ELSE 'recorded' END                                                           AS duration_basis,
       CASE WHEN completed_at > started_at
            THEN round(extract(epoch FROM completed_at - started_at)::numeric, 1) END     AS duration_s,
       substring(notes FROM 'season=([0-9]{4})')                                          AS season,
       substring(notes FROM 'mode=([a-z-]+)')                                             AS mode,
       (notes LIKE '%auto-apply%')                                                        AS auto_apply,
       validation_result ->> 'canonicalApplyFailures'                                     AS apply_failures
  FROM runs
 ORDER BY provider, started_at, id;

\echo '== 4. Run counts and recorded outcomes, last 30 days (committed runs only; rollbacks leave no row)'
WITH runs AS (
  SELECT CASE b.tool WHEN 'settle-afltables.ts' THEN 'afltables' ELSE 'afl_api' END AS provider,
         b.status::text AS status,
         CASE WHEN b.completed_at IS NULL       THEN 'no_end_time'
              WHEN b.completed_at = b.started_at THEN 'not_recorded'
              WHEN b.completed_at < b.started_at THEN 'inconsistent'
              ELSE 'recorded' END AS duration_basis,
         CASE WHEN b.validation_result IS NULL THEN NULL
              ELSE coalesce((b.validation_result ->> 'canonicalApplyFailures')::int, 0) > 0 END AS had_apply_failures
    FROM import_batches b
   WHERE b.tool IN ('settle-afltables.ts', 'settle-afl-api.ts')
     AND b.started_at >= now() - interval '30 days'
)
SELECT provider, status, duration_basis,
       count(*)                                         AS runs,
       count(*) FILTER (WHERE had_apply_failures)        AS runs_with_canonical_apply_failures,
       count(*) FILTER (WHERE had_apply_failures IS NULL) AS runs_without_counters
  FROM runs
 GROUP BY provider, status, duration_basis
 ORDER BY provider, status, duration_basis;

\echo '== 5. Duration statistics, last 30 days (recorded durations only; n = samples behind each figure)'
WITH runs AS (
  SELECT CASE b.tool WHEN 'settle-afltables.ts' THEN 'afltables' ELSE 'afl_api' END AS provider,
         b.id,
         CASE WHEN b.completed_at > b.started_at
              THEN extract(epoch FROM b.completed_at - b.started_at)::double precision END AS duration_s
    FROM import_batches b
   WHERE b.tool IN ('settle-afltables.ts', 'settle-afl-api.ts')
     AND b.started_at >= now() - interval '30 days'
)
SELECT p.provider,
       count(r.id)                                                                      AS runs_in_window,
       count(r.duration_s)                                                              AS duration_samples,
       round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY r.duration_s))::numeric, 1)  AS median_s,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY r.duration_s))::numeric, 1)  AS p95_s,
       round(max(r.duration_s)::numeric, 1)                                             AS max_s,
       round(min(r.duration_s)::numeric, 1)                                             AS min_s,
       CASE WHEN count(r.duration_s) = 0  THEN 'no recorded duration: metric not available'
            WHEN count(r.duration_s) < 20 THEN 'p95 weak: fewer than 20 samples'
            ELSE 'ok' END                                                               AS note
  FROM (VALUES ('afltables'), ('afl_api')) AS p(provider)
  LEFT JOIN runs r ON r.provider = p.provider
 GROUP BY p.provider
 ORDER BY p.provider;

\echo '== 6a. Overlapping recorded intervals, last 30 days (both ends recorded)'
WITH runs AS (
  SELECT b.id,
         CASE b.tool WHEN 'settle-afltables.ts' THEN 'afltables' ELSE 'afl_api' END AS provider,
         b.started_at, b.completed_at
    FROM import_batches b
   WHERE b.tool IN ('settle-afltables.ts', 'settle-afl-api.ts')
     AND b.started_at >= now() - interval '30 days'
     AND b.completed_at > b.started_at
)
SELECT a.provider AS provider_a, a.id::text AS batch_a,
       b.provider AS provider_b, b.id::text AS batch_b,
       to_char(greatest(a.started_at, b.started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS overlap_from_utc,
       round(extract(epoch FROM least(a.completed_at, b.completed_at)
                              - greatest(a.started_at, b.started_at))::numeric, 1)            AS overlap_s
  FROM runs a
  JOIN runs b ON a.id < b.id
             AND a.started_at < b.completed_at
             AND b.started_at < a.completed_at
 ORDER BY overlap_from_utc;

\echo '== 6b. Runs with no recorded duration whose START falls inside another run''s recorded interval'
WITH runs AS (
  SELECT b.id,
         CASE b.tool WHEN 'settle-afltables.ts' THEN 'afltables' ELSE 'afl_api' END AS provider,
         b.started_at, b.completed_at
    FROM import_batches b
   WHERE b.tool IN ('settle-afltables.ts', 'settle-afl-api.ts')
     AND b.started_at >= now() - interval '30 days'
)
SELECT p.provider AS point_provider, p.id::text AS point_batch,
       i.provider AS interval_provider, i.id::text AS interval_batch,
       to_char(p.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS point_start_utc
  FROM runs p
  JOIN runs i ON i.id <> p.id
             AND i.completed_at > i.started_at
             AND p.started_at >= i.started_at
             AND p.started_at <= i.completed_at
 WHERE p.completed_at IS NULL OR p.completed_at <= p.started_at
 ORDER BY point_start_utc;

\echo '== 6c. Overlap assessability, last 30 days'
SELECT CASE b.tool WHEN 'settle-afltables.ts' THEN 'afltables' ELSE 'afl_api' END AS provider,
       count(*) FILTER (WHERE b.completed_at > b.started_at)                      AS runs_with_interval,
       count(*) FILTER (WHERE b.completed_at IS NULL OR b.completed_at <= b.started_at) AS runs_point_only_overlap_unassessable
  FROM import_batches b
 WHERE b.tool IN ('settle-afltables.ts', 'settle-afl-api.ts')
   AND b.started_at >= now() - interval '30 days'
 GROUP BY 1
 ORDER BY 1;

\echo '== 7. Recorded start hours, last 30 days (when runs happened; NOT proof of the installed timer)'
SELECT CASE b.tool WHEN 'settle-afltables.ts' THEN 'afltables' ELSE 'afl_api' END AS provider,
       to_char(b.started_at AT TIME ZONE 'Australia/Melbourne', 'HH24') AS melbourne_hour,
       to_char(b.started_at AT TIME ZONE 'UTC', 'HH24')                 AS utc_hour,
       count(*)                                                         AS runs
  FROM import_batches b
 WHERE b.tool IN ('settle-afltables.ts', 'settle-afl-api.ts')
   AND b.started_at >= now() - interval '30 days'
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;

\echo '== 8. Evidence limitations (all time unless stated)'
SELECT CASE b.tool WHEN 'settle-afltables.ts' THEN 'afltables' ELSE 'afl_api' END AS provider,
       count(*) FILTER (WHERE b.status::text = 'running')                          AS running_rows_all_time,
       count(*) FILTER (WHERE b.status::text IN ('failed', 'rolled_back'))         AS failed_or_rolled_back_rows_all_time,
       count(*) FILTER (WHERE b.status::text = 'completed' AND b.completed_at IS NULL) AS completed_without_end_time,
       count(*) FILTER (WHERE b.completed_at < b.started_at)                       AS end_before_start,
       count(*) FILTER (WHERE b.validation_result IS NULL)                         AS rows_without_counters,
       count(*) FILTER (WHERE b.started_at >= now() - interval '30 days'
                          AND b.completed_at = b.started_at)                       AS last_30d_duration_not_recorded
  FROM import_batches b
 WHERE b.tool IN ('settle-afltables.ts', 'settle-afl-api.ts')
 GROUP BY 1
 ORDER BY 1;

ROLLBACK;
\echo '== Done. Read-only transaction rolled back; nothing was written.'
