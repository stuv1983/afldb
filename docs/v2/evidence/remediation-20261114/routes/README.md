# Remediation 2026-11-14 — routes scope (worker evidence)

Scope: AFLDB-ISSUE-357 (ISR persistence / strict id+season parser), ISSUE-359 FE-2 and FE-3,
ISSUE-360 FE-7, ISSUE-364. Branch `claude/rem-routes-20261114` (worktree `D:\dev\afldb-rem-routes`),
base `5035ed96` (review records on top of `de640826`). Local commits only; nothing pushed.

## Commits (in order)

| SHA | Subject | Files |
|---|---|---|
| `2bc3fda4` | ISSUE-357: one strict id/season parser, int4 range, safe AFLW key decode | `src/lib/params.ts`, `src/lib/format.ts`, `src/app/matches/[id]/page.tsx`, `src/app/api/coaches/[id]/opponent-record/route.ts`, `src/app/awards/[slug]/[season]/page.tsx`, `src/app/aflw/{players/[slug],matches/[key],seasons/[key],clubs/[code]}/page.tsx`, `tests/format.test.ts` |
| `86ecabb5` | ISSUE-360: sitemap lists canonical URLs only; ISSUE-364: sitemap index no longer collides in next dev | `src/app/sitemap.ts`, `src/app/sitemap.xml/route.ts` -> `src/app/sitemap-index.xml/route.ts` (rename), `next.config.ts`, `docs/seo.md`, `tests/integration/admin-awards.test.ts` |
| `4c2872bd` | ISSUE-357: pin the route-parameter refusals and the AFLW key decode in the SEO suite | `tests/seo.test.ts` |
| (this file) | ISSUE-357/359/360/364: routes evidence README | `docs/v2/evidence/remediation-20261114/routes/**` |

## Verdicts per finding

| Finding | Verdict | Evidence |
|---|---|---|
| ISSUE-357 ISR persistence | **VALIDATED; PARTIALLY FIXED, residual remains** | `persist-base.txt` vs `persist-final.txt` |
| ISSUE-359 FE-2 (id >= 2^31 -> 500) | **VALIDATED, FIXED** | `red-unit-base-final.txt`, `hyd-final.txt` (`/players/x-2147483648` 404), unit tests |
| ISSUE-359 FE-3 (AFLW `%` slug) | **VALIDATED and AMENDED, FIXED** | `dev-aflwprobe.txt`, `hyd-final.txt` |
| ISSUE-360 FE-7 (sitemap 308 URLs) | **VALIDATED, FIXED** | `red-int-sitemap-base.txt`, `green-int-sitemap.txt`, `crawl-*` |
| ISSUE-364 (`next dev` conflict) | **VALIDATED, FIXED** | `dev-base-turbo.txt` (red), `dev-final-turbo.txt` (green) |

### ISSUE-357 (validated; fixed in part)
Measured on the unmodified production build `de640826` (BUILD_ID `jmjDphdHkdO6Wu8ybJAVn`, `persist-base.txt`):
every distinct path to an ISR route (`players/[slug]`, `matches/[id]`, `seasons/[year]`, `brownlow/[year]`,
`clubs/[slug]`, `venues/[slug]`, `honour-teams/[slug]`) persists about 7 files / 50 KB under `.next/server/app`,
whether the render is a 200, a **404, or a 308 redirect**. Non-canonical spellings of a real id/season
(`011724`, `1e0`, `0x1`, `1.0`, `02024`) rendered the **full page at a second URL** and persisted it:
10 season spellings = 33.9 MB (about 3.4 MB each), 7 leading-zero player ids = 3.2 MB, 5 Brownlow spellings = 3.2 MB.

