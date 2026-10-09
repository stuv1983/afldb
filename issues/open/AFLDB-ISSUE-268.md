# AFLDB-ISSUE-268 — Legacy `match_attendance` intake turns a blank cell into a sourced, settle-protected zero crowd

## 0. Status

- **Status (2026-10-09, current):** Open. **Validated on `afldb_test`, both censuses complete, uncommitted and undeployed.** Validator fix,
  the promotion-time re-check of the retained cells (§17.10) and their DB-free and integration tests are written in the working tree.
  Operator validation after the review round (§17.11): at **15:11:57** 181/181 `tests/ingest-datasets.test.ts`, TypeScript, ESLint
  (covering `src/lib/ingest/datasets.ts`, `tests/ingest-datasets.test.ts` and `tests/integration/match-results-promotion.test.ts`) and
  `git diff --check` passed; against `afldb_test` (`afldb_owner`, tunnel `127.0.0.1:55432`) the **targeted ISSUE-268 integration cases**
  passed twice (15:21:42 and 15:30:35, 7 passed and 32 filtered skips each). **Not validated:** restricted-role permissions (all three
  pools used the test owner connection temporarily) and the full integration file. **Both operator-run censuses are complete (§17.14):**
  DEV (snapshot 15:59:22) and PROD (snapshot 16:02:57) each found no retained `match_attendance` submissions, no rows in Sections 2–5
  and zero in every summary count; no exposure was found in the records checked. **Historical impact remains unassessed; nothing was
  repaired; neither census installed the fix.** Next: review/commit, merge readiness, merge/push, DEV deployment and acceptance; PROD
  installation stays behind the unchanged ISSUE-265 hold. See §17.
- **Status as brought from the review (2026-10-08):** Open (2026-10-08). Nothing implemented. *(Preserved; §1–§16 below are the review worktree's text, unchanged.)*
- **Severity:** High. **Area:** legacy CSV intake / data integrity (NULL vs zero).
- **Key file:** `src/lib/ingest/datasets.ts` (`match_attendance` dataset).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-003; partition note R5a-F02).
- **Classification:** reproduced (DB-free witness W2).

## 1. Summary

In a `match_attendance` CSV, a blank `attendance` cell becomes `Number('') = 0`. The row validates `ok` as "sets … to 0", so it never appears on the review page. Promotion then writes `attendance = 0, attendance_status = 'complete', attendance_source_id = manual_admin_edit`. Manual-authority treats that row as human authority, so the settles never correct it.

## 2. Evidence

- `src/lib/ingest/csv.ts:103-104`: `toObjects` turns a blank cell into `null`.
- `src/lib/ingest/datasets.ts:1312-1313`: `const attendance = Number((row.attendance ?? '').trim());`. The range check `0..200000` passes 0.
- `datasets.ts:1316-1320`: verdict `ok`, reason "sets … to 0".
- `datasets.ts:1348-1354`: promotion UPDATE writes attendance 0, status `complete` and the manual source.
- `src/app/admin/submissions/[id]/page.tsx:66-70`: the review page lists only rows whose verdict is not `ok`.
- `src/lib/acquisition/manual-authority.ts:721-727`: a `manual_admin_edit` attendance is authority that settles honour.
- Contrast: `match_results` treats blank as not recorded and refuses an uncited explicit 0 (`datasets.ts:632, :740-746`).

## 3. Trigger

A super admin uploads a half-filled attendance worklist (for example `match_id=12345,attendance=`), and the clean report is approved and promoted.

## 4. Expected invariant

Missing statistics mean "not recorded", never zero. A blank cell in a dataset whose purpose is to set a figure is a validation error (or preserves NULL), and is never a sourced zero.

## 5. Actual behaviour

A fabricated, cited, `complete` zero crowd is written and then protected from source correction.

## 6. First wrong layer

`src/lib/ingest/datasets.ts:1312-1313`.

## 7. Impact

- Every blank row in an approved worklist fabricates a zero attendance on a canonical match.
- The value is shielded from settles indefinitely.
- Public crowd records and averages are distorted.
- Bounded only by Super Admin approval of a report that showed nothing wrong.

## 8. Reproduction / witness

W2 (DB-free; stub `sql` tag), in `D:\tmp\review-20261008-full\witness\w2_ingest.ts`, output `w2.out`:
`match_attendance {attendance: null} -> {"verdict":"ok","reasons":["sets A v B · 2024 1 to 0"],"resolved":{"match_id":1,"attendance":0}}`.

## 9. Disproof attempts

- `requiredColumns` guarantees that the column exists, not the cell.
- No DB CHECK forbids a cited zero; migration 020 permits it by design.
- `optionalCountReader` is not used in this dataset.

## 10. Existing-issue search

- ISSUE-258 fixed blank-cell preservation for `player_match_stats` and `match_results` only. `issues.md:47400-47401` lists the other datasets as out of scope.
- ISSUE-265 D-265-10 added only the lock hook to this dataset.
- Classification: **new**, the same class as ISSUE-258 in an excluded dataset.

## 11. Scope

`match_attendance.validateRow` parsing.

## 12. Out of scope

Other legacy datasets' numeric parsing (AFLDB-ISSUE-305), and retirement of the legacy pipeline.

## 13. Proposed fix boundary

Parse `attendance` with the strict `^\d+$` reader (or `optionalCountReader` with an upper bound) and make a blank cell a validation error.

## 14. Proposed validation

1. DB-free `validateRow` cases in `tests/ingest-datasets.test.ts`: blank → error; `0` → ok; `x` → error.
2. Read-only census (operator-run): `matches` with `attendance = 0` and the `manual_admin_edit` attendance source, joined to `admin-upload` import batches. This finds any already-fabricated zeros.

