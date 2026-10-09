# AFLDB-ISSUE-282 — Replace actions revalidate only the replaced row's public pages

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin awards, Hall of Fame, honour teams and special records / public cache revalidation.
- **Key files:** `src/db/queries/admin-awards.ts` (`replaceAwardWinner`, `replaceHallOfFameInductee`, `replaceHonourTeamMember`), `src/db/queries/admin-special-records.ts` (`replaceFirstKickGoal`, `replaceAfterSirenKick`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-017; partition notes R2a-F01 and R2c-F02, grouped as one mechanism).
- **Classification:** code-proven.

## 1. Summary

Each of the five replace transactions returns `revalidatePaths: row.revalidatePaths`, where `row` is the locked OLD row. The replacement row's pages are never computed: a different award, season, recipient, club, match or team. So the correct person's or award's public page keeps its pre-replacement state until its ISR window expires, which is up to a day.

## 2. Evidence

- `src/db/queries/admin-awards.ts:1686`, `:2212`, `:2737`, where the old row comes from `lockAwardWinner :1063`.
- `src/db/queries/admin-special-records.ts:1686`, `:2243`, where the old row comes from `lockSpecialRecord :850`.
- Contrast: `createAwardWinner` (`admin-awards.ts:1564-1570`) and `createFirstKickGoal` (`admin-special-records.ts:1571-1577`, `:2140-2146`) compute the new row's paths. The draft relink revalidates both players (`src/app/admin/draft/actions.ts:357-358`).
- The actions forward the result unchanged (`src/app/admin/awards/actions.ts:126-151`; `src/app/admin/records/actions.ts:108-138`).
- ISR windows:
  - `awards/[slug]` and `awards/[slug]/[season]`: 86400.
  - `players/[slug]`: 3600.
  - `clubs/[slug]` and `honour-teams/[slug]`: 86400.
  - `seasons/[year]`: 3600.

## 3. Trigger

"Replace this record" with a different award, season, recipient, club, match or team. This is the panels' advertised purpose (`ReplacePanel.tsx:126-127`, `SpecialRecordReplacePanel.tsx:105-109`).

## 4. Expected invariant

The union of the old row's and the created row's paths is revalidated.

## 5. Actual behaviour

Only the old row's paths are revalidated.

## 6. First wrong layer

The `revalidatePaths` return in each of the five replace functions.

## 7. Impact

Stale public pages for up to 24 hours. No data effect. This is distinct from the known per-worker limitation (ISSUE-134): here a path is missing altogether.

## 8. Reproduction / witness

Not executed. The paths are computed inside the transaction, so DB-free testing is not possible.

## 9. Disproof attempts

- `settle()` does not augment the paths.
- `insertFirstKickGoal` returns no paths.
- The old and new rows share no pages in the advertised scenario.

## 10. Existing-issue search

- ISSUE-165 and ISSUE-167 runbooks (generic path contract only); ISSUE-176 (match-link validation).
- Classification: **new**.

## 11. Scope

The five replace functions.

## 12. Out of scope

Per-worker invalidation (ISSUE-134).

## 13. Proposed fix boundary

In each replace transaction, read the created row and return the de-duplicated union of old and new path sets. The allowlists already admit every shape.

## 14. Proposed validation

Integration: extend `tests/integration/admin-awards.test.ts:670` and `tests/integration/admin-special-records.test.ts:938-988` to assert the new player's path is in `revalidatePaths`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation, grouped with AFLDB-ISSUE-283 (the same functions).
