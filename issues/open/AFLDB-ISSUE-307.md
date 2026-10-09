# AFLDB-ISSUE-307 — Legacy promotion counts every promoted row as inserted

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** legacy CSV intake / import batch accounting.
- **Key file:** `src/lib/ingest/pipeline.ts` (`promoteSubmission`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-042; partition note R5a-F10).
- **Classification:** code-proven.

## 1. Summary

The legacy promotion stamps `records_read = rows.length` and `records_inserted = rows.length`. `records_updated` stays 0. Every `ON CONFLICT DO UPDATE`, every `player_bio` UPDATE, and every `match_attendance` UPDATE that touched no row (because the match was deleted since validation) is counted as inserted.

## 2. Evidence

- `src/lib/ingest/pipeline.ts:402-407`.
- `src/db/migrations/001_foundations.sql:64`.
- `src/lib/ingest/datasets.ts:1328-1329` (the attendance UPDATE can touch no row).

## 3. Trigger

Any promotion that updates existing rows.

## 4. Expected invariant

Inserted, updated and no-op rows are distinguished.

## 5. Actual behaviour

Everything is counted as inserted.

## 6. First wrong layer

`pipeline.ts:402-407`.

## 7. Impact

Reporting only. The `records_rejected` handling is correct (0 with no rows, consistent with ISSUE-244 F008).

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

None.

## 10. Existing-issue search

None. Classification: **new**. Related to AFLDB-ISSUE-294 (a different writer).

## 11. Scope

The promotion batch counters.

## 12. Out of scope

The settle counters (AFLDB-ISSUE-293/294).

## 13. Proposed fix boundary

`promoteRow` returns `'inserted' | 'updated' | 'noop'` (`RETURNING xmax = 0` or the driver count), summed into the three columns.

## 14. Proposed validation

Integration: promote a file with one new and one existing row and assert 1/1.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation (low priority).
