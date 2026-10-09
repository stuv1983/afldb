# AFLDB-ISSUE-279 — Under Next.js 16 every sitemap segment is empty

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

Code fix plus test update. This must be done before indexing is enabled.