Fixed: one strict parser (`parseCanonicalId`, `parseSeason`: canonical digits only, int4 range, season 1897-2100),
used by `parseEntitySlug` and every id/season route. A non-canonical spelling is now a 404 with the ordinary ~50 KB
not-found render, instead of a full page: on `usjtEO0IiR7zLqQnwkgzz` (`persist-final.txt`) the 10 season spellings
persist 0.5 MB (was 33.9 MB), leading-zero player ids 0.35 MB (was 3.2 MB), brownlow spellings 0.25 MB (was 3.2 MB);
all return 404, no query is issued (unit proof below).

**Residual, not fixable by a supported setting (recorded, owner decision O-1):** a well-formed but non-existent id/slug,
a malformed player slug, and a wrong-slug 308 still each persist ~7 files / ~50 KB per distinct path (unchanged:
20 paths = 140 files / 1.0 MB in `persist-final.txt`). Next 16.3.1 has no supported option to keep a `notFound()` or
redirect ISR render out of the incremental cache (checked `node_modules/next/dist/docs`); `dynamicParams = false` would
404 every season/entity created after the build until the next rebuild.

**Attempted and rejected (T1):** calling `await connection()` before `notFound()`/`permanentRedirect()` on the seven ISR
pages so those exits would be dynamic. Built (`kIK11V2UdpErY6kn0i2JS`) and served: every ISR path returned **HTTP 500**
with `digest: 'DYNAMIC_SERVER_USAGE'` and 0 files persisted (`persist-exp-t1.txt`, `t1-connection-attempt-server-head.txt`).
`connection()` inside an on-demand ISR render raises instead of falling back to dynamic. The edits were reverted before
any commit; no trace of `route-exit` remains in the commits.

### ISSUE-359 FE-2
Ids above 2^31-1 are well-formed but bind an int4 comparison and raise `22003` (a 500) on players, player matches,
coaches, matches and `/api/coaches/<id>/opponent-record`. Now: `parseCanonicalId` rejects them (404 on pages;
oversized canonical -> 404 and malformed -> 400 on the API route) before any query. Pinned in `tests/seo.test.ts`
(no query issued, via the recording sql mock) and `tests/format.test.ts`.

### ISSUE-359 FE-3 (amended)
The finding said AFLW keys are decoded unsafely. Measured (`dev-aflwprobe.txt`, Next 16.3.1 dev, `PARAMPROBE` lines):
for `/aflw/players/Aasta_O%2527Connor` the **page** receives the segment still percent-encoded (`Aasta_O%2527Connor`)
while `generateMetadata` receives it **decoded once** (`Aasta_O%27Connor`). The old code decoded both, so metadata
over-decoded to `Aasta_O'Connor`: title "AFLW player not found", noindex, no canonical, on a page that rendered.
17 of 960 live `aflw.players.slug` values contain a literal `%27` (other AFLW tables: none). A malformed escape threw
`URIError` (500) in the page. Fix: `aflwKeyFromPageParam` (safe decode, null -> `notFound()`) and
`aflwKeyFromMetadataParam` (no second decode), in the four AFLW pages. Final build: title
`Aasta O'Connor — AFLW Stats, Games & Career Record | AFLDB`, canonical `.../aflw/players/Aasta_O%2527Connor`
(`hyd-final.txt`; screenshots `shots/`).

### ISSUE-360 FE-7
47 sitemap URLs (`/awards/brownlow-medal` + 46 season pages) 308-redirect to `/brownlow...`. `sitemap.ts` now excludes
the `brownlow-medal` award (both queries). Base crawl: 34,576 URLs = 34,529 x 200 + **47 x 308**
(`crawl-base-summary.txt`, `crawl-base-non200.txt`); final crawl: **34,529 URLs, all 200, no non-200**
(`crawl-final-summary.txt`). Segment diff: `sitemap-equivalence.txt`: only `seg-1.xml` differs, 235 lines removed
(47 x `<url>` of 5 lines), 0 added, 0 removed lines that are not `awards/brownlow-medal`; index and the other 10 segments
byte-identical (sha256 equal); `/sitemap.xml` response headers equal apart from `Date`.

