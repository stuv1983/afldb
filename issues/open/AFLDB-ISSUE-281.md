# AFLDB-ISSUE-281 — Two public list pages fail on a sort key that names an inherited object property

## 0. Status

- **Status:** Open (2026-10-08). **Implemented 2026-10-12 in batch worktree `afldb-batch-315-281-312-288` (branch
  `opus/batch-315-281-312-288`, base `80f86c39`); DB-free validated; committed as `23809fce`; merged to local `main` by `01976be7` on 2026-10-13 (not pushed); not on DEV or PROD** (§17).
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

~~Implementation (trivial).~~ Superseded by §17.5.

## 17. Implementation and DB-free validation (2026-10-12, batch with ISSUE-315/312/288; solo, no agents)

Worktree `D:\dev\afldb-batch-315-281-312-288`, branch `opus/batch-315-281-312-288`, base
`80f86c39baf65e04921148c166d9b2c6791b06bf`. No database, host, commit, merge, push or deployment.

### 17.1 Change

- `src/db/queries/players.ts` (`isPlayerMatchSort`) and `src/db/queries/draft.ts` (`isDraftSort`): `s in MAP` replaced by
  `Object.hasOwn(MAP, s)`, the pattern `isPlayerSort` already uses. An inherited key now fails the guard, so the query
  keeps its existing default ORDER BY. No SQL text changed.

### 17.2 Tests (extended the existing `tests/catalogue-lookups.test.ts`, the inherited-key regression suite)

- Every declared key is accepted by both guards; the eight inherited keys (`constructor`, `toString`, `valueOf`,
  `hasOwnProperty`, `__proto__`, …) are refused; absent, empty, unknown and case-variant keys are refused.
- `getPlayerMatches` and `listDraftPicks` run against a recording stand-in for `@/db/client` (`vi.doMock`, loaded after
  `records.ts` so that file's strict "before attempting SQL" case keeps the real client). The ORDER BY they would send is
  read back: a valid key and direction use the declared column; `constructor` and `toString` with `asc`/`desc` give the
  default order (`m.match_date DESC, m.id DESC` / `dp.draft_year DESC, dp.pick_number NULLS LAST`); an unknown key, a
  missing key and an invalid or missing direction keep the existing fallback.

### 17.3 Results

- `tests/catalogue-lookups.test.ts`: **14 passed** (8 existing + 6 new).
- Mutation check: with both guards put back to `in`, **2 failed** (the inherited-key guard case and the
  `constructor`/`toString` ORDER BY case), 12 passed; restored.
- Batch-wide (once, stable tree): `npm run typecheck` exit 0; `npm run lint` exit 1 with 253 errors / 131 warnings, **none
  in a file this batch changed** (the changed files have 0 errors and the same 3 `_total` warnings as base `80f86c39`).

### 17.4 Not done

No `afldb_test` check (not needed: SQL unchanged for valid keys, and the fallback is the existing default); no DEV or PROD.

### 17.5 Remaining criteria and next action

1. **Done 2026-10-12:** operator review of the batch diff, then a separate local commit for this issue (with its tracking
   hunks). Committed locally (`23809fce`); merged to local main 2026-10-13 (`01976be7`, not pushed).
2. Merge/push and DEV deploy, **held until ISSUE-274's first-nightly evidence is captured** (captured: ISSUE-274 runbook §33). **Merged to local main 2026-10-13 (merge `01976be7`); the push and the DEV deploy have not happened.**
3. DEV smoke (signed in; DEV's beta gate redirects anonymous requests): `/players/<slug>/matches?sort=constructor&dir=asc`
   and `?sort=toString&dir=desc`, `/draft/<year>?sort=toString&dir=desc` and `?sort=constructor&dir=asc` render with the
   default order and no error page; `?sort=g&dir=desc` and `/draft/<year>?sort=pick&dir=asc` still sort; no PostgreSQL
   syntax error in the DEV service log for those requests. Read-only.
4. Then the issue may be **closed DEV-scoped**, recording PROD shipping as pending behind the unchanged ISSUE-265 hold.
