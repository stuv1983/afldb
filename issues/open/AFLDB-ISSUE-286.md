# AFLDB-ISSUE-286 — Hall of Fame legend and removal years are not bounded server-side

## 0. Status

- **Status:** Open (2026-10-08). Implemented 2026-10-14 as `f2c6b675` on `sonnet/issue-286` (base `c514b731`); DB-free validated (§17.1); not yet merged.
- **Severity:** Low. **Area:** admin awards / Hall of Fame validation.
- **Key files:** `src/app/admin/awards/actions.ts`, `src/db/queries/admin-awards.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-021; partition note R2a-F05).
- **Classification:** code-proven.

## 1. Summary

Server-side validation of Hall of Fame years is incomplete:
- legend year and removal year are checked only against the induction year (and the legend year only when `isLegend`);
- correction accepts any integer;
- a non-Legend may keep a legend year.

The `min`/`max` limits on the inputs are client-side only, and there is no DB CHECK. Values such as `legend_year = 20999` are stored and rendered publicly. A value above 32767 fails with a raw `smallint` error.

## 2. Evidence

- `src/app/admin/awards/actions.ts`:
  - `:377-381` and `:385-392`: correction uses `parseNullableInt` (any integer; `validation.ts:43-50`).
  - `:469-477`: create bounds the legend year only when legend, and never bounds the removal year.
- `src/db/queries/admin-awards.ts`:
  - `:1795-1814`: a relative-only precheck.
  - `:2101-2109`: the create bounds.
  - `::smallint` casts at `:1852, :1856, :2046, :2048`.
- The migrations have no CHECK on `legend_year` / `removed_year`.
- The public render: `hall-of-fame/[id]/page.tsx:63` and the public Hall of Fame page.

## 3. Trigger

A Super Admin posts an out-of-range year (pasted or edited), or unticks Legend while leaving a legend year.

## 4. Expected invariant

Both fields are bounded 1996..2100 and at or after the induction year on both paths, and the legend year is cleared or refused when not a Legend.

## 5. Actual behaviour

Implausible years are stored and shown publicly. Above 32767 the failure is raw.

## 6. First wrong layer

`src/app/admin/awards/actions.ts:377-392, :469-477`.

## 7. Impact

A wrong public value until it is corrected. No integrity hazard.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

There is no DB CHECK and no render guard.

## 10. Existing-issue search

None found for `legend_year` / `removed_year` bounds. Classification: **new**.

## 11. Scope

Hall of Fame year validation.

## 12. Out of scope

Other award fields.

## 13. Proposed fix boundary

Bound both fields in both actions (or the query validators), and null `legendYear` when not a Legend, mirroring `hallOfFameFacts` `:486`.

## 14. Proposed validation

DB-free validation unit cases where possible; otherwise integration.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Done 2026-10-14 (§17). Next: readiness, merge and push, then close (§18).

## 17. Implementation record (2026-10-14)

- **Commit:** `f2c6b675` on `sonnet/issue-286`, base `c514b731`. Files: `src/db/queries/admin-awards.ts`, `src/app/admin/awards/actions.ts`, and the new `tests/admin-awards-hall-of-fame-years.test.ts`. The live path is `admin-awards.ts`; the older `src/db/queries/awards-admin.ts` is not reached by the awards actions and was left alone (out of scope, §12).
- **One rule.** `hallOfFameYearsRefusal` (exported from `admin-awards.ts`): a Legend needs a legend year; each supplied legend or removal year is a whole number from the induction year (or 1996 when the row has none) to 2100; an unsupplied (`undefined`) year is not checked, so a correction that does not touch a year cannot be blocked by it. Sentences: `Legend year must be from the induction year to 2100.` and `Removal year must be from the induction year to 2100.`
- **Create** (`createHallOfFameInductee`) and **replace** (`replaceHallOfFameInductee`) share `hallOfFameInputRefusal`, run **before a connection opens** (it also holds the induction-year bound, which the replace query layer previously left to the action). `insertHallOfFame` repeats the years check inside the transaction, so the replace path's refusal after its void rolls both back. Only a Legend stores a legend year; any other value is stored as NULL, in the INSERT and in the override payload.
- **Correct** (`correctHallOfFameInductee`): years that can be judged without the row (a supplied removal year; a supplied legend year when the same request makes the entry a Legend) are refused before a connection opens. In the precheck, under the row lock, the rule is applied with the row's induction year to the resulting Legend flag and legend year and to a supplied removal year, replacing the two relative-only checks. In `apply`, un-ticking Legend, or naming a legend year for a non-Legend, clears the legend year, as creation does; a correction that touches neither leaves a non-Legend's stored legend year as it is (so an unrelated edit cannot change source data).
- **Action** (`hallOfFameFacts`) calls the same function, so a bad year is named in the form's own error; the correction action relies on the query layer's refusal, which `settle()` renders. The `min`/`max` on the inputs remain advisory only.
- **Not changed.** No migration and no database CHECK (the review did not ask for one; existing rows are not repaired or assessed). The public pages are unchanged.

## 17.1 Validation (2026-10-14, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- `npx vitest run tests/admin-awards-hall-of-fame-years.test.ts`: **42 passed.** The suite drives the real mutation functions over a fake transaction with `postgres` mocked: the pure rule (boundaries 1996/2005/2100, 20999, 32768, 2101, non-integers, NaN, null/undefined); create, replace and correct refusals that assert `postgres` was never called; precheck refusals that assert no `UPDATE hall_of_fame` was issued; the value carried by the written INSERT/UPDATE (non-Legend legend year NULL, un-ticking clears, an untouched stored value kept, boundary years written). **Negative control:** with `src/` restored to the base, **33 of the 42 fail** (the other 9 pin behaviour that was already correct); the fix was restored afterwards.
- Neighbouring suites `tests/awards-admin.test.ts`, `tests/honours-lifecycle-public-contract.test.ts`, `tests/hall-of-fame-source.test.ts`: 115 passed, 3 failed. The same 3 fail identically at the unmodified base `c514b731` in the primary checkout (`widens data_edits by SELECT alone in 108`, and the two public-read-model lifecycle-filter scans of `awards.ts` and `grid-solver.ts`; none touches this change), so they are pre-existing, not caused by it.
- `npx tsc --noEmit` exit 0; `npx eslint` of the three files exit 0; `git diff --check` exit 0. `npm run preflight -- --mode implementation --issue 286`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; `D:\tmp\issue286\preflight-impl.txt`).
- **Not run / limits:** `tests/integration/admin-awards.test.ts` and any PostgreSQL case (the real `smallint` columns, the row lock, the atomic override and audit write); the fake transaction proves the decisions and the values passed to the statements, not that PostgreSQL accepts them. No browser check: no layout or markup changed. No deployment, DEV or PROD action. Existing rows with an implausible stored year were not looked for.