### ISSUE-364
`src/app/sitemap.ts` (metadata route) and `src/app/sitemap.xml/route.ts` both resolve to `/sitemap.xml`; production
build tolerates it, `next dev` does not. Base, Turbopack (`dev-base-turbo.txt`): `Conflicting route and metadata at
/sitemap.xml` and **even `/api/health` returns 500**; webpack (`dev-base-webpack.txt`): "Duplicate page detected" and
`/sitemap.xml` 500. Fix: move the handler to `src/app/sitemap-index.xml/route.ts` and serve it at `/sitemap.xml` through
`next.config.ts` `rewrites().beforeFiles`. Final, Turbopack dev (`dev-final-turbo.txt`): `/api/health` 200,
`/sitemap.xml` 200 (828 B), `/sitemap/0.xml` 200, `/sitemap/1.xml` 200. Production build: `/sitemap.xml` 200, 828 B,
**sha256 identical to the base index** (`98012cda…`), headers equal (cache-control `public, max-age=0, s-maxage=86400`,
`content-type: application/xml`); `/sitemap-index.xml` is also reachable (200, 828 B) — a second URL for the same
document, harmless, noted for O-3.

## Tests (host `streamanator`, workspace `/mnt/ssd/afldb-rem-routes-20261114`, isolated PG port 55617)

Red = new tests copied onto the untouched base checkout `cand` (`de640826`), then `git checkout -- tests` (status clean).
Command: `bash vt.sh cand tests/seo.test.ts tests/format.test.ts` (= `node node_modules/vitest/vitest.mjs run …`, no DB vars).
Result `red-unit-base-final.txt`: **10 failed | 69 passed**, with the expected texts:
- `AssertionError: 011724: expected { slug: 'scott-pendlebury', id: 11724 } to be null`
- `AssertionError: expected null to deeply equal { slug: 'x', id: undefined }`
- `TypeError: parseCanonicalId is not a function` (also `isOversizedCanonicalId`, `safeDecodeParam`)
- `AssertionError: "02024": expected 2024 to be undefined`
- `AssertionError: a query was issued for a refused parameter: expected [ …(5) ] to deeply equal []` and `…(11)`
- `AssertionError: expected 'AFLW player not found' to contain 'Aasta O\'Connor'`
- `AssertionError: expected [Function] to throw error including 'NEXT_NOT_FOUND' but got 'URI malformed'`

Integration red (`red-int-sitemap-base.txt`, `tests/integration/admin-awards.test.ts -t "brownlow-medal URL"` on a base
snapshot copy): `AssertionError: expected [ …(47) ] to deeply equal []`.

Green on the final commit `4c2872bd` (`green-unit-3.txt`): `seo.test.ts` 30, `format.test.ts` 49 and
`coach-profile-route.test.ts` 18 = 97 passed, 0 failed (3 files). Integration `admin-awards.test.ts`: 43 passed in the
final-checkout run (`int-final-admin-awards-release-gates.log`), including the new "lists no /awards/brownlow-medal URL,
only the canonical /brownlow ones" case (also run alone: `green-int-sitemap.txt`, 1 passed, 48 skipped by `-t`). The new
case first asserts the snapshot has >= 1 active brownlow-medal season winner (53 on the snapshot), so it cannot pass
vacuously, and compares against the live database rather than a restated oracle.

### Full unit gate, final checkout (clean, `git rev-parse HEAD` = `4c2872bd3d932ac68f3b8b6c172a6fbfb904446f`, porcelain 0 before and after)
`bash runit.sh final` (vitest `--exclude 'tests/integration/**'`, DATABASE_URL unset): **30 failed | 11876 passed | 31 skipped
(11937)**; 5 failing files (`unit-final.head`, `unit-final-failures.txt`). The same 5 files re-run on the untouched base
(`unit-base5-verbose.log`, `de640826`, clean): **30 failed | 1911 passed**, per-file failure counts identical
(`db-promotion-check` 1, `db-test-rebuild` 21, `draftguru-acquisition` 3, `fitzroy-core-import` 4,
`v2-acquisition-pipeline` 1): pre-existing, unrelated to this scope (reviewed-input hash pins, tracked data/doc pins, the
afl_api ownership gate). Review baseline was 107 failed / 11,739 passed (`unit-vs-review.txt`); the other 77 baseline
failures (siblings/heights/Brownlow artefact pins) do not occur here, which I attribute to the host environment of this
run (same pins now matching) and have not investigated further. One test name in `draftguru-acquisition` differs from the
review's name set, but it fails identically on base.

