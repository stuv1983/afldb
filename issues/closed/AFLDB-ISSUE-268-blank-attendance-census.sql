-- AFLDB-ISSUE-268: read-only census of blank `match_attendance` cells in legacy CSV submissions.
--
-- Operator-run only (runbook issues/open/AFLDB-ISSUE-268.md §14 step 2 and §17.4).
--
-- RUN STATUS (recorded 2026-10-09; runbook §17.14). RUN ONCE ON EACH OF DEV AND PROD, BY THE OPERATOR:
--   DEV   snapshot 2026-10-09 15:59:22.305028+11, afldb_dev as afldb_import, PostgreSQL 16.15, read-only
--         repeatable-read transaction, completed through `== Done.`; the operator block returned successfully.
--   PROD  snapshot 2026-10-09 16:02:57.217989+11, afldb_prod as postgres over the socket, PostgreSQL 16.15,
--         read-only repeatable-read transaction, completed through `== Done.`; psql exit status 0 (explicit).
--   Both: Section 1 no retained match_attendance submissions; Sections 2-3 no rows (every Section 2 summary count
--   zero); Section 4 no rows (manual_zero_crowd_matches = 0); Section 5 no rows (match_attendance_batches,
--   with_retained_submission and without_retained_submission all zero). Every statement parsed on both databases.
--   Because no submission was retained, NO populated row was classified: the cell_state / state_vs_promotion /
--   evidence-kind logic below was NOT exercised against data. No exposure was found in the records checked.
--   Historical impact remains UNASSESSED (the census reads retained submissions and current match state only).
--   Nothing was repaired. Running this census installed nothing: it is read-only and does not install the fix.
--
-- HISTORICAL (superseded by the run status above): written 2026-10-09 (evidence labels revised twice the same day,
-- see the FOUR KINDS OF EVIDENCE block and runbook §17.8, §17.12) by inspection against migrations 001
-- (import_batches, sources), 020, 023 and 044 (verdict values) and src/lib/ingest/{pipeline,csv}.ts and
-- src/app/admin/submissions/[id]/actions.ts, and not executed at the time of writing, so its first run was also its
-- first syntax check. Read-only transaction, 30 s statement timeout. Prints no
-- credentials: role and database names only. Plain SQL plus psql \echo / \pset. Does not read
-- data_submissions.content (only its sha256).
--
-- REQUIRED PRIVILEGES: SELECT on data_submissions, data_submission_rows, import_batches, matches, sources.
-- A permission error aborts the run (exit 3): that is a failed run, not a clean one.
--
-- HOW THE EVIDENCE IS RETAINED (why this can work at all)
--   * csv.ts toObjects() turns a blank cell into JSON null; pipeline.ts stores each parsed row verbatim in
--     data_submission_rows.payload, and the validator's output in .reasons = {reasons, resolved}.
--   * promoteSubmission() hands promoteRow() exactly reasons->'resolved' (pipeline.ts:394), so
--     reasons->'resolved'->>'attendance' is the figure HANDED TO promoteRow(). It is a stored resolution, not a
--     record of an affected row: it does not show that any UPDATE matched a match or changed it.
--   * data_submissions.row_count records how many rows the upload had; a shortfall in retained rows means
--     evidence is missing for that submission.
--
-- THE `cell_state` COLUMN: what the RETAINED INPUT is, and nothing more
--   blank            retained payload shows the cell was blank (JSON null, or a string of only whitespace). PROVEN input.
--   column_absent    the payload has no `attendance` key (pre-fix code read that as '' -> 0 as well).
--   nonblank_string  the cell is a string with a non-whitespace character. It is NOT shown to read as any
--                    particular figure here: whether it parses to 0, to another number, or to none is not checked,
--                    and "whitespace" below is PostgreSQL's `\s`, while the validator's trim() also strips some
--                    characters (for example a non-breaking space or a BOM) that `\s` may not, so a cell this census
--                    calls nonblank_string might still have been blank to the validator. It is never called a
--                    typed or genuine zero. Its text is printed (retained_cell_json) so it can be inspected.
--   non_string_value the cell is a JSON number, boolean, array or object. CSV intake yields only strings and nulls, so
--                    this is NOT ordinary input: it is unreadable evidence, kept apart from nonblank_string.
--   payload_unreadable
--                    the whole retained payload is not a JSON object (for example a double-encoded jsonb string). The
--                    input is UNKNOWN; nothing is proven either way. (A NULL `->>` on such a payload would otherwise
--                    look blank, which is why the state is derived from jsonb_typeof first.)
--   The STORED RESOLUTION (stored_resolved_attendance) is a different column and a different fact: it is what the
--   validator stored when it ran, which promotion was later handed. It is never used to infer what the cell said.
--
-- FOUR KINDS OF EVIDENCE, KEPT APART (a row is never promoted from one kind to another by this script)
--   1. RECORDED PROMOTION   Section 2 (RECORDED_BLANK_PROMOTED_AS_ZERO): a submission whose status is 'promoted'
--                           retains a blank cell whose stored `resolved.attendance` is 0, and promoteSubmission()
--                           hands promoteRow() exactly that value. This establishes that a blank-derived zero WAS
--                           RECORDED AS PROMOTED. It does NOT, on its own, establish that the UPDATE changed a
--                           canonical match: the match may have been deleted before the promotion ran (the UPDATE
--                           then matches no row), and nothing here records the UPDATE's row count.
--   2. CURRENT MATCH STATE  Sections 2 (the *_now columns, state_vs_promotion) and 4: what `matches` holds today.
--                           Consistent with a promotion is not the same as caused by one (a zero entered through the
--                           Data Editor or Match Sheet looks identical), and a different value is not clearance.
--   3. POSSIBLE EXPOSURE    Sections 3 and 4: states that could produce, or are consistent with, a blank-derived
--                           zero, without showing one was written.
--   4. MISSING EVIDENCE     Section 1 (short_of_declared, rows_payload_unreadable, rows_non_string_value), Section 2
--                           (UNDETERMINED_*) and Section 5: the input or the submission is not retained or not
--                           readable. Nothing is proven either way.
--   NONBLANK_CELL_STORED_ZERO (Sections 1, 2, 4) is none of these four kinds of finding: it records only that a
--   nonblank retained cell sits beside a stored resolution of 0. It does NOT establish a valid zero, and it does NOT
--   establish the absence of exposure: input interpretation unverified; investigate before concluding. The retained
--   cell text is printed beside it (retained_cell_json in Sections 2 and 3, nonblank_cells_json in Section 4) so it can
--   be read against the stored resolution.
--
-- MATCH IDENTITY (Section 2, state_vs_promotion): a stored resolution with NO usable match_id is MATCH_IDENTITY_UNKNOWN,
--   which is not the same as MATCH_ABSENT_NOW (a known id that has no `matches` row today). The first says which match the
--   promotion named cannot be read; the second says it can, and that match is gone.
--   CONFIRMED CANONICAL WRITE is RESERVED for row-level write evidence (a before/after image, a row-level audit
--   record of the UPDATE, or a batch link on the matches row). The legacy promoteRow() leaves none of these
--   (it writes matches without touching import_batch_id, and keeps no before-image), so THIS CENSUS CANNOT
--   PRODUCE A CONFIRMED CANONICAL WRITE and no output of it may be reported as one. Historical impact is
--   unassessed until the operator has read the output and decided what further evidence is worth seeking.
--
-- WHAT IT CANNOT SHOW
--   * What the match held BEFORE a promotion overwrote it: no before-image is kept by this path. A promotion
--     that did change a match may have replaced a real figure; recovery would have to come from another source.
--   * Whether a recorded promotion's UPDATE affected any row (see kind 1 above).
--   * What a nonblank retained cell parses to (see nonblank_string above).
--   * Submissions deleted outright (no production code deletes them; direct SQL could). Section 5 finds the
--     import batch such a promotion leaves behind, but not its input.
--   * That a current zero is wrong: a genuine zero crowd exists by design (migration 020; 2020/2021 empty-stand
--     matches). A row whose current attendance is not 0 is NOT cleared: it may have been written, then corrected.
--   * Legacy intake is not the only manual-source writer; Section 4 does not attribute zeros it cannot trace.
-- Any repair is an operator decision (runbook §15); this script changes nothing.
--
-- Exit status (psql, ON_ERROR_STOP on): 0 only when every section ran and '== Done.' is the last line;
-- 3 for a failed statement; 2 for a lost connection. A run that does not end in '== Done.' with status 0 is
-- not evidence. Output must be read together with the target block of Section 0.

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset null '(null)'
\pset footer on

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

