# AFLDB-ISSUE-281 — Two public list pages fail on a sort key that names an inherited object property

## 0. Status

- **Status:** **RESOLVED, DEV-scoped (2026-10-14).** Opened 2026-10-08. Implemented 2026-10-12 in batch worktree `afldb-batch-315-281-312-288` (branch
  `opus/batch-315-281-312-288`, base `80f86c39`); DB-free validated; committed as `23809fce`; merged to `main` by `01976be7` on 2026-10-13 (pushed: an ancestor of the live `origin/main`, verified 2026-10-14); installed on DEV 2026-10-14 13:52 AEDT (TARGET `17514052`, runbook 275 §30; installation checks PASS); DEV read-only browser smoke PASSED 2026-10-14 (§18) and the owner accepted it as DEV acceptance and authorised DEV-scoped closure. **PROD installation and PROD acceptance are PENDING** (the ISSUE-265-specific PROD hold was released by `a862d192`; PROD still needs its own reviewed procedure, `blockers.md` R6). The closure is DEV-scoped and says nothing about PROD (§17, §18).
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
   hunks). Committed locally (`23809fce`); merged to main 2026-10-13 (`01976be7`; pushed: an ancestor of the live `origin/main`, verified 2026-10-14).
2. Merge/push and DEV deploy, **held until ISSUE-274's first-nightly evidence is captured** (captured: ISSUE-274 runbook §33). **Merged to main 2026-10-13 (merge `01976be7`) and pushed (verified 2026-10-14); the DEV deploy happened 2026-10-14 13:52 AEDT (runbook 275 §30); the section 17.5 smoke was done the same day (§18).**
3. DEV smoke (signed in; DEV's beta gate redirects anonymous requests): `/players/<slug>/matches?sort=constructor&dir=asc`
   and `?sort=toString&dir=desc`, `/draft/<year>?sort=toString&dir=desc` and `?sort=constructor&dir=asc` render with the
   default order and no error page; `?sort=g&dir=desc` and `/draft/<year>?sort=pick&dir=asc` still sort; no PostgreSQL
   syntax error in the DEV service log for those requests. Read-only.
4. Then the issue may be **closed DEV-scoped**, recording PROD shipping as pending behind the unchanged ISSUE-265 hold. **Done 2026-10-14 (§18):** the smoke passed and the owner authorised closure; the wording "behind the unchanged ISSUE-265 hold" is superseded: that hold was released by `a862d192`, and PROD installation and acceptance are still PENDING, needing PROD's own reviewed procedure.
5. Step 3 said "signed in". The 2026-10-14 smoke did not establish whether the browser session was signed in (§18): the owner accepted the evidence as DEV acceptance regardless.

## 18. DEV acceptance record and closure (2026-10-14; read-only; DEV only)

**Authority and scope.** Owner instruction 2026-10-14: Playwright was authorised for this task only (overriding the repository's browser-tool restriction; no policy file was changed); DEV `http://10.0.40.100:8090`; `SMOKE_START` 20261014T145401. Read-only: no form was submitted, nothing was deployed, restarted or repaired, and PROD was not contacted. The browser ran at about 14:56 AEDT. Evidence root `D:\tmp\dev-deploy-275-281-288\run-20261014-1333\post\visual\` (25 files: per case a PNG screenshot, console log, network log and `compare.json`, plus the case-0 console log); manifest `post\SHA256SUMS-281-browser-evidence.txt` (SHA-256 `190741d279eec3772f8670a0d0039c6505f8f86592898226cc59e1cf3033d81a`; 26 entries; every entry re-verified OK, none DIFF, before this record was written). The tool could only write under `D:\dev\afldb\.playwright-mcp` (git-ignored); the files were copied to the evidence root afterwards.

**Route correction and checklist error.** The route is `/players/<slug>-<id>/matches`; Gary Ablett is `/players/gary-ablett-4701/matches` (id found from `/players?q=Gary Ablett`). The checklist URL as originally issued, `/players/gary-ablett/matches?sort=constructor&dir=asc`, returned an **app 404 "Player not found"** (not a login or beta-gate redirect; `case0-literal-url-gary-ablett-404-console.log`). That was a **checklist error** (a missing `-<id>`), **not an ISSUE-281 defect**, and it is why all player cases below used the corrected route.

**Results (six cases; the same fetches, run from the page, compared full result sets, all pages).** Every case: final URL equal to the requested URL, no redirect, every page of the case and of its baselines HTTP 200, no console error, no failed relevant request, DOM page 1 equal to the fetched page 1.

| # | URL (`sort`, `dir`) | Verdict | Basis |
|---|---|---|---|
| 1 | `/players/gary-ablett-4701/matches` `constructor`, `asc` | PASS | Deployed default `m.match_date DESC, m.id DESC` (`players.ts`). All 4 pages (357 rows, 100 per page) identical to the bare baseline and to `?dir=asc` (the other parameter preserved with the invalid sort dropped); baseline dates non-increasing, 0 violations (#357, 24 Oct 2020 down to #1, 30 Mar 2002). |
| 2 | same, `toString`, `desc` | PASS | Same basis; identical to both baselines. |
| 3 | same, `g`, `desc` (control) | PASS | All 357 rows equal a client-side sort of goals descending, NULLs last, then date descending; 0 goal-increase and 0 tie-date violations; page 1 runs 6, 5, 4, 4 and ends at 2, page 2 starts at 2 (the page boundary holds); distribution 0x107, 1x120, 2x85, 3x28, 4x15, 5x1, 6x1; same row set as the default and a different order. |
| 4 | `/draft/2024` `toString`, `desc` | PASS | Deployed default `dp.draft_year DESC, dp.pick_number NULLS LAST` (`draft.ts`). All 4 pages (160 rows, 50 per page) match the bare baseline and `?dir=desc` on pick sequence, row set and row order; picks 1 to 71 then 59 NULL picks last; 0 duplicate rows across pages. |
| 5 | `/draft/2024` `constructor`, `asc` | PASS | Same basis; the same identical result. |
| 6 | `/draft/2024` `pick`, `asc` (control) | PASS | Pick non-decreasing across all 160 rows, NULLs last, 0 violations, 0 duplicates; page boundary picks 1 to 23, 23 to 70, 71 to NULL, NULL. |

**Extra control (supplementary).** `/draft/2024?sort=pick&dir=desc`: 4 pages, 160 rows, picks descend from 71 (71, 70, 69, 68, 67, 66) with NULLs last, 0 violations, a different order from ascending and the same row set. It is needed because the default for 2024 is already pick ascending, so case 6 alone cannot tell `pick asc` from the default.

**Tie limitation.** The 2024 draft has 22 pick values shared by more than one row (for example pick 1 twice, 2 three times; distinct draft types). `listDraftPicks` has no tie-break column in either the default or the sorted `ORDER BY` after `pick_number`, so the order within a tie is not guaranteed by the query. On DEV the row order was nevertheless identical across the sorted page, the baselines and every page, and no row appeared on two pages; the evidence therefore shows no pagination duplicate or loss for this year, but it does not prove tie order is stable. Case 3 has no tie issue (a player cannot play twice on one date, so goals then date is a total order).

**Authentication: NOT ESTABLISHED.** No sign-in was performed and none is claimed. No login or beta-gate redirect was observed, but whether the session was signed in or the gate was not applied was not determined (no cookie or storage inspection). Section 17.5 step 3 said "signed in"; the owner accepted the evidence as DEV acceptance with this status.

**Console and network.** No console error on any of the six cases. Case 4 recorded **three** identical warnings (a CSS `link preload` resource not used within a few seconds of the window load event, `_next/static/css/a1afd8794310d38c.css`); the figure reported to the owner at the time was "two" and the saved log (`case4-console.txt`: 3 messages, 0 errors, 3 warnings) is the record. The warnings are benign preload notices. No non-2xx request in any case log. No credential appears in any file.

**Post-browser journal check (reviewed read-only `smoke-journal.sh`, true-array `-Command` invocation, new log).** `SMOKE_START` 20261014T145401; run 14:59:29 AEDT; exit **0 = PASS**: the journal was read completely, 344 lines in the window, no matching line, `syntax error`, `invalid input syntax`, `date/time field value out of range`, `unhandled`, `Failed to log administrative audit` and `ERROR` all 0. Log `post\smoke-journal-281-postbrowser.txt` (SHA-256 `2fadc3416768a4e2cead3a0f8bb76d3f71013a08b433516d56149acb00c9143b`). The 288 submissions had not yet been made; this window covers the 281 requests only.

**Root cause, fix, validation, closure.** Root cause: the two guards used `in`, which admits `Object.prototype` keys (§1). Fix: `Object.hasOwn` in both guards (§17.1). Validation: DB-free 14/14 with a 2-case mutation check (§17.3) and the DEV browser smoke above. The owner accepted the evidence as DEV acceptance and authorised DEV-scoped closure on 2026-10-14. **Not claimed:** PROD installation, PROD acceptance, a signed-in session, or stable tie order. **PROD installation and PROD acceptance remain PENDING.** DEV stays at `17514052`.
