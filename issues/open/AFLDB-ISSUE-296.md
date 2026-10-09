# AFLDB-ISSUE-296 — Deprecated fallback importer sets `records_rejected` without rejection rows

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** acquisition / deprecated fallback staging refresh.
- **Key file:** `src/lib/external-afl/current-season-import.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-031; partition note R4a-F06).
- **Classification:** code-proven.

## 1. Summary

The fallback importer writes `records_rejected = canonicalPlan.rejectedOrConflicted`, a planning count, while writing no `import_rejections` rows. That contradicts the column's contract: it must equal the number of rejection rows for the batch (ISSUE-244 F008).

## 2. Evidence

- `src/lib/external-afl/current-season-import.ts:853`; no `import_rejections` insert in `:736-886`; `:865` already keeps the count in `validation_result`.
- `src/db/migrations/001_foundations.sql:71` (column comment) and `src/lib/acquisition/settle-core.ts:1134-1139` (the contract).

## 3. Trigger

Admin "Run fallback staging refresh" with Persist on (`CurrentSeasonControls.tsx:233`), or `update-current-season.ts --apply`.

## 4. Expected invariant

`records_rejected` equals the count of `import_rejections` rows.

## 5. Actual behaviour

A non-zero count with zero rows.

## 6. First wrong layer

`current-season-import.ts:853`.

## 7. Impact

Contradicts consumers that join the two. Deprecated path; low value.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

F008 scoped the settle engines only.

## 10. Existing-issue search

`issues/closed/AFLDB-ISSUE-244.md:3851-3975` does not mention this writer. Classification: **new**.

## 11. Scope

One column write.

## 12. Out of scope

Retiring the fallback path.

## 13. Proposed fix boundary

Write `records_rejected = 0` and keep the planning count in `validation_result`.

## 14. Proposed validation

A unit or integration assertion on the batch row.

## 15. Decisions / unresolved questions

Whether the fallback path should simply be retired. Operator.

## 16. Next action

Implementation, or a retirement decision.
