# AFLDB-ISSUE-344 — Out-of-range draft pages report zero matches for nonempty results

**Status: RESOLVED 2026-11-08; fix published 2026-11-09 in `ae28bd70` (`origin/main` `c5959bbf..ae28bd70`; evidence carried forward, `docs/v2/evidence/open-issues-closure-20261108/b2b5-publish/`).** It is not on DEV or production. The pinned ISSUE-336 release R′ `c1c4b22e` does not carry it, so production keeps this defect after that release. Verified on isolated Linux (streamanator, disposable `afldb_v2_verify_test`, ledger 118):
- `catalogue-lookups` passed 24/24.
- `tests/integration/admin-draft.test.ts` passed 47, failed 0 and skipped 5, and all 5 ISSUE-344 cases passed.
- **Browser, both routes PASS** (loopback-only `next dev`, desktop 1280×800 and mobile 390×844):

| Route | Requested URL | Final URL | Total | Visible rows |
|---|---|---|---|---|
| Public | `/draft/2097?page=999&view=rookie&q=Issue344` | `/draft/2097?q=Issue344&view=rookie&page=2` | 57 matching | 7 |
| Admin | `/admin/draft?page=999&year=2097&kind=rookie&q=Issue344` | `/admin/draft?q=Issue344&year=2097&kind=rookie&page=2` | 57 selections matching "Issue344" | 7 |

Both requested URLs answered 307 and then 200. In each route, page 1 (50 rows) and the last page (7 rows) together held exactly the 57 expected names. Control rows show that `view`/`kind` and `q` were each kept: the total would read 60 if `view`/`kind` were lost and 62 if `q` were lost.