### Integration, final checkout (fresh snapshot copy `afldb_v2_remroutes_int2_test`)
`tests/integration/admin-awards.test.ts` + `tests/integration/release-gates.test.ts`: 94 passed | 8 failed | 7 skipped.
All 8 failures are `release-gates.test.ts` data-snapshot assertions (2026 completion, 261-player count, ladder identity
pins…). The same file on the base checkout against its own fresh snapshot copy: 8 failed | 51 passed | 7 skipped with an
**identical failing-test set** (`int-base-release-gates.log`), so not caused by this change.

### Lint
`eslint` on all touched source and test files: 0 errors, 1 pre-existing warning (`periods` unused in
`src/app/aflw/matches/[key]/page.tsx`, not mine).

## Final qualification build (production build of the final commit)
- Checkout `/mnt/ssd/afldb-rem-routes-20261114/final` (clone of the base checkout + bundle of the three commits):
  `git rev-parse HEAD` = `4c2872bd3d932ac68f3b8b6c172a6fbfb904446f`, `git status --porcelain` empty before the build, after
  the unit gate and after the integration run.
- `rbuild.sh final` under the heavy lock, no `TC=off-host` (full type-check inside the build): `rc=0`, 1076 s,
  **BUILD_ID `usjtEO0IiR7zLqQnwkgzz`**, served on 127.0.0.1:3203 against `afldb_v2_remroutes_final_test`.
  Serving proof: `serving-proof-final-3203.txt` (listener pid cwd = `final`, BUILD_ID file = above). The crawl's "served
  build id:" line is empty in every run because its grep pattern does not match Next 16 output; do not treat it as evidence.
- Baseline build `jmjDphdHkdO6Wu8ybJAVn` (`de640826`) on 3201 for comparison; experiment build `kIK11V2UdpErY6kn0i2JS`
  (T1, rejected) on 3202.
- **Sitemap crawl** (`crawl.sh`): final 34,529 URLs, 34,529 x 200 (T-1 requirement: no app-emitted link redirects or 404s).
  Reviewed baseline was 4,785 x 200 in the review's scope; this crawl is of the whole sitemap on the snapshot.
- **Internal links** (`links.sh`, 1 hop from 27 seed pages incl. all changed pages): 2,993 unique internal links:
  2,992 x 200 and 1 x 500, `/search?q=Michael+Tuck` (a link on `/`). The 500 reproduces **identically on the base build**
  and is environmental: log line `AFLDB_SESSION_SECRET is not set (or too short)` (my server env sets no session secret;
  `/search` reads the session). Not a defect of this change; not fixed. Recommendation: nothing, unless the owner wants
  `serve.sh` to export a throwaway secret for future qualifications.
- **Hydration / overflow smoke** (`hyd.mjs`, Playwright chromium, desktop 1366x768 and mobile 390x844, 15 pages each):
  0 console errors/warnings, `overflowX=0` on every page, expected 200s and 404s (`hyd-final.txt`; screenshots
  `shots/`: AFLW `%27` player at both viewports and the season-not-found page on mobile).
  `VISUAL`: automated overflow/console checks plus three captured screenshots; I did not eyeball every page image.
- Param semantics on the served final build: `/seasons/02024` 404; `/players/x-2147483648` 404; AFLW `%27` slug 200
  with the correct title and canonical.