## 15. Decisions / unresolved questions

- Whether any DEV or PROD promotion has already written such a zero (census above). **Answered for the records checked (§17.14):**
  both operator-run censuses (2026-10-09) found no retained `match_attendance` submissions and no rows in Sections 2–5, so no
  exposure was found there. That is not historical clearance (§17.14). **No repair is indicated by these outputs;** a future repair
  would need separate evidence and a separate operator authorisation.
- **D-268-1 (added 2026-10-09, UNDECIDED; a separate follow-up, not an ISSUE-268 merge gate).** Should nonblank `attendance` cells
  tighten to plain digits (`^\d+$`, as ISSUE-258's `optionalCountReader` does), refusing `1e2`, `0x10`, `+5`, `1.0`? No recorded
  decision covers this dataset (see §17.2). Until decided, nonblank cells keep their pre-fix reading, pinned by tests.
- **D-268-2 (added 2026-10-09; the scoped promotion-time guard was AUTHORISED by the operator the same day, IMPLEMENTED (§17.10), and
  passed the seven targeted integration cases twice on `afldb_test` (§17.11)).**
  Stored verdicts are trusted at approval and promotion (§17.7), so a submission validated before the fix keeps a stale `ok`
  on a blank row. `match_attendance`'s `preparePromotion` now re-reads every retained cell and refuses the whole file. Approval
  itself is unchanged (a stale `validated` submission can still be approved), and the hand remedy for a stale submission that has
  not yet had a promote attempt is reject → re-validate (§17.7). Both censuses retained no `match_attendance` submission, so
  neither found a stale one (§17.14).
- **D-268-3 (added 2026-10-09, UNDECIDED, not implemented; a separate follow-up, not an ISSUE-268 merge gate).** A refused promotion is recorded by the pipeline as status
  `failed`, and a `failed` submission can be neither rejected nor re-validated (`decideSubmission` rejects only `staged`,
  `validated`, `approved`; `validateSubmission` accepts only `staged`, `validated`, `rejected`). So a stale approved
  submission that has had one promote attempt on the fixed code is a dead end; the file has to be uploaded again as a new
  submission. Letting a `failed` submission be rejected, or recording a `refused` outcome that writes no status, would change
  the shared submission pipeline for every dataset, which this issue was told not to do. Left to the operator.

## 16. Next action

*(Review text, historical: "Validator fix plus tests, then the census.")* **Current (2026-10-09, §17.14):** validator fix, tests and
both censuses are done. Remaining: operator review and commit, `merge:ready`, merge/push, DEV deployment and acceptance. PROD
installation stays behind the ISSUE-265 hold.

---

## 17. Implementation record (2026-10-09, Sonnet 5.5, worktree `afldb-issue-268`, branch `sonnet/issue-268`)

Nothing below was executed. No test, typecheck, build, Git, SQL or host command has been run by the implementer
(CLAUDE.md §9); every "written" below is source inspection only.

### 17.1 Confirmed scope

Re-read against this worktree (branch base `cc61771e`) before changing anything: the cited lines still hold
(`validateRow` parsing at `datasets.ts:1312-1315`; `promoteRow` at `:1347-1354`) and the defect is exactly as
§1–§6 describe. `match_attendance` is the only one of the three match datasets that reads its count with
`Number(...)` and no blank guard; `match_results` and `player_match_stats` already use `optionalCountReader`
(ISSUE-258). Promotion refuses a submission that has any `error` row (`pipeline.ts:342-347`) and the schema notes
that errors block approval (`023_auth_submissions.sql:149`), so an `error` verdict is sufficient to block it.
The approval action itself (`src/app/admin/submissions/[id]/actions.ts`) was not read.

### 17.2 Decisions applied (none new)

The review (§4, §13, §14.1) already decided the behaviour: a blank cell in this dataset is a **validation error**,
`0` stays valid, `x` is an error. This is the "error" branch of §4's "validation error (or preserves NULL)": the
dataset's whole purpose is to set a figure, so a blank row has nothing to preserve. A blank is therefore *not*
treated as "keep the stored value" (the `match_results` D-258-3 behaviour); an operator who wants that behaviour for
this dataset would need a new decision.

**Numeric-format policy (corrected 2026-10-09).** The first draft of this change also refused `1e2`, `0x10` and `+5`.
That was **not** supported by a recorded decision and has been reverted:

- The pre-fix reader was `Number(trim)` then `Number.isInteger`, `0..200000`, so it accepted `1e2` (100), `0x10` (16),
  `+5` (5), `1.0` (1) and `0042` (42).
- The review's §14 fixes only blank → error, `0` → ok, `x` → error. Its §13 *proposes* "the strict `^\d+$` reader
  (or `optionalCountReader` with an upper bound)" as a fix boundary; that is a proposal, and §15 lists no decision on
  it.
- ISSUE-258's `^\d+$` reader (D-258-2, `issues.md:47406-47411`) is an operator decision for **`match_results` and
  `player_match_stats` only**; the same entry puts "the other datasets" out of scope (`issues.md:47404-47405`).
- So refusing those spellings is a **new restriction** for `match_attendance`, recorded as the undecided **D-268-1**
  (§15). Until it is decided the change refuses only a blank or missing cell; every nonblank cell is read exactly as
  before. Tests pin that status quo (§17.4).

### 17.3 Change

- `src/lib/ingest/datasets.ts` (`matchAttendance.validateRow`): the cell is trimmed; blank (or a missing column)
  returns `error` with reason "attendance is blank; enter a whole number from 0 to 200000, or remove the row to
  leave the stored value"; otherwise the cell is read exactly as before (`Number()`, whole number, `0..`
  `MATCH_ATTENDANCE_MAX`, 200,000, a new module constant replacing the literal), else `error` naming the offending
  cell (the message now quotes the cell; the old text did not). `0` and any typed figure validate as before and
  resolve to the same `{ match_id, attendance }`. **The only behaviour change is the blank/missing cell** (plus that
  message wording); `1e2`, `0x10`, `+5`, `1.0`, `0042` and surrounding whitespace remain accepted (§17.2, D-268-1).
