# AFLDB-ISSUE-273 — Submission validation overwrites a concurrent approve, promote or reject

## 0. Status

- **Status:** Open (2026-10-08). Fix implemented 2026-10-11 on `opus/issue-273`. Integration passed on
  `afldb_test` on 2026-10-11 (§18), except the existing ISSUE-264 State-B block. D-273-1 was approved and implemented on
  2026-10-11 (§19); its DB-free and `afldb_test` checks pass. Residual §19.5 was fixed on 2026-10-11 (§20); its DB-free
  and `afldb_test` checks pass. Final review corrections (integration teardown, tracking) on 2026-10-11 (§21); committed
  on `opus/issue-273`, not merged.
- **Severity:** Medium. **Area:** legacy CSV intake / submission lifecycle concurrency.
- **Key file:** `src/lib/ingest/pipeline.ts` (`validateSubmission`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-008; partition note R5a-F03). The main session re-read `pipeline.ts:184-258`.
- **Classification:** code-proven (the timing is operator-driven).

## 1. Summary

`validateSubmission` checks the submission's status once at start, then rewrites every row verdict in autocommit statements, and finally runs `UPDATE data_submissions SET status = 'validated' … WHERE id = $1` with no status predicate. The loop runs about five queries per row, which is minutes for a large file. An approve, promote or reject that lands during that time is silently overwritten.

## 2. Evidence

- `src/lib/ingest/pipeline.ts`:
  - `:184-191`: the start-time status check.
  - `:237-245`: per-row verdict and `resolved` rewrites.
  - `:251-256`: the final status write, with no CAS.
- `src/app/admin/submissions/[id]/actions.ts:15, :48-58, :65-71`: validate, approve and reject.
- `pipeline.ts:313-341`: promote locks the submission row, but reads `data_submission_rows` without a row lock.
- ISSUE-175 (`issues.md:28264-28291`) added CAS to promote and reject, not to validate.

## 3. Trigger

1. A submission is `validated`. Admin A clicks Validate, and the run is long.
2. Meanwhile a super admin Approves and then Promotes (or Rejects).
3. The validation loop finishes.

## 4. Expected invariant

The final write transitions only from the state the run started in. If the state moved, the run reports a refusal (the ISSUE-175 rule).

## 5. Actual behaviour

- A promoted submission reverts to `validated` (with `promoted_at` / `import_batch_id` still set), and it can be approved and promoted again, stamping a second import batch.
- A rejection is silently undone, while `reviewed_by` / `reviewed_at` still name the rejecter.
- Promotion can consume row payloads from two different validation runs.

## 6. First wrong layer

`src/lib/ingest/pipeline.ts:251-256`.

## 7. Impact

- Double promotion. Most upserts are idempotent, but `match_attendance` and `player_bio` re-apply, and a second batch id is stamped.
- Lost rejection verdicts.
- Mixed-run payloads can be promoted.

## 8. Reproduction / witness

Not executed (needs two concurrent sessions).

## 9. Disproof attempts

- There is no transaction or row lock around validation.
- There is no status re-check after the loop.
- Existing tests cover reject atomicity and promote-vs-promote/reject only (`tests/submission-review-actions.test.ts:44-70`, `tests/integration/submission-promotion.test.ts:169-272`).

## 10. Existing-issue search

- ISSUE-175 (resolved) names only promotion and reject.
- Classification: **new**. Cross-references ISSUE-175.

## 11. Scope

`validateSubmission`'s final status write and its concurrency with review actions.

## 12. Out of scope

The re-validation of a `rejected` submission by a plain admin (recorded as INFO in the review).

## 13. Proposed fix boundary

- Capture the start status. Add `AND status = <start status>` to the final UPDATE and return an error when 0 rows change.
- Optionally guard the per-row writes the same way, or refuse to start while a run is in flight.

## 14. Proposed validation

1. Unit test with a stubbed `authSql`, asserting that the final UPDATE carries the CAS predicate.
2. Integration: start a validation, flip the status to `rejected`, and assert it stays `rejected`.

## 15. Decisions / unresolved questions

- Keep `xmin` as the version check: decided (operator, 2026-10-11).
- **D-273-1 (approved, operator, 2026-10-11).** Implement the email-intake race handling within this issue (§19).
- **§19.5 residual (decided, operator, 2026-10-11).** Stop the intake's validation reopening a reject that landed before
  its first read: fixed in this issue with a caller-specific start policy (§20).

## 16. Next action

Committed on `opus/issue-273` (§21). Operator merge, then DEV deployment; see §19.6 and §21.6 for the remaining
acceptance.