\echo '== 0. Target (confirm this is the database you meant to read; DEV is afldb_dev, PROD is afldb_prod)'
SELECT current_database() AS database,
       current_user AS role,
       current_setting('server_version') AS server_version,
       coalesce(inet_server_port()::text, '(socket)') AS port,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('transaction_isolation') AS isolation,
       now() AS snapshot_at,
       to_regclass('public.data_submissions') IS NOT NULL AS has_data_submissions,
       to_regclass('public.data_submission_rows') IS NOT NULL AS has_data_submission_rows,
       to_regclass('public.import_batches') IS NOT NULL AS has_import_batches;

\echo '== 1. match_attendance submissions by status: sizes and evidence gaps (counts only)'
-- rows_blank = blank + column_absent (PROVEN blank input).
-- rows_payload_unreadable and rows_non_string_value = input unknown, counted separately (missing evidence).
-- rows_nonblank_stored_zero = a nonblank_string cell beside a stored resolution of 0: input interpretation
--   unverified; investigate before concluding. It establishes neither a valid zero nor the absence of exposure, since
--   the cell is not checked to read as 0 (see the cell_state notes in the header). Section 2 prints the cell text.
-- short_of_declared = submissions retaining fewer rows than data_submissions.row_count (evidence missing).
WITH att AS (
  SELECT s.id AS submission_id, s.status::text AS status, s.row_count, r.row_no, r.verdict,
         CASE
           WHEN r.row_no IS NULL THEN NULL
           WHEN jsonb_typeof(r.payload) IS DISTINCT FROM 'object' THEN 'payload_unreadable'
           WHEN NOT (r.payload ? 'attendance') THEN 'column_absent'
           WHEN jsonb_typeof(r.payload->'attendance') = 'null' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string'
                AND (r.payload->>'attendance') ~ '^\s*$' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string' THEN 'nonblank_string'
           ELSE 'non_string_value'
         END AS cell_state,
         CASE WHEN jsonb_typeof(r.reasons->'resolved'->'attendance') = 'number'
              THEN (r.reasons->'resolved'->>'attendance')::numeric END AS stored_resolved_attendance
    FROM data_submissions s
    LEFT JOIN data_submission_rows r ON r.submission_id = s.id
   WHERE s.dataset = 'match_attendance'
), sub AS (
  SELECT submission_id, status,
         max(row_count) AS declared,
         count(row_no) AS retained,
         count(*) FILTER (WHERE cell_state IN ('blank', 'column_absent')) AS rows_blank,
         count(*) FILTER (WHERE cell_state = 'payload_unreadable') AS rows_payload_unreadable,
         count(*) FILTER (WHERE cell_state = 'non_string_value') AS rows_non_string_value,
         count(*) FILTER (WHERE cell_state = 'nonblank_string' AND stored_resolved_attendance = 0)
           AS rows_nonblank_stored_zero,
         count(*) FILTER (WHERE cell_state IN ('blank', 'column_absent')
                            AND verdict IN ('ok', 'warning')) AS rows_blank_stored_ok
    FROM att
   GROUP BY submission_id, status
)
SELECT status,
       count(*) AS submissions,
       sum(declared) AS rows_declared,
       sum(retained) AS rows_retained,
       count(*) FILTER (WHERE retained < declared) AS short_of_declared,
       sum(rows_blank) AS rows_blank,
       sum(rows_payload_unreadable) AS rows_payload_unreadable,
       sum(rows_non_string_value) AS rows_non_string_value,
       sum(rows_nonblank_stored_zero) AS rows_nonblank_stored_zero,
       sum(rows_blank_stored_ok) AS rows_blank_stored_ok
  FROM sub
 GROUP BY status
 ORDER BY status;