- Dataset `description` gains a sentence telling uploaders a blank cell is refused and rows with no figure should
  be removed. The `match_id` check, the match lookup and `promoteRow` are unchanged. The cell is now read by a shared
  module-private `readAttendanceCell` that `preparePromotion` also uses (§17.10), so the two cannot drift; its reasons
  and the accepted spellings are exactly those described above. `preparePromotion` gained the re-check of §17.10; its
  gate, lock, ordering and timeout behaviour for a valid file is untouched.
- Ordering preserved: `match_id` shape error, then "no match with id N", then the attendance cell. A row with
  both a bad match and a bad cell still reports only the first failure, as before.

### 17.4 Tests and census (written 2026-10-09; historical wording "NOT run" below was true when written, current run status is §17.11 and §17.14)

- `tests/ingest-datasets.test.ts`, new `describe('AFLDB-ISSUE-268 match_attendance attendance cell')`, DB-free,
  fake `sql` answering the one match lookup: blank `null`/`''`/whitespace → `error` with no `resolved`; an absent
  column → `error`; seven malformed or out-of-range cells (`x`, `12,000`, `12.5`, `-1`, `1O`, `200001`, a 20-digit
  string) → `error` naming the cell; six valid figures (`0`, `1`, `41000`, padded, `0042`, `200000`) → `ok` with the
  exact `resolved`; six `Number()`-readable nonblank spellings (`1e2`→100, `0x10`→16, `+5`→5, `1.0`→1, `0e0`→0,
  `+0`→0) → `ok`, pinning the **unchanged** pre-fix reading pending D-268-1 (a later tightening then needs a visible
  test edit); unknown match and bad `match_id` ordering preserved; the description carries the blank-cell notice.
  The promotion-time re-check has its own coverage (§17.10). The existing `match_attendance promotion lock` suite
  (its rows carry matching payloads and resolved figures) and the integration case B5
  (`tests/integration/settle-promotion-deadlock.test.ts`, which validates real figures) are not affected by inspection;
  not re-run.
- `issues/open/AFLDB-ISSUE-268-blank-attendance-census.sql` (§14.2): read-only (`BEGIN … READ ONLY`, rolled back),
  ends `== Done.`. Revised 2026-10-09 after an inspection of its schema references, target reporting, transaction
  boundaries and retained-submission logic (§17.8). It reads `data_submissions` / `data_submission_rows` (the
  retained uploads) because only the retained payload can show that an input cell was blank; it never reads
  `content`. Each row gets a `cell_state` that says only what the **retained input** is: `blank` and `column_absent`
  (proven blank input), `nonblank_string` (a string with a non-whitespace character; **not** checked to read as any
  figure), `non_string_value` (a JSON number, boolean, array or object: not ordinary CSV input) and `payload_unreadable`
  (the payload is not a JSON object). The **stored resolution** (`stored_resolved_attendance`, what promotion was
  handed), the **recorded promotion** (status, `promoted_at`, batch) and the **current canonical state** (`*_now`
  columns) are separate column groups, never inferred from one another (§17.12). Sections: 0 target (database, role,
  version, port, read-only, snapshot time); 1 submissions by status with evidence gaps; 2 **recorded promotions**
  (promoted submissions whose retained blank cell has a stored resolution of 0, each beside the current state of the
  match it names) and undetermined cases; 3 **possible exposure**, submissions not yet promoted that carry a blank cell
  or unreadable input, flagging stale `ok` verdicts (§17.7); 4 **possible exposure (current state)**, every
  manual-source zero crowd with an attribution that keeps a recorded blank promotion apart from a nonblank cell beside
  a stored 0 and from "not traceable here"; 5 evidence gaps, `admin-upload` batches for `match_attendance` with no
  retained submission.
  *(Historical: "Unrun; written without a database, so the first run is also its first syntax check." It has since been run once on
  DEV and once on PROD and every statement parsed, §17.14; the classification of populated rows was not exercised.)* It cannot show
  what a match held before a promotion overwrote it (no before-image), and a non-zero current value is not clearance.
  **Evidence labels revised later on 2026-10-09 (§17.8, §17.12, §17.13):** a promoted submission with a retained blank cell
  whose stored resolution is 0 is a *recorded promotion*, not a confirmed canonical write; a nonblank retained cell
  beside a stored 0 is `NONBLANK_CELL_STORED_ZERO`: it establishes neither a valid zero nor the absence of exposure
  ("input interpretation unverified; investigate before concluding"), and its retained cell text is printed beside it.
  A stored resolution with no usable `match_id` is `MATCH_IDENTITY_UNKNOWN`, separate from `MATCH_ABSENT_NOW` (§17.13).

### 17.5 Outstanding (nothing here is claimed; corrected 2026-10-09 after the censuses, §17.14)

**Acceptance list as it now stands.**

- **Done:** the validator fix and the promotion-time re-check; D-268-2's scoped promotion guard (authorised, implemented, and the seven
  targeted integration cases passed twice, §17.11); the 15:11:57 DB-free/`tsc`/ESLint/`git diff --check` round; both operator-run
  censuses (§17.14).
- **Remaining ISSUE-268 steps, in order:** operator review and commit of explicit paths (repeat `git diff --check`: the census SQL header
  and the tracking files changed after the runs, no source or test file did); `merge:ready`; merge/push; DEV deployment and acceptance.
  PROD installation stays behind the unchanged ISSUE-265 hold (`blockers.md` R2, R6, R15).