## 17. Implementation pass 1 (2026-10-11)

Worktree `D:\dev\afldb-issue-273`, branch `opus/issue-273`, base `f35e7cd39e68a5fd49050807bd3ade4c35cf2736` (equal to fetched
`origin/main`). Uncommitted. No migration, grant or deployment.

### 17.1 Why a final status CAS alone is not enough

- The per-row verdict writes were autocommit statements. A reject or promote that lands mid-loop leaves rows from two runs.
  A run that throws part-way leaves a partial rewrite.
- A status CAS cannot see A→B→A. For example: a reject, then a fresh validation, returns the row to `validated` under an
  older run.
- Approve's guarded UPDATE re-checks `status` on the row it waited for. Its `NOT EXISTS` error-row subquery still reads
  its pre-wait snapshot. So an approve that queues behind a validation's commit can approve verdicts that the validation
  has just replaced with errors.

### 17.2 Mechanism

- `validateSubmission` (`src/lib/ingest/pipeline.ts`):
  - It reads `status` and `xmin` at start.
  - It computes every verdict with no transaction and no lock (unchanged validators), and holds them in memory.
  - It then opens ONE transaction:
    1. `SELECT status, xmin … FOR UPDATE`.
    2. Refuse with `SubmissionChangedError` unless both equal the starting values.
    3. Bulk-write the verdicts in 500-row `jsonb_to_recordset` statements, each checked for its row count.
    4. `UPDATE … SET status = 'validated' … WHERE id AND status = <start>`.
  - Any throw rolls back every row write.
- Approve (`src/app/admin/submissions/[id]/actions.ts`) now runs `SELECT … FOR UPDATE` and then its unchanged guarded
  UPDATE in one transaction. The subquery then sees committed verdicts. Reject is unchanged: it has no subquery.
- Lock order is the submission row first, then rows, on every path (validate, approve, promote). Promote already locks
  first, and a validation can commit only from `staged`, `validated` or `rejected`. So promotion never reads a partial
  or foreign rewrite.
- Permissions: `afldb_auth` already holds table `UPDATE` on both tables (migration 023), which covers `FOR UPDATE` and
  `xmin`.
- The long validator loop holds no lock and no connection beyond today's. The submission lock is taken only inside the
  final write transaction.
- The auth pool's 5 s `statement_timeout` bounds each statement on its own, including the time that statement spends
  waiting for a lock. It does not bound the whole transaction, how long the submission lock is held, or a caller's total
  wait across statements. The write transaction runs one lock statement, ⌈rows ÷ 500⌉ verdict statements and one status
  statement, plus client round trips between them. A large file can therefore hold the lock for longer than 5 s.
- An approve or reject (auth pool) that waits on that lock fails its own statement after 5 s and reports the error.
  A promotion runs on its own import-role connection, which sets no `statement_timeout` in code, so it waits until
  the lock is released (or until a server- or role-level setting cancels it). In every case nothing is overwritten.

### 17.3 Behaviour changes

- A validation that loses any race now throws, and writes nothing:
  - The admin Validate button shows the message.
  - Email intake returns its existing 500 "staged but validation failed" response.
- Of two overlapping validations, the first to commit wins whole. The other is refused.

### 17.4 Checks run (DB-free)

- `npx vitest run tests/submission-review-actions.test.ts`: 13/13 (3 existing, 10 new).
- Differential with the pre-fix `pipeline.ts` and `actions.ts`: 10 of the new tests fail; the 3 existing tests pass.
- `npm run typecheck` (`tsc` after `next typegen`): clean. eslint on the four touched source/test files: clean.
- Full unit suite excluding `tests/integration` and `tests/nl-ui`:
  - The failures are 8 files and 10 tests, plus 2 suites that cannot load (`DATABASE_URL is not set`, because the
    worktree has no `.env`).
  - The same files on unchanged main reproduce the same failures, except `draftguru-acquisition` check 41z. That check
    pins the SHA-256 of a real ISSUE-222 Markdown artefact, and the artefact's hash in this worktree did not match it.
    The cause of that mismatch is unconfirmed: it was not investigated, and no environmental cause is established.
    None of these files touch submissions.

### 17.5 Integration (prepared 2026-10-11; run 2026-10-11, see §18)

New cases in `tests/integration/submission-promotion.test.ts` (ISSUE-273 block):

1. Normal validation: every verdict, `resolved` stored as a jsonb object, and the report.
2. A reject mid-validation stands; the rows keep their seeded verdicts.
3. Approve + promote mid-validation: the submission stays `promoted`, there is one import batch, and a re-approve is
   refused.