\echo '== 2. RECORDED PROMOTIONS and undetermined cases: PROMOTED submissions (LIMIT 200; total on the next line)'
-- This section reports RECORDED PROMOTIONS plus the CURRENT STATE of the match each names. It does not report
-- confirmed canonical writes: no row-level evidence of the UPDATE exists (see the header). Four separate facts per
-- row, in four separate column groups: the retained INPUT (cell_state), the STORED RESOLUTION
-- (stored_resolved_attendance, what promotion was handed), the RECORDED PROMOTION (promoted_at, import_batch_id,
-- file_sha12, filename) and the CURRENT CANONICAL STATE (the *_now columns, state_vs_promotion).
-- evidence_class:
--   RECORDED_BLANK_PROMOTED_AS_ZERO   retained blank cell, promotion was handed 0 (a recorded promotion of a
--                                     blank-derived zero; whether it changed a canonical match is not shown).
--   ANOMALY_BLANK_NOT_ZERO            retained blank cell but the stored resolution is not 0: investigate.
--   UNDETERMINED_INPUT_UNREADABLE     the payload or the cell is unreadable or not a string: the input is unknown
--                                     and nothing is proven (cell_state says which).
--   NONBLANK_CELL_STORED_ZERO         a nonblank retained string beside a stored resolution of 0. This does NOT show
--                                     the cell parsed to zero (the census does not parse it): it establishes neither a
--                                     valid zero nor the absence of exposure. Input interpretation unverified;
--                                     investigate before concluding. Read retained_cell_json beside
--                                     stored_resolved_attendance.
-- retained_cell_json: the retained `attendance` cell as JSON text, cut at 120 characters. Quotes show it is a string,
--   and whitespace inside them is visible; `null` is a blank cell; NULL here means the key is absent or the payload is
--   not a JSON object (cell_state says which).
-- state_vs_promotion (current match state against the stored resolution promotion was handed; consistent is not
-- caused-by):
--   MATCH_IDENTITY_UNKNOWN            the stored resolution has no usable match_id (missing, or not a number), so the
--                                     match the promotion named cannot be read and nothing about its current state is
--                                     shown. Different from MATCH_ABSENT_NOW; missing evidence, not clearance.
--   MATCH_ABSENT_NOW                  the stored match_id is known and no matches row has that id today: the UPDATE
--                                     cannot have changed it now.
--   STATE_CONSISTENT_WITH_PROMOTION   attendance equals the stored resolution, status complete, source
--                                     manual_admin_edit, and no later promoted match_attendance row names the match.
--   STATE_DIFFERS_OR_LATER_WRITE      anything else (changed since, or a later recorded promotion exists, or
--                                     the promotion never applied, or there is no numeric stored resolution). Not
--                                     clearance and not confirmation.
-- write_evidence: always 'none retained'. The legacy UPDATE leaves no row count, before-image or batch link.
-- later_promoted_writes: other promoted match_attendance rows naming the same match with a later promoted_at.
WITH att AS (
  SELECT s.id AS submission_id, s.status::text AS status, s.filename, s.promoted_at, s.import_batch_id,
         left(s.content_sha256, 12) AS file_sha12, r.row_no, r.verdict,
         CASE
           WHEN r.row_no IS NULL THEN NULL
           WHEN jsonb_typeof(r.payload) IS DISTINCT FROM 'object' THEN 'payload_unreadable'
           WHEN NOT (r.payload ? 'attendance') THEN 'column_absent'
           WHEN jsonb_typeof(r.payload->'attendance') = 'null' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string'
                AND (r.payload->>'attendance') ~ '^\s*$' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string' THEN 'nonblank_string'
           ELSE 'non_string_value'
         END AS cell_state,
         left((r.payload->'attendance')::text, 120) AS retained_cell_json,
         CASE WHEN jsonb_typeof(r.reasons->'resolved'->'attendance') = 'number'
              THEN (r.reasons->'resolved'->>'attendance')::numeric END AS stored_resolved_attendance,
         CASE WHEN jsonb_typeof(r.reasons->'resolved'->'match_id') = 'number'
              THEN (r.reasons->'resolved'->>'match_id')::numeric::bigint END AS resolved_match_id
    FROM data_submissions s
    JOIN data_submission_rows r ON r.submission_id = s.id
   WHERE s.dataset = 'match_attendance' AND s.status = 'promoted'
), cls AS (
  SELECT att.*,
         CASE
           WHEN cell_state IN ('blank', 'column_absent') AND stored_resolved_attendance = 0
             THEN 'RECORDED_BLANK_PROMOTED_AS_ZERO'
           WHEN cell_state IN ('blank', 'column_absent') THEN 'ANOMALY_BLANK_NOT_ZERO'
           WHEN cell_state IN ('payload_unreadable', 'non_string_value') THEN 'UNDETERMINED_INPUT_UNREADABLE'
           WHEN cell_state = 'nonblank_string' AND stored_resolved_attendance = 0 THEN 'NONBLANK_CELL_STORED_ZERO'
         END AS evidence_class
    FROM att
)
SELECT c.submission_id, c.row_no, c.evidence_class,
       c.cell_state AS retained_input_state,
       c.retained_cell_json,
       c.stored_resolved_attendance,
       c.verdict AS stored_verdict,
       c.promoted_at, c.import_batch_id, c.file_sha12, c.filename,
       c.resolved_match_id AS match_id,
       m.id IS NOT NULL AS match_exists_now,
       m.match_key,
       m.attendance AS attendance_now,
       m.attendance_status::text AS attendance_status_now,
       src.key AS attendance_source_now,
       CASE
         WHEN c.resolved_match_id IS NULL THEN 'MATCH_IDENTITY_UNKNOWN'
         WHEN m.id IS NULL THEN 'MATCH_ABSENT_NOW'
         WHEN c.stored_resolved_attendance IS NOT NULL AND m.attendance = c.stored_resolved_attendance
              AND m.attendance_status::text = 'complete' AND src.key = 'manual_admin_edit'
              AND NOT EXISTS (SELECT 1 FROM cls l
                               WHERE l.resolved_match_id = c.resolved_match_id
                                 AND l.promoted_at > c.promoted_at)
           THEN 'STATE_CONSISTENT_WITH_PROMOTION'
         ELSE 'STATE_DIFFERS_OR_LATER_WRITE'
       END AS state_vs_promotion,
       'none retained' AS write_evidence,
       CASE WHEN c.resolved_match_id IS NULL THEN NULL
            ELSE (SELECT count(*) FROM cls l
                   WHERE l.resolved_match_id = c.resolved_match_id
                     AND l.promoted_at > c.promoted_at)
       END AS later_promoted_writes
  FROM cls c
  LEFT JOIN matches m ON m.id = c.resolved_match_id
  LEFT JOIN sources src ON src.id = m.attendance_source_id
 WHERE c.evidence_class IS NOT NULL
 ORDER BY (c.evidence_class = 'NONBLANK_CELL_STORED_ZERO'), c.submission_id, c.row_no
 LIMIT 200;

