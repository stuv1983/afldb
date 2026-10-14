# AFLDB-ISSUE-279 — Under Next.js 16 every sitemap segment is empty

## 0. Status

- **Status:** Open (2026-10-08). Implemented 2026-10-14 (§17), DB-free validated (§17.1), merged to `main` as `cf1d49c3` (§18), not deployed. **Open** until the §14 item 2 DEV check passes.
- **Severity:** Medium. **Area:** public site / SEO / framework upgrade.
- **Key files:** `src/app/sitemap.ts`, `tests/seo.test.ts`, `tests/e2e/seo.spec.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-014; main-session partition R1c-F01).
- **Classification:** reproduced (DB-free witness W6), and confirmed against the installed `next@16.3.1` documentation and loader source.

## 1. Summary

Next.js 16 passes the `sitemap` function's segment `id` as `Promise<string>`. `src/app/sitemap.ts` still treats it as a number or string (`const id = Number(rawId)`), and `Number(promise)` is `NaN`. No segment branch matches, so every `/sitemap/<n>.xml` returns an empty `<urlset>`. The `/sitemap.xml` index is unaffected, so it advertises segments that are all empty.

## 2. Evidence

- `src/app/sitemap.ts`:
  - `:54-61`: the signature `{ id: number | string }`, and `Number(rawId)`.
  - The branches `:66` (`id === 0`), `:132`, `:188`, `:202` and `:249`, and the fall-through `return []` at `:261`.
- The Next 16 contract:
  - `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:354-383` ("Async `id` parameter for `sitemap` (Breaking change)").
  - `.../04-functions/generate-sitemaps.md:35-38` (`id: Promise<string>`, `await props.id`).
- The installed loader: `node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js:276-280`, `const data = await handler({ id: targetIdPromise })`. The build uses `--webpack` (`package.json:8`).
- Tests that hide it:
  - `tests/seo.test.ts:228, :243, :251` call `sitemap({ id: 0 })` with numbers, the pre-16 contract.
  - `tests/e2e/seo.spec.ts:199-206` reads only the index, never a segment.

## 3. Trigger

Any request for `/sitemap/<n>.xml` on a deployment with `AFLDB_INDEXING=on` and the beta gate off.

## 4. Expected invariant

- Segment 0: static routes, clubs, seasons, venues and coaches.
- Segment 1: the curated landing pages.
- Segments 100+: players. Segments 200+: matches. Segment 300: AFLW.

## 5. Actual behaviour

Every segment is empty, and no query runs.

## 6. First wrong layer

`src/app/sitemap.ts:54-61`.

## 7. Impact

- No live effect today: indexing is off, the PROD beta host is noindex and `robots` fails closed.
- At public launch the site would publish a sitemap index whose segments list no URLs, silently.
- No data is affected.

## 8. Reproduction / witness

- W6: `D:\tmp\review-20261008-full\witness\w6\` (vitest, `@/db/client` mocked to record calls as `tests/seo.test.ts:16` does), result `w6.result.json`.
- Number contract: segments 0/1/100/200/300 return 18/13/1/1/10 URLs and run 4/4/1/1/4 queries.
- `Promise<string>` contract: 0 URLs and 0 queries for every segment.

## 9. Disproof attempts

- The loader does not coerce the id.
- The build does not use Turbopack.
- No code awaits `id`.

## 10. Existing-issue search

- `issues/closed/AFLDB-ISSUE-107.md:489-497` concluded "Next 16 introduced no sitemap regression", but on the indexing-off path only, which never exercises a segment.
- Classification: **new**. This is a regression introduced by the ISSUE-107 upgrade that its validation could not observe; it is not a reopening.

## 11. Scope

Sitemap id handling and the three unit-test calls.

## 12. Out of scope

Indexing policy and the launch date.

## 13. Proposed fix boundary

- `src/app/sitemap.ts`: `const id = Number(await rawId)`, typed `Promise<string> | string` if both contracts must be served.
- Update the `tests/seo.test.ts` calls to the Promise contract.

## 14. Proposed validation

1. DB-free: `tests/seo.test.ts` with `id: Promise.resolve('0')` (and 1, 100, 200, 300) asserting non-empty segments.
2. DEV with indexing on: `/sitemap/0.xml` contains at least one `<url>`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Code fix plus test update. This must be done before indexing is enabled.~~ Done and merged (§17, §18). **Remaining:** deploy to DEV and run the §14 item 2 check with indexing on; close only when it passes.

## 17. Implementation record (2026-10-14)

- **Commit:** `c206d1d1` on `sonnet/issue-279`, base `a7f7a713`. Files: `src/app/sitemap.ts`, `tests/seo.test.ts`.
- **Fix.** The default export now types `id` as `Promise<string | undefined> | string | number | undefined` and reads it as `Number(await rawId)`. The Next 16 loader passes `Promise<string>` (`next-metadata-route-loader.js`, `handler({ id: targetIdPromise })`, with `.xml` stripped and `undefined` when absent); the earlier plain-string and number contracts still work (awaiting a plain value is a no-op) so the Number coercion that fixed the original `id === 0` mismatch is kept. `generateSitemaps` and the `/sitemap.xml` index route are unchanged.
- **Tests (DB-free, `tests/seo.test.ts`, `sitemap`).** The three existing calls moved to the Promise contract. New: every segment 0, 1, 100, 200, 300 is non-empty under `Promise<string>` and equal to the string and number contracts (segments 100 and 200 are given one player and one match row through a mutable `@/db/client` mock, so they have something to list, and their exact URLs are asserted); an id that names no segment (`'999'`, `undefined`, `'not-a-number'`) renders nothing. The shared mock stays empty for every other test.
- **Not changed.** `tests/e2e/seo.spec.ts` still reads only the index, never a segment (§2); the DEV check in §14 item 2 (indexing on, `/sitemap/0.xml` containing a `<url>`) was not run. The e2e read would need a database and a running server.

## 17.1 Validation (2026-10-14, assistant-run on the operator's explicit authorisation; Windows, DB-free)

- `npx vitest run tests/seo.test.ts`: **25 passed**. **Negative control:** with the previous `src/app/sitemap.ts` restored, 2 fail (the new all-segments case, and the club-comparison case, which now reads segment 0 under the Promise contract and finds it empty); the fixed file was restored afterwards and the 25 pass again.
- `npx tsc --noEmit`: exit 0. `npx eslint src/app/sitemap.ts tests/seo.test.ts`: exit 0, no problems. `git diff --check`: exit 0.
- **Not run:** any integration file (`tests/integration/admin-awards.test.ts` calls `sitemap({ id: 1 })` with the number contract, which still type-checks and behaves the same), the e2e spec, any DEV/PROD action, any browser check, `npm run build`.

## 18. Readiness, merge and status (2026-10-14)

- Readiness: **accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 279`: READY (0 blockers, 3 warnings; `D:\tmp\issue279\preflight-impl.txt`). `npm run merge:ready -- --issue 279` (raw output, unchanged: `merge-ready-raw-1.txt` run first and `merge-ready-raw-2.txt` after the exception was authorised, both in `D:\tmp\issue279\`): every check PASS except **one blocker, "main worktree is clean"**, the primary checkout's **17** untracked paths. Existing warnings: no `afldb-merge-readiness` block in this runbook; no unexpected-file classification; database parity not checked.
- Exception: the owner authorised a fresh exception for this issue only, covering exactly those 17 paths: the 16 previously recorded (nine `.agents/skills` files and six stray-named files, plus the zero-byte `void`) and the literal `$null)`. `$null)` is new this session: a regular, untracked, unstaged 143-byte file created 19:40:10 on 14 Oct 2026, whose content is a cmd.exe error quoting this session's hook JSON (its origin as a session-hook artifact is an inference). SHA-256 `82E23AB9F8D5D957C23CE1FCC0252829A6C4DEFB5BF01844F316AE94102E6EFF`, equal to its copy `D:\tmp\issue279\stray-dollar-null-paren.bak` (a copy made this session before the exception; the file itself was left in place; an attempt to delete it was refused by the permission classifier and was not retried or worked around). Preconditions verified before the merge (`exception-precheck.txt` for the first look, `exception-precheck-2.txt` for the authorised set): exactly the 17-path set; the 16 established paths unchanged in length and hash; `void` regular, length 0, SHA-256 `e3b0c442…b855`, untracked; no tracked primary change, nothing staged; the 15 ISSUE-274/ISSUE-276 source and test file blobs (two issues, 15 files) equal at `839e084c`, at the base `a7f7a713` and on the branch. Earlier exceptions were not reused. All 17 paths were left in place.
- Merge: `c206d1d1` plus the records commit `cf1d49c3` fast-forwarded to `main` and pushed (`a7f7a713..cf1d49c3`); local `main`, the fetched `origin/main` and the live remote were verified equal to `a7f7a713` before the merge and to `cf1d49c3` after it.
- **Status: remains OPEN.** The fix is merged to `main` but **not deployed**. §14 item 2 is a stated validation criterion and has not run: **on DEV with `AFLDB_INDEXING=on` (and the beta gate off), `/sitemap/0.xml` must contain at least one `<url>`** (the `/sitemap.xml` index lists the segments; a sample of the others, e.g. `/sitemap/1.xml`, would strengthen it). The DB-free tests do not substitute for it. Nothing in this entry changes the indexing flag, the beta gate or any indexing policy; the DEV check needs a deployment and a configuration change that nobody has authorised.

## 18.1 Evidence reconciliation (2026-10-14, later session)

- **Hash limitation, corrected.** §18's "the 16 established paths unchanged in length and hash" rests on `exception-precheck.txt` / `-2.txt`, which compared only the first **16 hex characters** of each SHA-256 plus the length. No full 64-character baseline was saved immediately before the merge. A hash taken now cannot prove content from before the merge.
- **Full-hash comparison actually available.** The 13 Oct 2026 manifests `D:\tmp\issue313\untracked-blockers-manifest.txt` and `D:\tmp\issue314\closeout-20261013T021336Z\untracked-after.json` hold full SHA-256 values for the nine non-empty files (and one zero-byte stray). The current full SHA-256 and length of all nine non-empty files equal them exactly, and their 16-character prefixes equal the pre-merge 14 Oct values. The seven zero-byte files (including `void`) are `e3b0c442…b855` by definition of length 0 (length 0 and the prefix were recorded before the merge). This supports "unchanged since 13 Oct and, by prefix and length, at the merge", not a full-hash proof at the merge instant.
- **`$null)` is not stable.** Its current SHA-256 is `D9EDB146…2500` (143 bytes, rewritten 20:00 on 14 Oct), not `82E23AB9…6EFF`: the SessionStart hook rewrites the file in every session with a cmd.exe error quoting that session's `session_id`. Confirmed by content (the new file names this session's id; the saved copy `stray-dollar-null-paren.bak` names the ISSUE-279 session's). The `82E23AB9…` hash identifies the 14 Oct 19:40 content only; a full-content exception for this path must be established freshly each session. No hook or settings change was made here.