4. Two overlapping validations: the first wins whole, and the second is refused.
5. Reject, then a fresh validation, then the stale run: the stale run is refused on `xmin`.
6. An approve queued behind a validation write, which is held on a row lock, sees the new error verdict and refuses.
   This case discriminates the approve change.
7. A CHECK failure in the second verdict chunk rolls back the first chunk.
8. Gated on `AFLDB_TEST_AUTH_DATABASE_URL`: `afldb_auth` may `FOR UPDATE` and read `xmin`.

Procedure (operator):

1. Open the usual tunnel to `afldb_test`.
2. Run `node D:\tmp\issue273\run-issue273-integration.mjs --probe-only` (add `--port 55432` if `.env` still says 5432).
   It must print `OK` for all five DSNs: owner, `afldb_import` ×2 and `afldb_auth` ×2, all on `afldb_test`.
3. Run the same command without `--probe-only`. It runs `submission-promotion`, `match-results-promotion` (the real
   validate → promote path, as `afldb_auth`) and `email-intake`.

Pass criteria: all three files pass, with nothing skipped in the ISSUE-273 block. The launcher prints no DSNs, never
copies `.env`, and refuses any non-`_test` or wrong-role target. Fixtures are scoped to this suite and removed in
`afterAll`. Promoted import batches remain, as in the existing ISSUE-175 cases. PROD is untouched; the ISSUE-265 hold
stands.

## 18. Integration pass (2026-10-11, operator-authorised, `afldb_test` only)

Authorised for `afldb_test` only, with the files' own fixture creation and cleanup. No rebuild, no migration, and no
DEV/PROD database contact.

### 18.1 Pre-run review

- **Version check.** Status and `xmin` are read by one `SELECT` of the same tuple at start. They are compared as text
  after `SELECT … FOR UPDATE` in the write transaction (READ COMMITTED, so the locked read returns the latest committed
  version). A row lock alone (`FOR UPDATE` / `FOR SHARE` by promote or approve) sets `xmax` and leaves `xmin` unchanged,
  so a refused promote or approve does not refuse a validation. Every committed UPDATE does change it. Kept, as
  decided.
- **Approve isolation.** READ COMMITTED is the correct level. The guarded UPDATE is a later statement than the lock, so
  it takes a fresh snapshot that includes the verdicts the lock waited for. REPEATABLE READ would instead fix the
  snapshot at the lock statement and raise a serialisation failure.
- **Writers.** In `src/` and `tools/` the only writers of `data_submissions` / `data_submission_rows` are stage (new
  rows only), validate, approve, reject and promote. Validate, approve and promote lock the submission row first.
  Reject touches only the submission row. No path locks rows and then the submission.
- **Payloads and counts.** `reasons` keeps the pre-fix object shape `{reasons, resolved}`. Each 500-row chunk is checked
  for its affected-row count, and the status UPDATE is checked with `RETURNING`.
- **Launcher hardening** (`D:\tmp\issue273\run-issue273-integration.mjs`):
  - The database must be exactly `afldb_test`, and the owner role is pinned to the DSN's user.
  - The probe runs inside a READ ONLY transaction and requires all five connections to reach one server.
  - A malformed DSN reports only its variable name.
  - The vitest reporter is verbose.
  - `--verify-cleanup` gives read-only fixture counts.
  - The vitest child gets a random `AFLDB_EMAIL_INTAKE_SECRET` (see §18.3).
- **Documentation.** §17.2's `statement_timeout` sentence is corrected: the setting bounds each statement, not the
  transaction or the lock hold.

### 18.2 Results

- **Tunnel.** `ssh.exe -L 127.0.0.1:55432:127.0.0.1:5432 arm@10.0.40.100` (streamanator, the DEV host). The probe
  printed `OK` for all five connections:
  - owner `afldb_owner`;
  - `afldb_import` ×2;
  - `afldb_auth` ×2.

  All five were on `afldb_test` at `127.0.0.1:5432`, cluster `16/main`.
- **Final run.** 47 passed, 22 skipped, 1 failed suite.
  - `submission-promotion`: 15/15, including all eight ISSUE-273 cases and the real `afldb_auth` lock/`xmin` case. Nothing
    was skipped.
  - `email-intake`: 9/9 executed. 8 ran in the final run and 1 in the previous run; see §18.3.
  - `match-results-promotion`: 23 passed. The `AFLDB-ISSUE-264 durable Match Sheet authority` block's `beforeAll`
    threw "this database does not admit player_match_stats authority (migration 110)", so its 22 tests were skipped.
    This is an existing environmental condition, not a regression:
    - `afldb_test` is deliberately kept in State A, without migration 110 (`issues.md`, ISSUE-264/265 records).
    - The block needs State B.
    - ISSUE-273 touches none of that file or its code path.
    - Applying migration 110 was outside the authorisation.