WITH att AS (
  SELECT r.row_no,
         CASE
           WHEN jsonb_typeof(r.payload) IS DISTINCT FROM 'object' THEN 'payload_unreadable'
           WHEN NOT (r.payload ? 'attendance') THEN 'column_absent'
           WHEN jsonb_typeof(r.payload->'attendance') = 'null' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string'
                AND (r.payload->>'attendance') ~ '^\s*$' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string' THEN 'nonblank_string'
           ELSE 'non_string_value'
         END AS cell_state,
         CASE WHEN jsonb_typeof(r.reasons->'resolved'->'attendance') = 'number'
              THEN (r.reasons->'resolved'->>'attendance')::numeric END AS stored_resolved_attendance,
         (jsonb_typeof(r.reasons->'resolved'->'match_id') IS DISTINCT FROM 'number') AS match_identity_unknown
    FROM data_submissions s
    JOIN data_submission_rows r ON r.submission_id = s.id
   WHERE s.dataset = 'match_attendance' AND s.status = 'promoted'
)
SELECT count(*) FILTER (WHERE cell_state IN ('blank', 'column_absent') AND stored_resolved_attendance = 0)
         AS recorded_blank_promoted_as_zero_rows,
       count(*) FILTER (WHERE cell_state IN ('blank', 'column_absent') AND stored_resolved_attendance = 0
                          AND match_identity_unknown)
         AS recorded_blank_zero_match_identity_unknown_rows,
       count(*) FILTER (WHERE cell_state = 'nonblank_string' AND stored_resolved_attendance = 0
                          AND match_identity_unknown)
         AS nonblank_cell_stored_zero_match_identity_unknown_rows,
       count(*) FILTER (WHERE cell_state IN ('blank', 'column_absent')
                          AND stored_resolved_attendance IS DISTINCT FROM 0)
         AS anomaly_blank_not_zero_rows,
       count(*) FILTER (WHERE cell_state = 'payload_unreadable') AS undetermined_payload_unreadable_rows,
       count(*) FILTER (WHERE cell_state = 'non_string_value') AS undetermined_non_string_value_rows,
       count(*) FILTER (WHERE cell_state = 'nonblank_string' AND stored_resolved_attendance = 0)
         AS nonblank_cell_stored_zero_rows
  FROM att;

