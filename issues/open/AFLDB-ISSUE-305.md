# AFLDB-ISSUE-305 — Legacy intake validation accepts values promotion then rejects

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** legacy CSV intake validation.
- **Key file:** `src/lib/ingest/datasets.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-040; partition note R5a-F08).
- **Classification:** reproduced (DB-free witness W4).

## 1. Summary

- Dates are validated only against `^\d{4}-\d{2}-\d{2}$`, so `2024-02-30` validates.
- `player_bio` numeric fields use `Number()`, so `8e1`, `1.8e2`, `0x50` and `80.0` validate as integers.

After Super Admin approval of a clean report, promotion then fails on the `::date` / `::smallint` cast, and the whole submission rolls back to `failed` with a PostgreSQL message.

## 2. Evidence

- `src/lib/ingest/datasets.ts:664` and `:1246` (date regex only), `:1250-1255` (`Number()`), and `:821`, `:1275`, `:1279-1280` (casts).
- `src/lib/ingest/pipeline.ts:425-432` (rollback to `failed`).
- The stated contract: validation refuses what promotion cannot write (`datasets.ts:33-44`).

## 3. Trigger

A file containing `match_date=2024-02-30`, or `height_cm=1.8e2`.

## 4. Expected invariant

Validation refuses what promotion cannot write.

## 5. Actual behaviour

The row validates `ok`, and the promotion then fails.

## 6. First wrong layer

`datasets.ts:664, :1246, :1250-1255`.

## 7. Impact

A workflow defect only; it fails closed, with no corruption.

## 8. Reproduction / witness

W4 (DB-free), output `D:\tmp\review-20261008-full\witness\w2.out`:
- `player_bio {height_cm: '1.8e2'}` → `ok`.
- `player_bio {dob: '2024-02-30'}` → `ok`.

## 9. Disproof attempts

ISSUE-258 hardened only the count columns of two datasets.

## 10. Existing-issue search

ISSUE-258 (`issues.md:47399-47401`). Classification: **new**.

## 11. Scope

Date and integer parsing in the legacy validators.

## 12. Out of scope

`match_attendance` blank handling (AFLDB-ISSUE-268).

## 13. Proposed fix boundary

Use a strict `^\d+$` reader for integers, and validate dates by a `Date.UTC` round-trip.

## 14. Proposed validation

DB-free `validateRow` cases in `tests/ingest-datasets.test.ts`.

## 15. Decisions / unresolved questions

- Hypothesis H-305-1: `rising_star` votes and stat-line values may accept negative integers (`datasets.ts:365-368, :383`). Deciding evidence: whether the `award_nominations` DDL has a CHECK.

## 16. Next action

Implementation.
