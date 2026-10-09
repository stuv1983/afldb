# AFLDB-ISSUE-281 — Two public list pages fail on a sort key that names an inherited object property

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** public site / query sort allowlists.
- **Key files:** `src/db/queries/players.ts` (`isPlayerMatchSort`), `src/db/queries/draft.ts` (`isDraftSort`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-016; main-session partition R1b-F01).
- **Classification:** reproduced (DB-free witness W5).

## 1. Summary

Two sort-key guards use the `in` operator, which is also true for keys inherited from `Object.prototype` (`toString`, `constructor`, `valueOf`, `__proto__`, `hasOwnProperty`). The admitted key maps to a function or object, not a column. `sql.unsafe(...)` interpolates its string form into ORDER BY, PostgreSQL rejects the SQL, and the public page renders the error boundary.

## 2. Evidence

- `src/db/queries/players.ts:619-621`: `return s !== undefined && s in PLAYER_MATCH_SORTS;`. The sink is `:634-638`.
- `src/db/queries/draft.ts:50-52`: `return s !== undefined && s in DRAFT_SORTS;`. The sink is `:106-111`.
- The raw query-string value reaches them from `src/app/players/[slug]/matches/page.tsx:77-85` and `src/app/draft/[year]/page.tsx:69-70`.
- The safe pattern already in the same file: `players.ts:41-43` (`Object.hasOwn`). Also `records.ts:78`, `aflw-filters.ts:131/206`, and the fallbacks in `advanced-search.ts:62` and `match-search.ts:98`.

## 3. Trigger

No sign-in is needed:
- `/players/<slug>/matches?sort=constructor&dir=asc`
- `/draft/<year>?sort=toString&dir=desc`

## 4. Expected invariant

An unknown sort key falls back to the default order.

## 5. Actual behaviour

The page returns a 500 / error page, and PostgreSQL logs a syntax error. The text injected into the SQL is fixed by the JavaScript runtime, so this is not SQL injection.

## 6. First wrong layer

`players.ts:620` and `draft.ts:51`.

## 7. Impact

Availability and log noise on two public routes, reachable by any crawler.

## 8. Reproduction / witness

W5: `D:\tmp\review-20261008-full\witness\w5_sort_proto.mjs`, output `w5.out`. It copies the guard verbatim and renders the fragment with postgres.js's own `stringify`, with no connection. For example, `constructor` renders `ORDER BY function Object() { [native code] } ASC NULLS LAST`.

## 9. Disproof attempts

There is no upstream validation of `sort` and no try/catch around the query.

## 10. Existing-issue search

The issue ledger, index, changelog and closed runbooks were searched for the guard names, "prototype" and "sort=". Classification: **new**.

## 11. Scope

The two guards.

## 12. Out of scope

The other sort maps, which are already safe.

## 13. Proposed fix boundary

Use `Object.hasOwn` in both guards.

## 14. Proposed validation

DB-free unit cases: `isPlayerMatchSort('toString') === false` and `isDraftSort('constructor') === false`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation (trivial).