\echo '== 3. POSSIBLE EXPOSURE: submissions NOT yet promoted that carry a blank cell or unreadable input (LIMIT 200)'
-- Approval trusts the STORED row verdicts (actions.ts decideSubmission), so a stored 'ok' on a blank row stays 'ok'
-- until the submission is re-validated (validateSubmission accepts staged / validated / rejected; an APPROVED one
-- must be rejected first). Promotion also reads the stored verdict, but match_attendance's preparePromotion now
-- re-reads every retained cell with the validator's own reader and refuses the WHOLE file before any lock or write.
-- That refusal is not free of state change: the pipeline records a refused promotion as status 'failed' with the
-- refusal text (no import batch, no matches row written). A 'failed' submission can be neither rejected nor
-- re-validated (actions.ts reject accepts staged / validated / approved; validateSubmission accepts staged /
-- validated / rejected), so a stale submission that has already had a promotion attempt on fixed code is a dead end
-- and its file must be uploaded again as a new submission.
-- promotable_now mirrors the promotion guard: status approved or failed, and no row with verdict 'error' or NULL.
-- It says the pipeline would ATTEMPT promotion, which on fixed code a blank or unreadable row then refuses.
-- Rows whose cell_state is payload_unreadable or non_string_value are listed as MISSING EVIDENCE: the input is
-- unknown, promotion on fixed code refuses them, and nothing here says what the old validator did with them.
WITH att AS (
  SELECT s.id AS submission_id, s.status::text AS status, s.filename, s.uploaded_at,
         left(s.content_sha256, 12) AS file_sha12, r.row_no, r.verdict, r.payload,
         CASE
           WHEN r.row_no IS NULL THEN NULL
           WHEN jsonb_typeof(r.payload) IS DISTINCT FROM 'object' THEN 'payload_unreadable'
           WHEN NOT (r.payload ? 'attendance') THEN 'column_absent'
           WHEN jsonb_typeof(r.payload->'attendance') = 'null' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string'
                AND (r.payload->>'attendance') ~ '^\s*$' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string' THEN 'nonblank_string'
           ELSE 'non_string_value'
         END AS cell_state
    FROM data_submissions s
    JOIN data_submission_rows r ON r.submission_id = s.id
   WHERE s.dataset = 'match_attendance'
     AND s.status IN ('staged', 'validated', 'approved', 'failed', 'rejected')
)
SELECT a.submission_id, a.status, a.row_no, a.cell_state AS retained_input_state,
       left((a.payload->'attendance')::text, 120) AS retained_cell_json, a.verdict AS stored_verdict,
       (a.status IN ('approved', 'failed')
         AND NOT EXISTS (SELECT 1 FROM att x
                          WHERE x.submission_id = a.submission_id
                            AND (x.verdict = 'error' OR x.verdict IS NULL))) AS promotable_now,
       CASE
         WHEN a.cell_state IN ('payload_unreadable', 'non_string_value')
           THEN 'INPUT_UNREADABLE: missing evidence; fixed-code promotion refuses it; what the old validator did with it is not shown here'
         WHEN a.status = 'failed' AND a.verdict IN ('ok', 'warning')
           THEN 'STALE_VERDICT_FAILED: cannot be rejected or re-validated; fixed code refuses any retry; upload a corrected file as a new submission'
         WHEN a.status IN ('validated', 'approved') AND a.verdict IN ('ok', 'warning')
           THEN 'STALE_VERDICT: still approvable on the stored ok; reject (if approved) then re-validate BEFORE any promote attempt, since a refused attempt records it as failed'
         WHEN a.status IN ('staged', 'rejected')
           THEN 'not promotable: re-validation on fixed code makes this row an error'
         ELSE 'blank row already carries an error verdict'
       END AS exposure_note,
       a.payload->>'match_id' AS match_id_cell,
       a.uploaded_at, a.file_sha12, a.filename
  FROM att a
 WHERE a.cell_state IN ('blank', 'column_absent', 'payload_unreadable', 'non_string_value')
 ORDER BY a.submission_id, a.row_no
 LIMIT 200;

