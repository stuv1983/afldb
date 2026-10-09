# AFLDB-ISSUE-273 — Submission validation overwrites a concurrent approve, promote or reject

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

None.

## 16. Next action

Code fix plus tests.