- **Not ISSUE-268 merge gates (separate follow-ups):** numeric-format tightening (D-268-1) and any change to failed-submission recovery
  (D-268-3, a shared-pipeline change).
- **Not validated, and not implied to have passed:** the restricted-role (import/auth) permissions, and the full integration file.
  Optional extra evidence only; the operator decides.
- **No repair is indicated** by the census outputs. A future repair requires separate evidence and a separate operator authorisation.

- **Operator-run checks.** *Passed (§17.11):* at 15:11:57 on 2026-10-09 `tests/ingest-datasets.test.ts` 181/181, TypeScript, ESLint
  (the operator's command covered `src/lib/ingest/datasets.ts`, `tests/ingest-datasets.test.ts` and
  `tests/integration/match-results-promotion.test.ts`) and
  `git diff --check`; and, against `afldb_test` (`afldb_owner`, `127.0.0.1:55432`), the targeted ISSUE-268 integration cases twice
  (15:21:42 and 15:30:35: 7 passed, 32 filtered skips each, no suite or hook failure, fixture preflight and cleanup assertions
  passed). **Still not run or not validated:** the full integration file and the restricted-role (import/auth) permissions, because all
  three pools used the test owner connection temporarily. The only edits since those runs are to the census SQL header comments
  and the tracking files (§17.13, §17.14), which no test covers; `git diff --check` is cheap to repeat before the commit. For the final
  integration evidence, when wanted, run from `D:\dev\afldb-issue-268` against `afldb_test` only, with the session variables the
  operator normally sets (`AFLDB_TEST_DATABASE_URL`; `AFLDB_AUTH_DATABASE_URL` must target the same `_test` database or the file's
  first `beforeAll` refuses, before any write; `AFLDB_TEST_IMPORT_DATABASE_URL` for the restricted-role path, which the 15:21:42 and
  15:30:35 runs did not exercise): `npx vitest run tests/integration/match-results-promotion.test.ts`. **Expect the integration file
  to refuse** if season 2073 or any other reserved fixture row already exists on `afldb_test` (§17.12.1); that refusal is the new
  behaviour, writes nothing, and is cleared by removing the named residue by hand.
- **Census (run on both databases 2026-10-09; results §17.14).** *Historical instruction, now carried out:* run
  `AFLDB-ISSUE-268-blank-attendance-census.sql` read-only on DEV and on PROD before any
  conclusion about already-written zeros. **Historical impact is unassessed**. When the output is populated, read it
  by evidence kind, never promoting one to another: the retained input (`retained_input_state`, with the cell text in
  `retained_cell_json`), the stored resolution (`stored_resolved_attendance`), the recorded promotion and the current canonical
  state (`state_vs_promotion`, Section 4) are four separate facts. Section 2 `RECORDED_BLANK_PROMOTED_AS_ZERO` is a *recorded
  promotion* of a blank-derived zero and says nothing alone about whether a canonical match changed; Sections 3 and 4 are possible
  exposure only; Section 5, `UNDETERMINED_*`, `INPUT_UNREADABLE`, `MATCH_IDENTITY_UNKNOWN` and short-of-declared rows are missing
  evidence, not clearance; `NONBLANK_CELL_STORED_ZERO` records only a nonblank cell beside a stored 0 and establishes neither a
  valid zero nor the absence of exposure: **input interpretation unverified; investigate before concluding.** **"Confirmed canonical
  write" is reserved for row-level write evidence, which the legacy path does not
  retain, so this census cannot produce one.** Any repair is an operator decision (§15) and nothing in this issue
  authorises one. Section 3 rows marked `STALE_VERDICT` need the handling in §17.7.
- **Deployment:** none. No DEV or PROD installation, and PROD remains held at `cd3cf782` (ISSUE-265 observation);
  this change is not part of any deployment procedure yet.
- **Not resolved:** the issue stays Open until the change is committed (and merged), and deployed and accepted per the operator's
  sequence. Both census results are now recorded (§17.14). Tests have passed as far as §17.11 states; that is not resolution.

### 17.7 Residual exposure: the stale-verdict path (found 2026-10-09 by reading; promotion half closed in code, §17.10)

Approval (`src/app/admin/submissions/[id]/actions.ts`, `decideSubmission`: `status = 'validated'` and no row with
verdict `error` or NULL) and promotion (`pipeline.ts:342-347`: refuses only a stored `error`/NULL verdict) both trust the
**stored** row verdicts. Neither re-runs `validateRow`. `validateSubmission` re-runs only for `staged`, `validated` and
`rejected` submissions. Therefore a submission that was validated **before** this fix and carries a blank row with a
stored `ok` could be approved and promoted as a zero after the fix is deployed. Whether any such submission exists is
exactly what census Section 3 lists.

**What the code now does (written 2026-10-09, not run):**

- **Promotion** of a `match_attendance` submission is refused whole if any retained cell is blank, missing, unreadable or
  out of range, or if a stored `resolved.attendance` disagrees with the parsed cell (§17.10), whatever the stored verdict.
- **Approval is unchanged.** A stale `validated` submission can still be approved; the refusal comes at promotion.

**What a refusal does to the submission (be exact).** The refusal is thrown from `preparePromotion` inside the
pipeline's promotion savepoint, before the import batch is inserted and before any `promoteRow`. The savepoint rolls
back, so **no `matches` row is written and no import batch is created**. It is **not** a no-write outcome for the
submission: the pipeline's catch then records the submission as `failed` with the refusal text in `error`, in the same
transaction (`pipeline.ts` catch around the savepoint). This is the same recording every other `preparePromotion`
refusal and every promotion error gets (contrast the `error`-verdict refusal at `pipeline.ts:342-347`, which returns
before any write and leaves status untouched). Consequences:

- An `approved` stale submission, on its first promote attempt, becomes `failed`.
- A `failed` submission (an earlier retryable lock refusal) stays `failed` with a new `error`.
- **A `failed` submission can be neither rejected nor re-validated** (`decideSubmission` accepts `staged`, `validated`,
  `approved` for reject; `validateSubmission` accepts `staged`, `validated`, `rejected`). Retrying it re-reads the same
  retained cell and refuses again. The way forward is to upload the corrected file as a new submission (the byte
  de-duplication in `stageSubmission` covers only `staged`/`validated`, so a new upload is not collapsed into it).
  Changing that is D-268-3 (§15), a shared-pipeline change, undecided.
- The hand remedy that avoids the dead end is therefore **before any promote attempt**: for a stale `validated` or
  `approved` submission, reject (an approved one must be rejected first) and re-validate; the blank row then becomes an
  `error` and cannot be approved. The refusal message says "upload a corrected file as a new submission" and does not
  advertise re-validation, because that is impossible once the submission is `failed`.

### 17.8 Census inspection record (2026-10-09; read only, nothing run)

- **Schema references** checked against migrations: `data_submissions` and `data_submission_rows` (023: `payload`
  jsonb, `reasons` jsonb, `verdict` text with the 044 CHECK `ok|warning|error`, `row_count`, `import_batch_id`,
  `content_sha256`), `import_batches` (001: `tool`, `target_table`, `status`, `notes`), `sources.key` (001),
  `matches.attendance*` (020). `reasons` is written as `{reasons, resolved}` (`pipeline.ts:240-243`) and promotion
  receives `reasons->'resolved'` (`:394`), so `resolved.attendance` is the figure handed to `promoteRow`; it is not a record of
  an affected row.
- **Defects found and fixed in the SQL:** the old test `payload->>'attendance' IS NULL` also matched a payload that is
  not a JSON object (e.g. double-encoded), which would have counted unreadable evidence as a blank cell; a bare
  `(…)::int` cast of `resolved.match_id` could error on another shape; it did not separate a zero beside a nonblank
  cell from a blank-derived zero; it ignored rows missing relative to `row_count`; it did not flag stale `ok` verdicts on not-yet-promoted
  submissions (§17.7); it did not look for promotions whose submission is no longer retained; the target block was
  database/role only.
- **Transaction boundaries:** `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY` … `ROLLBACK`; all
  sections share one snapshot; `SET LOCAL` timeouts end with the transaction; `ON_ERROR_STOP` makes a failure
  exit 3 before `== Done.`. Temporary tables and views are impossible in a read-only transaction, so the
  classification is repeated per section rather than materialised.
- **Retention limits:** no production code deletes submissions (only integration tests, on test databases);
  `afldb_auth` holds DELETE on `data_submission_rows` (023), so a row shortfall is possible and is counted;
  direct SQL could delete a submission, which Section 5 can reveal only through the batch it leaves behind.
- **Evidence labels corrected (2026-10-09, second revision).** The first revision called a promoted submission with a
  retained blank cell resolved to 0 a "confirmed historical write" (`CONFIRMED_BLANK_PROMOTED_AS_ZERO`). That is a
  recorded promotion of a blank-derived zero; it does not by itself show the UPDATE affected a canonical match (the match
  may have been deleted before promotion, and `promoteRow` keeps no row count, before-image or `matches` batch link).
  The SQL now keeps four kinds of evidence apart: *recorded promotion* (`RECORDED_BLANK_PROMOTED_AS_ZERO`); *current
  match state* (`state_vs_promotion`: `MATCH_ABSENT_NOW` / `STATE_CONSISTENT_WITH_PROMOTION` /
  `STATE_DIFFERS_OR_LATER_WRITE`, plus a constant `write_evidence = 'none retained'`); *possible exposure* (Sections 3
  and 4, whose old label `CONSISTENT_WITH_BLANK_WRITE` is now `CURRENT_ZERO_WITH_RECORDED_BLANK_PROMOTION`); and
  *missing evidence* (`UNDETERMINED_*`, short-of-declared, Section 5). **"Confirmed canonical write" is reserved for
  row-level write evidence and this census cannot produce it.** Section 3's notes now state the `failed` consequence of
  §17.7. The summary column `confirmed_blank_promoted_as_zero_rows` is now `recorded_blank_promoted_as_zero_rows`.
  Historical impact remains unassessed. Still never executed.
- **Evidence labels corrected again (§17.12.2).** The second revision still called a nonblank retained cell beside a stored
  resolution of 0 a "typed zero" (`TYPED_ZERO`, `TYPED_ZERO_PROMOTED`, "a genuine zero"). A stored resolution of 0 does not prove
  the cell parsed to zero, so that is now `NONBLANK_CELL_STORED_ZERO`; the cell states `typed` and `other_json_type` became
  `nonblank_string` and `non_string_value`; and the claim in the header that the stored resolution proves what promotion wrote
  is replaced by "the figure handed to `promoteRow`, not an affected row".
- **Corrected again (§17.13).** `NONBLANK_CELL_STORED_ZERO` is now described as "input interpretation unverified; investigate
  before concluding" (it establishes neither a valid zero nor the absence of exposure), the retained cell text is printed beside
  it, and a stored resolution with no usable `match_id` is `MATCH_IDENTITY_UNKNOWN`, not `MATCH_ABSENT_NOW`.
- **Not verified (historical, at the time of this inspection):** the census had not been executed anywhere. *Since run (§17.14):* every
  statement parsed on DEV and PROD, but both returned empty, so the classification logic was not exercised against populated rows.