\echo '== 4. POSSIBLE EXPOSURE (current state): matches holding a manual-source zero crowd, and what retained evidence says about each (LIMIT 200)'
-- This lists CURRENT zeros, so it cannot show a blank-derived write that was later corrected, and a zero here is
-- not necessarily wrong. attribution (each names what is retained, not what happened):
--   CURRENT_ZERO_WITH_RECORDED_BLANK_PROMOTION
--                                 a retained blank cell was recorded as promoted with 0 for this match (Section
--                                 2) AND the match holds a manual-source zero today. Two separate facts, not one
--                                 proof: the zero may have come from another writer, and the promotion's UPDATE
--                                 is not shown to have changed this row. Possible exposure only.
--   NONBLANK_CELL_STORED_ZERO_PROMOTED
--                                 a promoted submission retains a nonblank string cell for this match beside a stored
--                                 resolution of 0. The cell is not checked to read as 0: it establishes neither a
--                                 valid zero nor the absence of exposure. Input interpretation unverified; investigate
--                                 before concluding. nonblank_cells_json lists the distinct retained cell texts.
--   UNDETERMINED_INPUT_UNREADABLE a promoted row naming this match has an unreadable payload or a non-string cell.
--   NOT_TRACEABLE_HERE            no retained match_attendance row names it: Data Editor / Match Sheet / other
--                                 writers, or evidence not retained. This census does not judge it.
-- Promoted rows whose stored resolution has no usable match_id cannot be attributed to any match here (this section
-- starts from `matches`); they are reported in Section 2 as MATCH_IDENTITY_UNKNOWN and counted in its summary line.
WITH att AS (
  SELECT r.submission_id, r.row_no,
         CASE
           WHEN jsonb_typeof(r.payload) IS DISTINCT FROM 'object' THEN 'payload_unreadable'
           WHEN NOT (r.payload ? 'attendance') THEN 'column_absent'
           WHEN jsonb_typeof(r.payload->'attendance') = 'null' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string'
                AND (r.payload->>'attendance') ~ '^\s*$' THEN 'blank'
           WHEN jsonb_typeof(r.payload->'attendance') = 'string' THEN 'nonblank_string'
           ELSE 'non_string_value'
         END AS cell_state,
         (r.payload->'attendance')::text AS cell_json,
         CASE WHEN jsonb_typeof(r.reasons->'resolved'->'attendance') = 'number'
              THEN (r.reasons->'resolved'->>'attendance')::numeric END AS stored_resolved_attendance,
         CASE WHEN jsonb_typeof(r.reasons->'resolved'->'match_id') = 'number'
              THEN (r.reasons->'resolved'->>'match_id')::numeric::bigint END AS resolved_match_id
    FROM data_submissions s
    JOIN data_submission_rows r ON r.submission_id = s.id
   WHERE s.dataset = 'match_attendance' AND s.status = 'promoted'
), per_match AS (
  SELECT resolved_match_id AS match_id,
         count(*) FILTER (WHERE cell_state IN ('blank', 'column_absent')
                            AND stored_resolved_attendance = 0) AS blank_as_zero_rows,
         count(*) FILTER (WHERE cell_state = 'nonblank_string'
                            AND stored_resolved_attendance = 0) AS nonblank_stored_zero_rows,
         left(string_agg(DISTINCT cell_json, ' | ' ORDER BY cell_json)
                FILTER (WHERE cell_state = 'nonblank_string' AND stored_resolved_attendance = 0), 200)
           AS nonblank_cells_json,
         count(*) FILTER (WHERE cell_state IN ('payload_unreadable', 'non_string_value')) AS unreadable_rows,
         count(*) AS promoted_rows
    FROM att
   WHERE resolved_match_id IS NOT NULL
   GROUP BY resolved_match_id
)
SELECT m.id AS match_id, m.match_key, m.season, m.attendance, m.attendance_status::text AS attendance_status,
       coalesce(p.promoted_rows, 0) AS promoted_attendance_rows,
       coalesce(p.blank_as_zero_rows, 0) AS blank_as_zero_rows,
       coalesce(p.nonblank_stored_zero_rows, 0) AS nonblank_stored_zero_rows,
       p.nonblank_cells_json,
       coalesce(p.unreadable_rows, 0) AS unreadable_rows,
       CASE
         WHEN coalesce(p.blank_as_zero_rows, 0) > 0 THEN 'CURRENT_ZERO_WITH_RECORDED_BLANK_PROMOTION'
         WHEN coalesce(p.nonblank_stored_zero_rows, 0) > 0 THEN 'NONBLANK_CELL_STORED_ZERO_PROMOTED'
         WHEN coalesce(p.unreadable_rows, 0) > 0 THEN 'UNDETERMINED_INPUT_UNREADABLE'
         ELSE 'NOT_TRACEABLE_HERE'
       END AS attribution
  FROM matches m
  JOIN sources src ON src.id = m.attendance_source_id
  LEFT JOIN per_match p ON p.match_id = m.id
 WHERE m.attendance = 0
   AND src.key = 'manual_admin_edit'
 ORDER BY m.id
 LIMIT 200;

