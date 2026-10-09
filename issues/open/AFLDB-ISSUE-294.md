# AFLDB-ISSUE-294 — AFL Tables, lineup and fallback import batches record `completed_at = started_at` and no inserted count

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** acquisition / import batch accounting.
- **Key files:** `src/lib/acquisition/settle-afltables.ts`, `src/lib/acquisition/lineup-store.ts`, `src/lib/external-afl/current-season-import.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-029; partition note R4a-F04).
- **Classification:** code-proven.

## 1. Summary

The AFL Tables settle closes its batch with `completed_at = now()` inside the run transaction. `now()` is the transaction start instant, so it equals `started_at`. It also leaves `records_inserted` / `records_updated` at their default 0, although `versionsAppended` is the defined value. `settle-core.ts` fixed both for AFL API (`clock_timestamp()`, explicit counts). The lineup store and the deprecated fallback importer use the same `now()`.

## 2. Evidence

- `src/lib/acquisition/settle-afltables.ts:1950-1956`.
- `src/db/migrations/001_foundations.sql:59, :63-64` (`started_at DEFAULT now()`, count defaults).
- `src/lib/acquisition/settle-core.ts:1140-1142, :1196-1198, :1211` (the AFL API fix).
- `src/lib/acquisition/lineup-store.ts:482-490` and `src/lib/external-afl/current-season-import.ts:848-850`.
- Shown to operators in `src/app/admin/current-season/SettleRunPanel.tsx:230`.

## 3. Trigger

Every AFL Tables settle, lineup persist or fallback refresh.

## 4. Expected invariant

`completed_at` is the real completion instant, and the record counts are honest.

## 5. Actual behaviour

Completion time equals start time; the admin panel shows the start as the completion. The inserted count is 0.

## 6. First wrong layer

`settle-afltables.ts:1950-1956` (and the two sibling writers).

## 7. Impact

Reporting and operations only. Run durations cannot be measured from the ledger: `issues/open/AFLDB-ISSUE-265.md:709-712` recorded this as an evidence limitation of the 265 overlap analysis.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

PostgreSQL `now()` is transaction-start time by definition.

## 10. Existing-issue search

Recorded as an observation in the ISSUE-265 runbook only, with no tracked fix. Classification: **new** as a tracked defect.

## 11. Scope

The three batch-closing writers.

## 12. Out of scope

The legacy CSV promotion counts (AFLDB-ISSUE-307) and the fallback `records_rejected` (AFLDB-ISSUE-296).

## 13. Proposed fix boundary

Route the AFL Tables close through `finalizeSettleImportBatch`, or use `clock_timestamp()` plus `records_inserted = versionsAppended`. Make the same change in the other two writers.

## 14. Proposed validation

Integration: after an apply, `completed_at > started_at` and `records_inserted = counters.versionsAppended`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