- **Cleanup.** Read-only counts were taken before the run and after each run:
  - Fixture submissions, submission rows, players, clubs, and season and matches 2073 were all 0 every time.
  - Fixture `auth_users` rose from 2 to 3. The files retain that row by design.
  - Promoted import batches are retained, as before.

### 18.3 Email intake contract (inspected, not changed)

- **Vacuous passes.** Without `AFLDB_EMAIL_INTAKE_SECRET`, 8 of the 9 `email-intake` cases `return` early and report a
  pass. The first run passed vacuously this way. The launcher now sets a random per-run secret. The case "refuses
  … when no secret is configured" is the mirror image: it returns early when a secret is set, and it ran for real in
  the previous run.
- **Route.** `SubmissionChangedError` reaches the generic catch in `src/app/api/admin/email-intake/route.ts:195-207`,
  which returns HTTP 500 "staged but validation failed".
- **Poller.** `tools/email_intake/fetch_and_stage.py:601-603`:
  - Every 5xx, 408, 429, network error and timeout is a `TransientFailure`. The message is left unseen and re-POSTed on
    the next timer run.
  - Any other 4xx is a `PermanentFailure`. The message is filed under Errors and the script exits 1.
  - A 2xx is filed under Processed; the reply is read with `.get()` only.
- **Dedup.** `stageSubmission` resolves a resend only to a submission still in `staged` or `validated`
  (`pipeline.ts:86-94`).
- **Consequence.** A retry staging a second submission depends on what the run lost to:
  - **Another validation.** The status stays `validated`, so the retry dedups to the same submission and re-validates
    it. This is safe.
  - **A human approve, reject or promote** (or a reject of a still-`staged` file). The retry finds no `staged` or
    `validated` match and stages a **second submission** of the same file. Pre-fix, the same race silently reverted the
    human decision instead. The duplicate goes back to review; it is not applied.
  - **Pre-existing path.** A poller timeout (180 s) followed by a human decision before the retry also stages a second
    copy.
- **Recommendation (D-273-1).** In the route, catch `SubmissionChangedError` separately and re-read the submission's
  status:
  - If it is no longer `staged` or `validated`, a human has ruled on the file. Return 200 with `ok: true`, the
    `submissionId`, `validated: false`, the current status and `reviewUrl`, and audit `email_intake.validation_superseded`.
    The poller files it under Processed and no second copy is staged. 409 would also stop the retry, using the poller's
    existing permanent-4xx rule, but it files a handled message under Errors and exits 1.
  - If it is still `staged` or `validated`, keep the 500. The retry dedups to the same submission.
  - Add an integration case.

## 19. D-273-1 implementation (2026-10-11)

Operator approval, 2026-10-11: implement the email-intake race handling within ISSUE-273. Same worktree and branch,
uncommitted. Migration 110 untouched; no DEV/PROD contact, commit, push or deployment.

### 19.1 Change

- `src/app/api/admin/email-intake/route.ts`:
  - The validation `catch` tests `error instanceof SubmissionChangedError`. Only then does it re-read
    `SELECT status::text FROM data_submissions WHERE id = …` on `authSql`, the route's existing `afldb_auth` path.
  - **Decided** (`approved`, `rejected`, `promoted`, `failed`): HTTP 200 with `ok: true`, `submissionId`,
    `duplicate`, `rowCount`, `validated: false`, `status`, `message` and `reviewUrl`. `validated: false` and the
    message describe this validation attempt only. (As first written, the message said "this delivery wrote nothing
    and the submission is unchanged". That overstated it: the delivery may have staged the file, and the reviewer
    changed the submission. Corrected in §20.) The route audits
    `email_intake.validation_superseded` with `{ submissionId, dataset, filename, status }`.
  - **Everything else keeps the existing 500 body and the `email_intake.validate_error` audit:** `staged`, `validated`
    (lost to another validation), a missing row, a re-read that throws, a status outside the list, and every
    non-`SubmissionChangedError` failure (no re-read).
- **Other legal statuses.** The enum (migration 023) is `staged, validated, rejected, approved, promoted, failed`.
  `failed` is treated as decided:
  - It is reachable only as approve, then a promotion that raised.
  - It stays re-promotable from the review page.
  - Dedup excludes it, so a retry would stage a second copy.