SELECT count(*) AS manual_zero_crowd_matches
  FROM matches m
  JOIN sources src ON src.id = m.attendance_source_id
 WHERE m.attendance = 0 AND src.key = 'manual_admin_edit';

\echo '== 5. Evidence gaps: admin-upload batches for match_attendance with NO retained submission (LIMIT 200)'
-- pipeline.ts creates one import_batches row (tool admin-upload, target_table match_attendance, notes
-- "submission N") per promotion. A batch that no data_submissions.import_batch_id points at means a promotion
-- happened but its submission is not retained: whether it carried a blank cell is UNKNOWABLE from this database.
SELECT b.id AS import_batch_id, b.started_at, b.completed_at, b.status::text AS status,
       b.records_read, b.records_inserted, b.notes
  FROM import_batches b
 WHERE b.tool = 'admin-upload'
   AND b.target_table = 'match_attendance'
   AND NOT EXISTS (SELECT 1 FROM data_submissions s WHERE s.import_batch_id = b.id)
 ORDER BY b.id
 LIMIT 200;

SELECT count(*) AS match_attendance_batches,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_submissions s WHERE s.import_batch_id = b.id))
         AS with_retained_submission,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM data_submissions s WHERE s.import_batch_id = b.id))
         AS without_retained_submission
  FROM import_batches b
 WHERE b.tool = 'admin-upload' AND b.target_table = 'match_attendance';

ROLLBACK;

\echo '== Done.'