### 17.9 Observations, not acted on (numbered 17.6 in earlier drafts)

- The dataset still accepts a typed `0` without a citation field (the review's contrast with `match_results`
  refusing an uncited explicit 0). The review's §14 fixed `0 → ok`; whether this dataset should additionally
  require a citation is an unresolved design question, outside the proposed fix boundary, and not decided here.
- AFLDB-ISSUE-305 (other legacy datasets' numeric parsing) is untouched.

### 17.10 Promotion-time re-check of the retained cells (written 2026-10-09, uncommitted; "NOT run" below is historical, the cases were run, §17.11)

Operator-authorised as part of the blank → error fix ("close the stale-verdict path"), through `match_attendance`'s
existing `preparePromotion` hook, which `promoteSubmission` calls before the import batch is created and before any
`promoteRow`. No other dataset, no approval rule and no pipeline code changed.

- **What it checks (all rows, before the gate, any lock or any write; DB-free).** For every row of the submission:
  the retained payload must be a JSON object; its `attendance` cell is read by the **same** `readAttendanceCell` the
  validator uses (blank, missing, non-string or out of range → refuse; nonblank spellings and a typed `0` accepted exactly
  as `validateRow` accepts them); and the stored `resolved.attendance` must equal the parsed figure exactly (a typed `41000`
  stored as `0`, a `0` stored as a figure, a null or text figure are all refused, never silently corrected). The existing
  `resolved.match_id` check runs first and keeps its message.
- **Refusal.** One thrown error for the whole file, naming the first offending row and the count of the rest:
  `Nothing was promoted: N of M rows fail the attendance check applied at promotion (Row k: …; j more). The stored verdicts
  predate it; upload a corrected file as a new submission.` A mixed valid/blank file is therefore refused whole, with no
  figure from it applied.
- **Order and timing preserved for a valid file.** The check precedes `withLegacyLockTimeout`, so a refused file never
  takes the exclusive settle/promotion gate or waits on it; a valid file runs the unchanged sequence (read timeout, set 5 s,
  gate, one ascending `FOR NO KEY UPDATE`, restore). The retryable `55P03`/`40P01` translation is untouched.
- **What a refusal records:** see §17.7 (submission `failed`, nothing else written; `failed` is a dead end for reject and
  re-validation, D-268-3).
- **Tests (written, NOT run).** `tests/ingest-datasets.test.ts`, new `describe('AFLDB-ISSUE-268 match_attendance promotion
  re-check of the retained cells')`, DB-free, driving the hook with rows exactly as the pipeline hands them over:
  stale `ok` rows with a null, empty, whitespace or absent cell resolved to 0 each refuse with **no query at all**; a
  four-row mixed file refuses whole naming row 2 and "1 more"; the message does not advertise re-validation; six
  malformed or out-of-range cells; a double-encoded string, a null and an array payload as unreadable; a numeric cell value;
  five resolved/cell disagreements; `0` cells (and a padded one) resolved to 0 accepted with the unchanged gate, ascending lock and
  `5s`→`7s` timeout sequence; twelve accepted spellings (`0`, `1`, `41000`, padded, `0042`, `200000`, `1e2`, `0x10`, `+5`,
  `1.0`, `0e0`, `+0`); and a 22-cell drift guard asserting that `validateRow` and the hook agree on every cell.
  `tests/integration/match-results-promotion.test.ts`, new nested `describe('AFLDB-ISSUE-268 match_attendance blank cells
  and stale verdicts')` (real pipeline, `afldb_test`, the fixture clubs and `R258*` matches that file already cleans up):
  a stale `ok` blank row inserted as an `approved` and as a `failed` submission each refuses through `promoteSubmission`,
  leaves the match at `not_collected`/no source, creates no import batch, **is recorded as `failed` with the refusal text**,
  and refuses again on retry; a mixed file (valid, blank, valid) applies nothing to any of its three matches; a `41000`
  cell stored as `0` is refused, not corrected; a blank cell validated afresh is stored as an `error` row and
  `promoteSubmission` refuses it, leaving the status as the test helper forced it (`approved`) with no `error` written (the
  helper sets the status with a direct UPDATE, so the **approval action** is not exercised: this proves validation and
  promotion only); a `0` cell validates, promotes and stores a `complete` zero with the manual-source provenance
  (`manual_admin_edit`) that `promoteRow` records for every figure of this dataset (the file has no citation column, so no
  separate citation is supplied); `1e2`, `0x10`, padded `41000` and `0042` still promote as 100, 16, 41000, 42. Their expected
  outcomes were derived by reading the code; **none has been run**. The fixture ownership these cases rely on is §17.12.1.

### 17.11 The operator's checks (current evidence)

**2026-10-09, after the review round, operator-run, reported (current):**

- **15:11:57:** `tests/ingest-datasets.test.ts` **181/181** passed; TypeScript passed; ESLint passed; `git diff --check` passed.
  (Corrected 2026-10-09: the operator confirmed that the 15:11:57 ESLint command covered `src/lib/ingest/datasets.ts`,
  `tests/ingest-datasets.test.ts` and `tests/integration/match-results-promotion.test.ts`. The earlier note that the report named no
  file list is superseded.)
- **Target verified** for the integration runs: database `afldb_test`, role `afldb_owner`, tunnel `127.0.0.1:55432`.
- **Targeted ISSUE-268 integration cases** (`tests/integration/match-results-promotion.test.ts`, filtered to the ISSUE-268
  cases):
  - **15:21:42:** 7 passed, 32 filtered skips, duration 45.78 s.
  - **15:30:35:** 7 passed, 32 filtered skips, duration 46.01 s.
- **No suite or hook failures** in either run. Both passed the fixture preflight (§17.12.1) and the cleanup assertions.
- **Limits, stated plainly.** All three pools (owner, auth, import) used the **test owner connection temporarily**, so the
  restricted-role path (`AFLDB_TEST_IMPORT_DATABASE_URL`) and its permissions were **NOT validated**. The **full integration file
  was NOT run**: 32 other cases were filtered out, including the ISSUE-258 and ISSUE-264 cases whose sibling hooks were not
  changed. The approval action is still not exercised (§17.12.3). A pass on `afldb_test` as owner proves the logic, the
  fixture hooks and the refusal/promotion outcomes; it does not prove behaviour under the roles DEV and PROD use.
- **State after the runs:** nothing is committed or deployed. *(Historical: "Both censuses remain unrun" when this was recorded; both
  have since been run, §17.14.)* Historical impact remains unassessed; nothing was repaired.
- **Not covered by these results:** the census SQL and the tracking files, which were edited after (§17.13). The source files
  and tests were not edited in that later round.

**Superseded record, 2026-10-09 14:26:48, operator-run, reported:** `tests/ingest-datasets.test.ts` **181/181** passed; TypeScript passed; ESLint
passed on `src/lib/ingest/datasets.ts`, `tests/ingest-datasets.test.ts` and `tests/integration/match-results-promotion.test.ts`;
`git diff --check` passed. This covers the validator, the shared cell reader, the promotion-time re-check and the DB-free
tests **as they stood at 14:26:48**. It does not cover the integration file's behaviour (the file was type-checked and linted
only; it was **not run**), the census SQL (never run), or anything changed afterwards (§17.12: the integration hooks, comments in
`datasets.ts`, a test title and comment in `tests/ingest-datasets.test.ts`, the census SQL and the tracking files). It was
**superseded by the 15:11:57 round above** for the unit file, type check, lint and diff check. The earlier
122/122 result (before the re-check existed) is superseded and not counted.

