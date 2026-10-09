# AFLDB-ISSUE-295 — Settle exception report mixes both sources' apply-failure findings

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** acquisition / settle reporting.
- **Key file:** `src/lib/acquisition/settle-report.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-030; partition note R4a-F05).
- **Classification:** code-proven.

## 1. Summary

The "`<sourceKey>` settle exceptions" section lists open `canonical_apply_failed` findings filtered by type and owner only, never by `details->>'source_key'`. The AFL API report therefore shows AFL Tables failures as its own, and vice versa. AFL API's per-run refusal findings can push AFL Tables' own failures past the 20-row cut.

## 2. Evidence

- `src/lib/acquisition/settle-report.ts:355-365` (`openFindingsOf`), `:401` (the `sourceKey` parameter), `:421` (the call), and `:152, :364-369` (`OPEN_FINDING_LIMIT = 20`).
- Every writer stamps `source_key`: `settle-afltables.ts:2570, :2627`; `settle-afl-api.ts:1160`; `settle-core.ts:806`.
- `settle-afl-api.ts:1073-1077` states the keys are source-scoped.

## 3. Trigger

Open findings of both sources exist when either report is rendered (`tools/current-season/settle-afl-api.ts:265-271, :362-369`).

## 4. Expected invariant

Each source's report lists only its own findings.

## 5. Actual behaviour

The findings are mixed, and a source's own failures can be hidden behind "… more than 20 open".

## 6. First wrong layer

`src/lib/acquisition/settle-report.ts:421`.

## 7. Impact

Operator misdiagnosis. Reporting only.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

The disagreement section is scoped correctly; only the apply-failure section is shared. The tests (`current-season-import.test.ts:5438, :5479`) do not assert scoping.

## 10. Existing-issue search

ISSUE-228 "known-gap-B" covered the disagreement pair only. Classification: **new**.

## 11. Scope

One query predicate.

## 12. Out of scope

The data_issues lifecycle.

## 13. Proposed fix boundary

Add `AND d.details->>'source_key' = ${sourceKey}`.

## 14. Proposed validation

Integration: open one finding per source and assert each report lists only its own.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation (trivial).
