# AFLDB-ISSUE-286 — Hall of Fame legend and removal years are not bounded server-side

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

Implementation.