## T-1: callers of the strict parsers
`parseSeason` callers: `seasons/[year]`, `brownlow/[year]`, `awards/[slug]/[season]` (its private copy is removed; now
shared), `players/[slug]/matches` (`?season=`), `seasons/page` (`from`/`to`), admin Brownlow pages, admin data-editor,
admin operations views. `parseEntitySlug` callers: `players/[slug]` (+ metadata), `players/[slug]/matches`,
`coaches/[slug]`. `parseCanonicalId`: `matches/[id]` (+ metadata), coach opponent-record API, `parseEntitySlug`.
Every app-emitted link uses an integer id or year taken from the database (canonical), so none now redirects or
404s: confirmed by the full-sitemap crawl (all 200) and the 2,992/2,993 internal-link crawl, plus the unit cases that
a canonical id and season still query. Admin-only callers take operator-typed query strings; a non-canonical year
there is now treated as no season (not separately exercised in a browser).

## Next 16.3.1 parameter asymmetry (new finding, INFO/MED-adjacent)
A dynamic segment reaches `generateMetadata` decoded once and the page percent-encoded (see FE-3). Any other route that
decodes a segment in both places (or in only one) can over- or under-decode a `%` key. I fixed the four AFLW routes
and did not sweep the rest of `src/app`; the AFLDB code with `decodeURIComponent` on route params outside this scope
is unaudited here.

## Incidents and deviations I must disclose
1. **Shared scratchpad collision.** The shared `scratchpad/build.sh` had been overwritten by the `answers` agent. I
   copied it to my workspace and ran `bash build.sh exp …`, which executed the **answers agent's script**: it targeted their
   workspace/database (`mkdb` refused because it existed), re-applied their idempotent
   `site_settings home.record_of_the_week` INSERT to their `afldb_v2_remanswersbuild_test`, rewrote their
   `$W/in/fe4-setting.sql` with identical content, and queued a duplicate of their build behind the heavy lock. I killed
   my duplicate (pids 437838/438128) before it built; their own queued build (401275/402246) was untouched. I deleted the
   foreign `build.sh` from my host workspace and moved all my scripts to `scratchpad\routes\` with the line-2 tag
   `# SCOPE-TAG: routes-afldb-rem-20261114`. Results recorded before that point came from my own scripts; none came from the
   foreign one. The orchestrator should tell the answers owner about the repeated INSERT (idempotent, same content).
2. I amended `2bc3fda4` once before reporting (to keep only the parse hunk in `matches/[id]/page.tsx`); nothing was
   amended after it was reported.
3. No migration, no production/DEV read or write, no push, no `sudo`, no `wsl`, no edits outside `D:\dev\afldb-rem-routes`
   (and my host workspace). The 27 GB host workspace is left for owner cleanup.

## Cleanup (host)
Servers on 3201, 3202, 3203, dev 3204/3205: all stopped (`ss -ltn` shows no listener on 3200-3299). Isolated cluster
`isolated-pg stop` on 55617 done: "server stopped", no listener on 55617. `du -sh /mnt/ssd/afldb-rem-routes-20261114`
= **27G** (builds, `node_modules`, `pg-root`, evidence). Not deleted: the owner decides.

## Remaining failures and coverage gaps
- ISR persistence residual for well-formed unknown ids/slugs and slug-redirects (O-1).
- Admin `revalidatePath('/sitemap.xml')` (admin awards/coaches/draft revalidate-paths and `admin-awards.ts`): after the
  move the string matches no route file (the index is a rewrite). It never covered the `/sitemap/[id]` segments. Behaviour
  to confirm on DEV: whether the sitemap index refreshes after an award edit. I did not test admin revalidation end to end.
- Hydration was checked on a snapshot DB, not on production data; no mobile eyeball of every page.
- Admin-only `parseSeason` callers not browser-tested.
- 30 pre-existing unit failures and 8 pre-existing `release-gates` integration failures (identical on base).