- `tools/email_intake/fetch_and_stage.py`: on `validated is False` the poller logs a superseded line instead of
  "staged: …" (wording corrected in §20). Filing is unchanged: any 2xx JSON object goes to Processed.

### 19.2 Audit failure policy

- `audit()` (`src/lib/auth/session.ts`) awaits its INSERT and throws on failure.
- **The superseded audit is best effort.** It uses `.catch(…)` and logs to `console.error`, so an audit failure cannot
  turn a handled race back into a 500 and a retry. A unit case pins this.
- **The re-read is not best effort.** If it throws, the route returns the 500 and the poller retries. Where a reviewer
  had in fact ruled, that retry stages a second copy. This is accepted: an unconfirmed status must not be acknowledged.
- **Pre-existing, unchanged.** Three other audit writes are not best effort:
  - `email_intake.staged` and `email_intake.duplicate` are awaited outside any `try`. A failure there escapes as a bare
    500.
  - `email_intake.validated` sits inside the validation `try`. A failure there, after a successful validation, is
    reported as the "validation failed" 500.
  - Both cases retry and dedup to the same `staged`/`validated` submission. A second copy follows only if a reviewer
    rules before the retry, the same exposure as the 180 s poller timeout.

### 19.3 Validation

- **DB-free.**
  - `tests/email-intake-route.test.ts` (new; the route had no unit home): 11/11. It covers 4 decided statuses → 200 with
    the exact body; `staged`, `validated`, missing, unknown status and re-read failure → 500; an ordinary error → 500
    with no re-read; and a superseded audit failure → still 200.
  - `tests/submission-review-actions.test.ts`: 13/13.
  - `python tools/email_intake/test_fetch_and_stage.py`: all checks passed. The new
    `test_main_files_a_superseded_validation` drives the real `main()` and `post_to_intake` over a fake `urlopen`:
    - The superseded 200 is filed Processed with exit 0.
    - The lost-race 500 is left unread with `EXIT_TEMPFAIL`.
  - `npm run typecheck` and eslint on the changed TypeScript files are clean.
- **`afldb_test`.**
  - Launcher `D:\tmp\issue273\run-issue273-integration.mjs --port 55432`. All five connections were re-probed first:
    owner, `afldb_import` ×2 and `afldb_auth` ×2, all on `afldb_test`, one server.
  - `email-intake` 15/15. The suite now fails instead of returning early when `AFLDB_EMAIL_INTAKE_SECRET` is unset. The
    503 case unsets the secret for itself, so all 15 ran.
  - The 6 new race cases park a delivery inside `validateRow` while the real `decideSubmission` and `promoteSubmission`
    commit. They cover:
    1. A reject during the first delivery: 200 `rejected`. The payload is as uploaded, the verdict null, the report
       null, `reviewed_by` set, one submission for the SHA-256.
    2. and 3. An approve, and an approve then promote, during a resend: 200 `approved` or `promoted` with
       `duplicate: true`. Rows are byte-equal to before the resend, there is one submission, and the promote case has
       one import batch.
    4. Losing to another validation: the existing 500 body, status `validated`. The retry returns 200 `duplicate: true`
       with a fresh report, and there is one submission.
    5. An ordinary validation failure: the existing 500, status `staged`.
    6. A submission deleted mid-validation: the 500, not an acknowledgement.

    Each case also asserts the exact sequence of `email_intake.*` audit actions.
  - `submission-promotion` 15/15.
  - `match-results-promotion`: 23 passed. **Known incompatible block, reported separately:** the ISSUE-264 describe's
    `beforeAll` throws "this database does not admit player_match_stats authority (migration 110)" and its 22 tests are
    skipped. Vitest therefore reports 1 failed suite and exits 1, so the combined run does not pass in full. The cause
    is environmental (State A); migration 110 was not applied.

### 19.4 Cleanup (read-only counts, before and after)

- Fixture submissions, submission rows, players (now including `AFLDB-ISSUE-273 %`), clubs, and season and matches
  2073 were 0 before and 0 after.
- **Retained users.** Three fixture users, unchanged, all enabled `super_admin`:
  - 89 `issue-185-promotion-test-fixture@afldb.test`
  - 92 `issue-175-promotion-test-fixture@afldb.test`
  - 193 `email-intake-test-fixture@afldb.test`
