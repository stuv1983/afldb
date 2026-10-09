# AFLDB-ISSUE-306 — Legacy intake duplicate detection compares raw club text

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** legacy CSV intake validation.
- **Key files:** `src/lib/ingest/datasets.ts` (`fileKey`), `src/lib/ingest/pipeline.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-041; partition note R5a-F09).
- **Classification:** code-proven.

## 1. Summary

In-file duplicate detection keys on the raw payload text, while the database key uses resolved names. Two rows that name one match (or one player-match) under two club aliases both validate `ok`, and both are promoted. The second overwrites the first, and both are counted.

## 2. Evidence

- `src/lib/ingest/datasets.ts:619` and `:986-987` (`fileKey` from the raw payload), against `:806-809` and `:1047-1049` (database key from resolved names).
- `src/lib/ingest/pipeline.ts:220-231` (duplicate check on `fileKey`) and `:405` (counts).

## 3. Trigger

Two `match_results` rows for the same fixture, one naming `Carlton` and the other a recorded alias of Carlton.

## 4. Expected invariant

The duplicate is detected on the resolved key.

## 5. Actual behaviour

The later row silently wins.

## 6. First wrong layer

`datasets.ts:619, :986-987`.

## 7. Impact

A silent last-write-wins inside one file, invisible on the report.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

`preparePromotion` de-duplicates the lock set only (`:775-783`).

## 10. Existing-issue search

None. Classification: **new**.

## 11. Scope

Duplicate detection.

## 12. Out of scope

Round-code normalisation (AFLDB-ISSUE-272).

## 13. Proposed fix boundary

After validation, de-duplicate on the resolved key and mark the later row as an error, or refuse in `preparePromotion`.

## 14. Proposed validation

DB-free unit tests with a stub alias resolver.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation, alongside AFLDB-ISSUE-272.