## Owner decisions (with recommendations)
- **O-1 ISR persistence residual (ISSUE-357).** Options: (a) accept; strict parsing already removed the 3.4 MB
  amplifier, the rest is ~50 KB per distinct junk path; (b) rate-limit/deny junk paths at Caddy (pattern: player slug not
  ending `-<digits>`) with a negative cache; (c) a custom `cacheHandler` that drops 404/308 entries (`cacheHandler` in
  `next.config.ts`; non-trivial, version-coupled); (d) `dynamicParams = false` for fully enumerable routes (clubs, venues,
  honour teams) with a rebuild per new entity. Recommend (b) + (a). Do not retry `connection()`.
- **O-2 Non-canonical spellings: 404 or 308?** I chose 404 (cheapest; no redirect to persist). A 308 to the canonical
  URL would be friendlier to old links but persists a redirect per spelling. Recommend 404.
- **O-3 `/sitemap-index.xml` is publicly reachable as a second URL for the index.** Recommend leave; or add a
  `beforeFiles` redirect/404 if the owner dislikes duplicates.
- **O-4 `serve.sh` session secret** (see links note), recommendation: none for production.

## Proposed ledger text
**AFLDB-ISSUE-357** (routes part): "Validated on `de640826`: every distinct path to an ISR route (players, matches,
seasons, brownlow, clubs, venues, honour-teams) persisted ~7 files/50 KB, 200, 404 and 308 alike; non-canonical numeric
spellings (`011724`, `1e0`, `0x1`, `02024`) rendered full pages at second URLs (33.9 MB for 10 season spellings).
Fixed in `2bc3fda4`/`4c2872bd`: one strict canonical id/season parser (int4 range), non-canonical spellings 404 with no
query. Residual: well-formed unknown ids/slugs and slug 308s still persist ~50 KB/path; no supported Next 16.3.1
setting avoids it (`connection()` before `notFound()` was built and measured: HTTP 500 `DYNAMIC_SERVER_USAGE`).
Owner decision O-1 open. Evidence `docs/v2/evidence/remediation-20261114/routes/`."
**AFLDB-ISSUE-359 FE-2/FE-3**: "Ids above 2^31-1 now 404 (API: 404/400) before any query. FE-3 amended: Next 16.3.1 gives
`generateMetadata` the segment decoded once and the page percent-encoded; the old double decode made 17 live AFLW
`%27` player slugs title 'AFLW player not found' (noindex, no canonical). Fixed with one decode per entry point; malformed
escapes 404 instead of URIError."
**AFLDB-ISSUE-360 FE-7**: "Sitemap no longer lists the 47 `/awards/brownlow-medal` URLs (308s); crawl 34,529 x 200."
**AFLDB-ISSUE-364**: "`next dev` failed with `Conflicting route and metadata at /sitemap.xml` (even `/api/health` 500).
Index handler moved to `src/app/sitemap-index.xml/route.ts` and rewritten to `/sitemap.xml`; production
`/sitemap.xml` byte-identical, Turbopack dev 200."

## Proposed CHANGELOG lines (Unreleased)
- Fixed: route ids above PostgreSQL integer range, and non-canonical id/season spellings (`011724`, `1e0`, `02024`), now return 404 before any query instead of 500 or a duplicate full page (ISSUE-357, ISSUE-359).
- Fixed: AFLW player/match/season/club pages decode their route key once, so slugs containing `%27` get the correct title and canonical and a malformed escape returns 404 (ISSUE-359).
- Changed: the sitemap no longer lists the 47 `/awards/brownlow-medal` redirect URLs (ISSUE-360).
- Fixed: `next dev` no longer fails on the `/sitemap.xml` route/metadata conflict; the index handler lives at `src/app/sitemap-index.xml` and is rewritten to `/sitemap.xml` (ISSUE-364).

## Evidence index and sha256
Small evidence is committed alongside this file (`*.txt`, `*.log`, `shots/`). Large host files (not committed) and their
sha256 are in `host-evidence.sha256` (unit JSON/logs, builds, server logs, crawl statuses, segment files). Host paths:
`/mnt/ssd/afldb-rem-routes-20261114/evidence/`.