Screenshots and `results.json` are in [AFLDB-ISSUE-344-evidence/](AFLDB-ISSUE-344-evidence/). The full record is in the [ledger](../../issues.md#afldb-issue-344).

## Production-mode recheck (2026-11-08): both routes PASS

Same disposable workspace (`/mnt/ssd/afldb-verify-20261108T002136Z`), same isolated `afldb_v2_verify_test`, same 2097 synthetic picks, no new data.
- **Checked before starting:**
  - `isolated-pg verify` passed.
  - Cluster `afldb_v2_isolated` on `127.0.0.1:55497`, ledger 118 rows, latest `118_fixtures_unconfirmed_participants.sql`.
  - Read-only pick count for 2097: 57 Issue344 Rookie, 3 Issue344 National, 5 Control Rookie (65 in all), and 0 picks in any other year.
  - The disposable admin `issue344-verify@example.test` (role `admin`) was reset with a new password and authenticator secret.
- **Build:**
  - `npm run build` (`next build --webpack` plus `prepare-standalone`) passed, BUILD_ID `HtOS-6khAOI5hbDba05h7`.
  - `AFLDB_ENV=development` was kept only because the loopback server is plain HTTP and Secure cookies would not set there.
  - The first build attempt failed its type check on `issue344-seed/admin-draft.local.ts`, the session-1 test copy left in the workspace. It was renamed to `.ts.txt` there, which touched no repository code.
- **Server:** standalone `node .next/standalone/server.js` with `NODE_ENV=production`, listening on `127.0.0.1:3344` only.
- **Browser:** the host's Playwright 1.62.1 headless shell, desktop 1280×800 and mobile 390×844. `console` and `pageerror` listeners were attached to each page before its first navigation.
  - Run 1 took no screenshots.
  - Run 2 repeated the same steps with full-page screenshots.

| Route | Requested URL | Redirect | Final URL | Total | Last page rows |
|---|---|---|---|---|---|
| Public | `/draft/2097?page=999&view=rookie&q=Issue344` | 307 then 200 | `/draft/2097?q=Issue344&view=rookie&page=2` | "57 matching"; pager "51–57 of 57" | 7 (Issue344 Rookie 51–57, in order) |
| Admin | `/admin/draft?page=999&year=2097&kind=rookie&q=Issue344` | 307 then 200 | `/admin/draft?q=Issue344&year=2097&kind=rookie&page=2` | "Page 2 of 2 · 57 selections matching "Issue344"" | 7 (Issue344 Rookie 51–57, in order) |

The results above were the same in both runs and at both viewports:
- Page 1 had 50 rows, and page 1 plus page 2 held exactly the 57 expected names.
- The admin form kept q=`Issue344`, year=`2097` and kind=`rookie`.
- The public page showed no empty-state message.
- Neither route scrolled sideways.
- The admin sign-in landed on `/admin`.

**Warnings:**
- Both runs logged 0 console messages and 0 page errors at both viewports.
- The server log has 6 lines, none of them an error or warning.
- The dev-mode hydration warning on the public draft `<nav>` (a `caret-color: transparent` style mismatch) did **not** reproduce in run 1 (no capture) or run 2 (with capture).
- Limit: React production builds don't run the development-only attribute-mismatch check. This recheck therefore shows the warning has no production-visible effect. It does not prove whether the earlier dev-mode warning was caused by screenshot capture.

**Shutdown:**
- The standalone server was stopped, and port 3344 has 0 listeners.
- The isolated cluster was stopped (`pg_ctl: no server running`).
- The host `secrets/` folder was removed.
- Nothing shared was touched: not `afldb_test`, not `afldb_dev`, no deployments, no backups.

Evidence: [AFLDB-ISSUE-344-evidence/prod/](AFLDB-ISSUE-344-evidence/prod/), with `run1-nocapture/results.json` and `run2-capture/` (`results.json` plus four `V-344-prod-*.png`). The fix is still uncommitted and has not been deployed.

Choice: clamp and refetch, via `redirectPastEnd` to the last page with filters kept, plus a bounded count that runs only for an empty page past the start. Tests: `tests/catalogue-lookups.test.ts` and `tests/integration/admin-draft.test.ts`. The redirect has no automated route test; it is browser-verified as above. Opened 2026-11-08. **Severity: Low.** Area: Public and admin draft pagination.

This review authorizes documentation only. The sequence below is a proposal, not authorization to implement or operate any environment. [Detailed ledger](../../issues.md#afldb-issue-344).

Review baseline: branch claude/issue-339-deploy-preflight, HEAD 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656, 2026-11-08. These source paths are unchanged from the locally recorded published origin/main 7fabc6e51c5c53c4b6f6fe345f21191d9184660b; this is not a fresh remote or production verification. Evidence is source-established, with no new executable reproduction. Graph tools were unavailable; exact source and caller searches were used. See [review handoff](AFLDB-ISSUE-339.md#repository-review-handoff-2026-11-08) for coverage and limits.

## Affected behavior and exact evidence

- src/db/queries/draft.ts:149-184 takes total from count(*) OVER() on returned rows and falls back to 0 for an empty OFFSET page.
- src/app/draft/[year]/page.tsx:95-125 accepts the requested page; :212-228 renders total as matching and says no selections are recorded/match filters when rows are empty.
- src/lib/params.ts:9-13 bounds a page number but does not clamp it to the result count; src/components/Pagination.tsx:21-22 hides navigation for total 0.
- src/db/queries/admin-draft.ts:1946-1958 has the same window-total fallback; src/app/admin/draft/page.tsx:71-84 and :170-176 consumes it for the listing/pager.

## Trigger, prerequisites and impact

A bookmarked, hand-entered or stale page exceeds the last page for otherwise valid year/category/filter results. OFFSET returns no rows, so the window count disappears even though earlier pages contain matches.

Public draft pages falsely say there are zero matching selections (or none recorded for the year); admin draft lists also lose the actual total and pagination recovery. Data is not deleted.

## Root cause, callers and smallest viable fix

The result-count contract depends on at least one row surviving pagination. Page validation limits numeric size, not the dataset range.

Return the true count for empty offset pages using identical predicates (for example a bounded fallback count), and explicitly handle an out-of-range page by clamping/refetching or rendering a recovery link with the correct total. Keep count/row snapshot semantics clear. Fixing only the count risks invalid from/to pagination text.

## Implementation sequence and dependencies

1. Seed a small known draft result and assert an over-page response has the same total as page 1 in both public/admin query suites. Include real zero-match controls.
2. Implement the smallest query fallback/shared count contract, then a safe route/pagination recovery that preserves category, club, text and sort.
3. Verify first/last/over-page ordering and the established category, NBSP-name and missing-pick contracts.

Choose clamp/refetch versus an explicit out-of-range message; either must retain the true count and useful navigation. Can be implemented alongside draft work but does not reopen ISSUE-336's category decisions.

## Focused reproduction and regression checks

Extend tests/integration/admin-draft.test.ts and tests/catalogue-lookups.test.ts (existing query/sort checks); add the nearest route/pagination rendering assertions. Cover total 0, one page, final partial page, page beyond final, filters changing while on a later page, and stable category/order. The existing first-page draft/NBSP regressions do not prove this failure case.

These checks are proposed for a later authorized implementation phase; none was executed during this review. Existing evidence does not establish an incident on DEV or production.

## Measurable acceptance criteria

A page beyond the final page never reports zero matches when matching selections exist; the true total is retained and a valid page is reachable without losing filters. Genuine no-match views stay correct; ordering and NULL semantics are unchanged.

## Failure handling and recovery

Read-only UI/query change; no data migration or repair. Revert the code change if query cost or route handling regresses. Avoid an unbounded count for every normal page when a fallback suffices.

## Duplicate and decision review

No matching open issue. The similar dormant runAdvancedSearch window count is excluded: /advanced-search redirects to /players (src/app/advanced-search/page.tsx:50-54), so it is not evidence of a reachable public-route defect.