- **Retained import batches.** 40 new (ids 1991–2033, with gaps from rolled-back attempts), all `admin-upload`, and
  every one's submission has been deleted by its file:
  - 36 from `match-results-promotion` (`match_results`, `player_match_stats`, `match_attendance`).
  - 3 from `submission-promotion` (`player_bio`).
  - 1 from the new promote case: 2033, `player_bio`, `submission 1034`.
- **Retained audit rows.** 30 new `auth_audit_log` rows (ids 19–48), all from `email-intake`:
  - `email_intake.staged` 8, `validated` 7, `duplicate` 5, `validate_error` 3, `validation_superseded` 3, `rejected` 1.
  - `submission.approved` 2 and `submission.rejected` 1, from the real `decideSubmission`.

### 19.5 Residual found during implementation (fixed in §20)

- `validateSubmission` accepts `rejected` as a starting status (`pipeline.ts:250`), for the admin re-validate path that
  §12 keeps out of scope.
- The intake calls it after staging (or after a dedup match on `staged`/`validated`). A reject that commits in the few
  statements before validation's first read is therefore taken as the starting state, and the intake's validation
  rewrites it to `validated`. No `SubmissionChangedError` is raised, because nothing changed after the start.
- The window is narrow: the staging commit, one audit INSERT and the first SELECT.
- A fix would let the intake pass the statuses it may start from (`staged`, `validated`) and treat anything else as
  superseded.
- **Operator decision (2026-10-11):** fix it in this issue. Done in §20.

### 19.6 Remaining acceptance requirements

1. Operator review of the diff, then commit. The commit includes §17's pipeline/approve change, D-273-1, the §20
   start policy, the tests and the tracking.
2. ~~Decide the §19.5 residual.~~ Fixed in §20.
3. After merge:
   - DEV deployment, which deploys the poller script by checkout. Email intake is dormant on DEV (ISSUE-266), so DEV
     acceptance is a code-path check, not a mailbox run.
   - PROD remains subject to the ISSUE-265 hold.
4. Closure: resolve ISSUE-273 once deployed behaviour is accepted.

## 20. §19.5 fix: caller-specific validation start policy (2026-10-11)

Operator instruction, 2026-10-11: finish the intake race inside ISSUE-273. Same worktree and branch, uncommitted.
Authorised: local edits, DB-free checks, focused integration on the previously verified `afldb_test`. No commit, push,
deployment, migration, or DEV/PROD database contact. Migration 110 untouched.

### 20.1 Change