### 17.12 Review round (2026-10-09, third revision; edited by reading only, nothing run)

Four findings from review, none run.

**17.12.1 Integration fixture ownership.** `tests/integration/match-results-promotion.test.ts` nests the ISSUE-268 block inside the
ISSUE-258 describe, so two ancestor hook pairs run for it: the file-level `beforeAll`/`afterAll` and the ISSUE-258 pair. They
adopted season 2073 (`INSERT … ON CONFLICT DO NOTHING`), wrote before the auth-pool target check, and deleted by season
(`DELETE FROM matches WHERE season = 2073`; `… AND round_code LIKE 'R258%'`; `DELETE FROM seasons`). They are now:

- **Read-only preflight before the first write** (file-level `beforeAll`): the owner and auth pools must reach the same
  `_test` database (check moved up from the ISSUE-258 hook); season 2073 must have no `seasons` row, no `matches`, no
  `club_seasons`; no `afldb-issue-258-fixture-*` club or organization; none of the fixture players by name; and the fixture
  `auth_users` row, if it exists, must be `super_admin`. Any hit throws, naming what exists, before anything is written and with
  cleanup left disabled (`preflightPassed` false, every ownership record empty).
- **Ownership recorded as it is created.** The season is inserted with a plain `INSERT` (no `ON CONFLICT`) and `seasonOwned` is set
  only after it returns. Fixture clubs and organizations are recorded only after their transaction commits. Matches the
  pipeline created are claimed at teardown from the batches of this run's own submissions (`import_batches.notes =
  'submission N'`, `tool = 'admin-upload'`, season 2073); the one match the file inserts directly (ISSUE-185 case `R185F`, no
  batch) records its id from `RETURNING`. Submissions and players are deleted by recorded id.
- **Owned-only teardown, foreign rows reported.** Both `afterAll`s delete `WHERE id = ANY(<owned ids>)`; neither deletes by season
  or round-code prefix any more. Each step is isolated so a foreign row that blocks one (for example a match still referencing a
  fixture club) is recorded and the rest still run. Any season-2073 match, or any `afldb-issue-258-fixture-*` identity, this run
  does not own is left in place and reported. Everything unremoved is thrown once at the end of the file, after the connection
  closes. Both hooks return immediately if the preflight did not pass.
- **Retained by design, never deleted:** the fixture `auth_users` row and the `sports_data_lab` source (shared, idempotent
  seeds; unchanged), and the `import_batches` rows the promotions create (append-only).
- **Consequence the operator will see:** residue left by an earlier failed run (for example season 2073 on `afldb_test`) now makes
  the file refuse to start instead of being adopted and deleted. Remove it by hand, after looking at it.
- **Not changed (sibling hooks, not ancestors of the ISSUE-268 block):** the ISSUE-264 block's own hooks and the nested F-002
  `afterAll`, whose `DELETE FROM club_seasons WHERE season = 2073` is still by season. The new preflight proves season 2073 holds no
  `club_seasons` row at the start, which is what makes that statement safe in practice; it is not itself owner-scoped.

**17.12.2 Census evidence labels.** See §17.4 and §17.8: `NONBLANK_CELL_STORED_ZERO` replaces `TYPED_ZERO`;
`nonblank_string`/`non_string_value` replace `typed`/`other_json_type`; the stored resolution, the recorded promotion and the current
canonical state are separate columns; `STATE_CONSISTENT_WITH_PROMOTION` now compares the match to the stored resolution rather than
to a literal 0; Section 3 also lists unreadable input as missing evidence. The SQL notes that PostgreSQL's `\s` and the validator's
`trim()` may disagree about some whitespace characters, which is a further reason a nonblank cell is never called a verified zero.
The ledger, index, changelog and `blockers.md` wording were updated to match.

**17.12.3 Test claims.** The fresh-blank integration case is renamed and commented to say that its `approveAndPromote` helper sets
the status directly, so it proves validation storing an `error` row and `promoteSubmission` refusing it, not the approval action.
The typed-zero case is renamed: a `0` cell promotes as a complete zero with manual-source provenance, and no separate citation is
supplied. A comment in `datasets.ts` and the unit-test header no longer call the old behaviour a "cited" zero, and the unit title
"accepts a genuine typed zero" now says what it checks. The approval action itself remains untested here.

**17.12.4 `blockers.md`.** R1/C5 (N2 unknown → locate existing evidence first), C6 (different provenance is not a contradiction),
and the audit continuation are recorded in that file; nothing in this runbook depends on them.

### 17.13 Census and register corrections after the integration runs (2026-10-09; edited by reading only, nothing run)

Edited after the 15:11:57–15:30:35 runs in §17.11. No source file and no test was changed. The census was still unrun at that point (it was run afterwards, §17.14).

- **Missing match identity.** Section 2's `state_vs_promotion` used to report `MATCH_ABSENT_NOW` both for a known `match_id` with no
  `matches` row and for a stored resolution with no usable `match_id`. Those are different facts. A resolution with a missing
  or non-numeric `match_id` is now `MATCH_IDENTITY_UNKNOWN` (missing evidence: the match the promotion named cannot be read);
  `MATCH_ABSENT_NOW` is reserved for a known id with no row today. `later_promoted_writes` is NULL for an unknown identity, and
  the Section 2 summary line counts such rows (`recorded_blank_zero_match_identity_unknown_rows`,
  `nonblank_cell_stored_zero_match_identity_unknown_rows`). Section 4 starts from `matches`, so it cannot attribute these rows; its
  comment says they appear only in Section 2.
- **`NONBLANK_CELL_STORED_ZERO` wording.** A nonblank retained cell beside a stored 0 does **not** establish a valid zero and does
  **not** establish the absence of exposure. The "neither an exposure nor a verified zero" wording is replaced by "input
  interpretation unverified; investigate before concluding" in the SQL header and section notes, §17.4, §17.5, §17.8, §17.12.2,
  `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` and `blockers.md`.
- **Retained cell text printed.** Section 2 (`retained_cell_json`), Section 3 (`retained_cell_json`) and Section 4
  (`nonblank_cells_json`, the distinct retained texts of the nonblank cells beside a stored 0 for that match) print the cell as JSON
  text (cut at 120 or 200 characters): quotes show a string and keep its whitespace visible, `null` is a blank cell, NULL means the
  key is absent or the payload is not an object (`retained_input_state` says which). Section 1 stays counts only.
- **`blockers.md`.** The ACCEPTED label now requires an explicit acceptance record; rows that lacked one were reclassified or split
  (see that file's *Classification audit*). The register's coverage audit continued and is still marked INCOMPLETE.

### 17.14 Operator-run censuses, DEV and PROD (2026-10-09; recorded from the operator's returned results, edited by reading only)

The implementer ran nothing (CLAUDE.md §9). Both runs were operator-run with `issues/open/AFLDB-ISSUE-268-blank-attendance-census.sql`
as it stood after §17.13 (only its header comments were edited afterwards, to record this run).

| | DEV | PROD |
|---|---|---|
| Snapshot | 2026-10-09 15:59:22.305028+11 | 2026-10-09 16:02:57.217989+11 |
| Database / role | `afldb_dev` / `afldb_import` | `afldb_prod` / `postgres` (socket connection) |
| PostgreSQL | 16.15 | 16.15 |
| Transaction | read-only, repeatable-read | read-only, repeatable-read |
| Completion | ran through `== Done.`; the operator block returned successfully | ran through `== Done.`; explicit `psql` exit status 0 |

**Results (identical on both):**

- **Section 1:** no retained `match_attendance` submissions.
- **Sections 2–3:** no rows; every Section 2 summary count zero.
- **Section 4:** no rows; `manual_zero_crowd_matches` = 0.
- **Section 5:** no rows; `match_attendance_batches`, `with_retained_submission` and `without_retained_submission` all zero.
- **Syntax:** every census statement parsed successfully on both databases.

**What this does and does not establish.**

- **No exposure was found in the records checked:** no retained submission, no manual-source zero crowd, and no `admin-upload`
  `match_attendance` batch on either database at the snapshot.
- **Not exercised:** the classification of populated rows. With nothing retained, `cell_state`, `state_vs_promotion`, the
  `NONBLANK_CELL_STORED_ZERO` and `MATCH_IDENTITY_UNKNOWN` handling and the Section 3 `STALE_VERDICT` flags produced no output, so none of
  that logic was tested against data.
- **Historical impact remains unassessed.** An empty census is present-state evidence over retained submissions and current match
  state; it is not clearance of the past. Submissions deleted outright, or a before-image the legacy path never kept, are outside
  what it can show (header, *WHAT IT CANNOT SHOW*).
- **Nothing was repaired.** No repair is indicated by these outputs. A future repair would need separate evidence and a separate
  operator authorisation (§15).
- **The censuses installed nothing.** They are read-only; the fix is not on either host.
- **D-268-2:** neither database retained a `match_attendance` submission, so there is no stale `validated` or `approved` submission to
  reject and re-validate on either (Section 3 empty).

**Status after this record.** ISSUE-268 stays **Open**: validated on `afldb_test` (DB-free file 181/181 at 15:11:57; the seven targeted
integration cases twice as the test owner; restricted-role and full-file integration coverage NOT validated), both censuses complete,
**uncommitted and undeployed**. Remaining: review/commit, `merge:ready`, merge/push, DEV deployment and acceptance. PROD installation
stays behind the unchanged ISSUE-265 hold. D-268-1 and D-268-3 are separate follow-ups, not merge gates for this issue.