- `src/lib/ingest/pipeline.ts`:
  - `validateSubmission(submissionId, { startStatuses })`. The policy is checked against the same initial
    `SELECT dataset, status, xmin` that pins the run's starting version, so no change can land between the check and
    that version. A separate pre-check in the route would have left that window open, so there is none.
  - `REVIEW_VALIDATION_START_STATUSES` = `staged`, `validated`, `rejected`. This is the default, used by the review
    page's Validate button (`runValidation`, unchanged), so authorised manual re-validation of a rejected file still
    works.
  - `INTAKE_VALIDATION_START_STATUSES` = `staged`, `validated`.
  - A status outside the caller's list throws `SubmissionNotValidatableError`, which carries `submissionId` and the
    status that read returned. Nothing else is read and nothing is written. The message is the previous one ("submission
    is X; only staged files can be validated"), so the review page shows the same text as before.
  - A missing row still throws the plain "not found" `Error`. The final `SELECT … FOR UPDATE` status/`xmin` check and the
    single-transaction verdict write are unchanged.
- `src/app/api/admin/email-intake/route.ts`:
  - Validates with `INTAKE_VALIDATION_START_STATUSES`.
  - `decidedStatus(error, id)`. For `SubmissionNotValidatableError` it uses the error's own status, already confirmed by
    the initial read, with no re-read. For `SubmissionChangedError` it re-reads, as in §19. Either way, only
    `approved`, `rejected`, `promoted` or `failed` gets the D-273-1 200 and the best-effort
    `email_intake.validation_superseded` audit.
  - Unchanged 500s: a missing row, a failed read or re-read, an unknown status, `staged`/`validated` after a
    `SubmissionChangedError` (a lost race to another validation), and any other error.
- **Wording.** The 200 message is now "A reviewer has ruled on this file (it is now X); this validation attempt wrote
  no verdicts or resolved payloads." The poller logs "submission N is X by a reviewer; this validation attempt wrote no
  verdicts or resolved payloads". The route comment, §19.1 and the CHANGELOG were corrected to match. None of them now
  claims that the delivery wrote nothing (it may have staged the file) or that the submission was unchanged (the
  reviewer changed it).
- **Side effect, intended.** Before this fix, an approve or promote that landed between staging and the first read hit
  the old plain "only staged files" `Error`. The route answered 500, and the poller's retry staged a second copy. It
  now gets the same 200 acknowledgement.

### 20.2 Validation

- **DB-free.**
  - `tests/email-intake-route.test.ts` 18/18. New cases:
    - the intake passes `{ startStatuses: ['staged', 'validated'] }`;
    - a start refusal at each of `approved`, `rejected`, `promoted` and `failed` gets 200 with the exact body and no
      re-read;
    - an unknown status at start gets the 500;
    - a missing submission gets the 500.
  - `tests/submission-review-actions.test.ts` 22/22. New cases:
    - both policies are pinned;
    - the default re-validates `rejected` (the status CAS binds `rejected`);
    - the intake policy refuses `rejected`, `approved`, `promoted` and `failed` with `SubmissionNotValidatableError`
      after exactly one statement (the initial status/`xmin` SELECT), with no transaction and no dataset lookup;
    - the intake policy validates `staged` and `validated`;
    - `runValidation` passes no policy.
  - `python tools/email_intake/test_fetch_and_stage.py`: all checks passed. The superseded test now also feeds
    `main()` a start-refusal 200 (`rejected`, `duplicate: false`). Each answer is filed Processed with exit 0 after
    one POST, and is logged with the new line, never "wrote nothing" or "staged: submission".
  - `npm run typecheck`, eslint on the 7 changed TypeScript files, and `git diff --check` are clean.
- **`afldb_test`.**
  - Launcher `D:\tmp\issue273\run-issue273-integration.mjs --port 55432 --skip-match-results`. The new flag leaves out
    `match-results-promotion`.
  - The probe re-ran first: all five connections were `OK`, on `afldb_test`, one server, `16/main`.
  - `email-intake` 20/20, with no skips. The new cases use a `stageSubmission` wrapper hook that runs a real
    `decideSubmission` (and `promoteSubmission`) after staging has committed and before the route calls
    `validateSubmission`:
    1. A reject during a first delivery (`staged`), and a reject during a resend (`validated`).
    2. An approve during a resend, and an approve then promote during a resend.

    Each case asserts:
    - HTTP 200 with the exact acknowledgement body (keys as the poller test pins);
    - the decided status and `reviewed_by`;
    - `validation_report`, verdicts and `reasons.resolved` equal to before the delivery (null for the first delivery);
    - one submission for the SHA-256;
    - one import batch for the promote case;
    - the exact `email_intake.*` audit sequence ending `validation_superseded` with the status.

    A fifth new case: after the intake has acknowledged a reject, the real `runValidation` re-validates the file to
    `validated`, with an `ok` verdict and its resolved payload.
  - The 15 existing cases still pass, including the six §19 mid-run races and the lost-race 500.
  - `submission-promotion` 15/15.
  - `match-results-promotion` was not re-run. The default policy keeps its `staged` start unchanged, so this change
    gives no reason to repeat the known ISSUE-264 State-B refusal (migration 110) recorded in §18.2 and §19.3.
- **Differential.** None was run against the database. The rejected-at-start cases assert `rejected` and unchanged
  rows. Before this fix the run started from `rejected` and wrote `validated` with verdicts, so those cases would fail.

### 20.3 Cleanup (read-only counts, before and after)

- Fixture submissions, submission rows, players, clubs, and season and matches 2073: 0 before and 0 after.
- Retained, by design:
  - **Users.** The same 3 fixture users (89, 92, 193), all enabled `super_admin`.
  - **Import batches.** 5 new, all `admin-upload` `player_bio`, and every one's submission has been deleted by its file:
    2034, 2036 and 2038 (`submission-promotion`); 2039 and 2040 (the `email-intake` promote cases). The gaps are
    rolled-back attempts.
  - **`auth_audit_log`.** 52 new rows (ids 49–100):
    - `email_intake.staged` 13, `validated` 10, `duplicate` 8, `validation_superseded` 8, `validate_error` 3,
      `rejected` 1;
    - `submission.approved` 4, `submission.rejected` 4, `submission.validated` 1.
- No other cleanup was done.

### 20.4 Remaining

§19.6 stands, without item 2: operator diff review and commit, then DEV after merge. PROD stays behind the ISSUE-265
hold.

## 21. Final review corrections (2026-10-11)

Operator instruction, 2026-10-11: address the final review findings. Authorised: local edits, focused reruns on the
previously verified `afldb_test`, and a commit on `opus/issue-273`. No merge, push, deployment, migration, or DEV/PROD
database contact. Migration 110 untouched.

### 21.1 Integration teardown

Finding: a test that failed before awaiting a parked or lock-blocked operation released it in `afterEach` without
awaiting it, then reset the shared controls. The operation could run into the next test, read reset controls, or race
the `afterAll` fixture cleanup, and its rejection was unhandled until something awaited it.

Change, in `tests/integration/email-intake.test.ts` and `tests/integration/submission-promotion.test.ts`:

- `track(promise)` registers every background delivery (email intake) and every background validation and approval
  (submission promotion) the moment it starts, before any wait, with its rejection handler already attached. The test
  reads the outcome through the returned accessor (`result()` / `settled()`), which marks it consumed. The assertions
  are unchanged.
- `settleBackground()` disarms `park` first, so a released multi-row validation cannot park again, releases every
  parked operation, and awaits every tracked one, bounded at 20 s inside the 30 s hook timeout. If work is still
  running at the bound it throws and keeps the entries.
- `afterEach` settles first, then resets the controls a released operation still reads (`failFileKey`/`afterStage`;
  `label`/`verdict`), then throws an `AggregateError` for any tracked rejection no test consumed.
- `afterAll` settles before deleting fixtures, so it never cleans under a running operation; a timeout refuses the
  cleanup.
- Email intake: an `afterStage` hook failure is recorded as well as thrown, and reported by teardown. The route alone
  turns it into a generic staging 500.
- The ISSUE-175 promotion-vs-reject case (pre-existing, not part of this issue) is unchanged.

### 21.2 Deterministic early-failure checks

A new describe block in each file:

- Two `it.fails` cases leave an operation in flight, then fail early:
  - an assertion failure while the operation is parked;
  - a `vi.waitFor` timeout. In email intake the delivery is parked; in submission promotion the validation is blocked
    behind a held row lock.
- Each arms a control that the operation reads only after release (`failFileKey` / `label = 'stranded'`).
- The case after each one asserts:
  - no tracked or parked work remains, and the controls are reset;
  - the operation finished with the armed control. Email intake: status `staged`, verdict null, audits
    `staged, validate_error`. Submission promotion: `validated`, with the `stranded` label on the row.

  So teardown awaited it to the end before resetting anything.
- A tracker check: a consumed rejection is not reported. An unconsumed one, and an `afterStage` failure, are reported.

**Differential.** The old teardown (release and reset, no await) was put back temporarily, and the files were then
restored byte-identical (SHA-256 checked). All 4 follow-up cases fail. Email intake gets audits `[staged]` only: the
delivery was still running. Submission promotion gets status `staged`, not `validated`.

### 21.3 Tracking corrections

- §15/§16 and the `issues.md` next-action cell no longer describe §19.5 as open.
- §17.4: the ISSUE-222 Markdown artefact hash mismatch (`draftguru-acquisition` check 41z) is recorded as unconfirmed.
  Its cause was not investigated, and no environmental cause is asserted. The migration-110 (ISSUE-264 State-B)
  limitation is unchanged.

### 21.4 Validation

- The launcher probe ran first: all five connections were `OK`, on `afldb_test`, one server, `16/main`.
- `run-issue273-integration.mjs --port 55432 --skip-match-results`:
  - `email-intake`: 23 passed + 2 expected-fail (25).
  - `submission-promotion`: 18 passed + 2 expected-fail (20).
  - Totals: 41 passed, 4 expected-fail, 0 failed. Vitest exit 0.
- `match-results-promotion` was not re-run. The migration-110 limitation of §18.2 and §19.3 stands.
- eslint on both files and `npm run typecheck` are clean. `git diff --check` is clean.

### 21.5 Cleanup (read-only counts, before and after both runs)

- Fixture submissions, rows, players, clubs, and season and matches 2073: 0 before and 0 after.
- Retained, by design:
  - **Users.** The same 3 fixture users (89, 92, 193).
  - **Import batches.** 10 new `admin-upload` `player_bio` batches (2041–2054, with gaps). Each one's submission has
    been deleted.
  - **`auth_audit_log`.** 114 new rows (ids 101–214) across the passing run and the differential:
    - `email_intake.staged` 30, `validated` 22, `duplicate` 16, `validation_superseded` 16, `validate_error` 8,
      `stage_error` 2, `rejected` 2;
    - `submission.approved` 8, `submission.rejected` 8, `submission.validated` 2.

### 21.6 Remaining

- Committed on `opus/issue-273`.
- Then, by the operator: merge, DEV deployment and DEV acceptance (§19.6 item 3).
- PROD stays behind the ISSUE-265 hold.
- Closure (§19.6 item 4).
