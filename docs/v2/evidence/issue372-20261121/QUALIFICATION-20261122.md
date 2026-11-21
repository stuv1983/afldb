# AFLDB-ISSUE-372 option B: red/green qualification of `b40c13ff` against `5199eb4f` (22 November 2026)

**Verdict in one paragraph.**

- **Unit and static checks.** Green. Red is a real red, at both the load level and the assertion level.
- **Harness.** The harness did NOT reproduce the ISSUE-372 failure mode for the route the commit targets.
  - `/awards/[slug]/[season]` is **not an ISR route in the production build**. The build's route table marks it `ƒ`
    (dynamic), it is absent from `prerender-manifest.json` `dynamicRoutes`, and every response carries
    `cache-control: private, no-cache, no-store`. Nothing is cached, so there is no cached 404 and no 404 → 200 head
    divergence.
  - Red (`5199eb4f`) and green (`b40c13ff`) are therefore **identical for that page**: 8/8 pre-publication 404, then
    24/24 post-publication 200 with the correct title, no `noindex`, and the winner in the body, on both workers.
- **What option B does fix, demonstrably.** The same award publication also changes `/seasons/2026`, a real ISR page.
  - Red: the page refreshed on the acting worker only. Worker 2 kept the old page, with 0 of its 8 post-publication
    samples showing the new award.
  - Green: both workers refreshed. The first post-publication request on each worker was `x-nextjs-cache: MISS`, and
    16 of 16 samples show the award.
  - The fix works through the **concrete** `/seasons/<y>` (and `/brownlow/<y>`) paths the new fan-out posts. The
    `/awards/[slug]/[season]` **pattern** it also expires is inert today.
- **Brownlow (ISSUE-371).** Re-run on the candidate build, still green: 24/24 correct, no `noindex`, first request
  `MISS` on both workers, and 404 and strict-parsing checks 404.

Finding F-001 (MED, premise not reproduced) is in §6. It is a decision input for the owner's 372 A/B/C choice, not a
code defect in the commit.

## 1. Revisions, setup and limits

- **Candidate:** `b40c13ff66406cc14fed7dc09c01e5bab74834da`, a `git archive` into `/mnt/ssd/afldb-backlog-20261122-q/cand`.
- **Base:** `5199eb4f8859ca809578dcaa6b1b3444020625c2` (= `origin/main`, contains the ISSUE-371 fix), a `git archive` into
  `.../base`.
- **Host:** streamanator, as `arm`, no sudo.
  - The alias was broken, so `ssh -i ~/.ssh/afldb_dev arm@10.0.40.100` was used.
  - Node v22.23.2.
  - Ports used: app **3140**, isolated PostgreSQL **61530**.
  - Nobody else's port, workspace or process was touched. DEV's `afldb.service` was not touched. There was **no
    production contact**. No `git` ref was changed in the source checkout (`git archive` only).
- **Dependencies.** Candidate: `npm ci`, rc=0 (427 packages). `package-lock.json` is byte-identical in both trees
  (sha256 `984b4422…8e86`), so the base reuses a `cp -a` of the candidate's `node_modules`.
- **Database.** Own isolated cluster `afldb_v2_isolated`, root `$W/pg`.
  - Template `afldb_v2_i372tpl_test` was restored from `/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump`
    (read-only; sha256 `d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63`, 20,662,515 bytes).
    `pg_restore` exit 0.
  - Seed `afldb_v2_i372seed_test`: the ISSUE-371 synthetic 2026 Brownlow round votes (`i372-seed-brownlow-2026.sql`;
    621 rows, 207 of 207 matches accounted; **SYNTHETIC**, never real votes) plus one super admin made by
    `tools/admin/create-admin.ts`. Its password and TOTP seed are in a `0600` file in the workspace and in no evidence file.
  - Each run gets a fresh copy of the seed.
- **Serving.** `node deploy/server-cluster.mjs`, `AFLDB_WORKERS=2`, `NODE_ENV=production`, `AFLDB_ENV=production`,
  `AFLDB_TRACE_REQUESTS=on`, `127.0.0.1:3140`, `AFLDB_REVALIDATE_URL=http://127.0.0.1:3140` and a random
  `AFLDB_REVALIDATE_SECRET` (`0600` file, never printed).
  - **`AFLDB_INDEXING=on` at build and at run time.** Without it `src/lib/indexing.ts` stamps `noindex, nofollow` on
    EVERY page, which hides the not-found `noindex` the harness uses as a discriminator. My first exploratory run
    (`red0`, not tabled) showed `noindex, nofollow` on all 24 correct 200 samples for that reason.
  - Each server ran in its own `setsid` process group. Teardown signalled only that group, and a held port was a STOP.
    Nothing was killed by port.
- **Harness files** (this folder, adapted from `docs/v2/evidence/issue371-20261121/`).
  - `i372-setup.sh`: cluster and template.
  - `i372-repro.sh`: seed, then per run: fresh DB, build or reuse, cluster, driver, teardown.
  - `i372-driver.mjs`: raw requests on new connections plus Playwright.
  - `i372-seed-brownlow-2026.sql`.

Commands, from `$W=/mnt/ssd/afldb-backlog-20261122-q`:

```
bash h/i372-setup.sh pg template
bash h/i372-repro.sh seed
bash h/i372-repro.sh run red   base awards
bash h/i372-repro.sh run green cand awards
SKIP_BUILD=1 bash h/i372-repro.sh run green_brownlow cand brownlow     # reuses the green build; clears only the rendered brownlow/2026 files
```

## 2. Part 1: unit and static

| Step | Tree | Result |
|---|---|---|
| `npx vitest run tests/settle-season-revalidation.test.ts tests/v2-coleman-projection.test.ts tests/admin-brownlow-actions.test.ts tests/auth.test.ts` | cand | **rc=0; 4 files, 399/399 passed** (96 + 42 + 38 + 223). `unit-cand.log` |
| Red, coarse: cand's two changed test files overlaid on base | base | **rc=1; 2 of 2 files failed to load**, no tests ran. `Cannot find module '/tools/maintenance/revalidate-season'` and `Cannot find package '@/lib/admin/award-season-fanout'`. `unit-red-coarse.log` |
| Red, fine: the same overlay plus cand's two new modules copied in (`src/lib/admin/award-season-fanout.ts`, `tools/maintenance/revalidate-season.ts`), so the route-behaviour assertions fail by assertion | base | **rc=1; 3 failed / 135 passed (138)**. `unit-red-fine.log`: `settle-season-revalidation` 2 failed of 96 (the concrete-paths-plus-award-pattern test, and "serves every loopback form"); `v2-coleman-projection` 1 failed of 42 ("the route keeps the capability check first, then local revalidation, then the fan-out"). Same two files green on cand: 138/138. |
| `npm run typecheck` | cand | **rc=0** |
| `npm run lint:gate` (ratchet) | cand | **rc=0, PASSED**: 338 errors in 43 files = baseline 338 in 43, did not rise |
| `npm run build` (via the harness, `AFLDB_ENV=production AFLDB_INDEXING=on`, against the run's own DB) | cand | **rc=0**, BUILD_ID `yXuPl3rXUYemyjmMZyp_P`. `build-excerpt-green.txt` |
| `npm run build` (same) | base | **rc=0**, BUILD_ID `c6w2IqAMg55DnmbUbm4df`. `build-excerpt-red.txt` |

The base tree was restored after the red unit runs (the two overlaid test files re-copied from the pristine
`orig-base-tests/`, sha256 equal; the two copied modules deleted) before it was built.

## 3. Part 2: the harness, per run

Award chosen: **Charles Sutton Medal (`bf-western-bulldogs`) for 2026**. It has no winner in the seed, so
`/awards/bf-western-bulldogs/2026` is 404. It is published through the REAL admin form
`/admin/awards/winners/new` (award, season 2026, recipient picked through the player picker, club Western Bulldogs, and the
sealed-season correction note). The Server Action POST is followed by the client's POST to `/admin/awards/revalidate`,
which answered 200 (trace: `POST /admin/awards/revalidate`; acting worker 1 in `red`, worker 2 in `green`).

A club best-and-fairest award was chosen deliberately. Coleman 2026 already has a stored winner in the rebuild, so it
cannot be a 404 season. And `/seasons/2026` (a real ISR page) lists best-and-fairest winners, so the SAME publication
also changes a cached page. The revalidated list the route returned was:
`/awards, /awards/bf-western-bulldogs, /sitemap-index.xml, /awards/bf-western-bulldogs/2026, /seasons/2026, /players/marcus-bontempelli-9073, /clubs/western-bulldogs`.

Sequence per awards run, with no restart between steps:

1. 8 raw requests on new connections (`agent:false`) to the award-season path, plus a 12-request warm of
   `/seasons/2026`.
2. Publish through the UI.
3. 8 side samples of `/seasons/2026`, then 3 × 8 raw samples of the award page, then 8 more side samples.
4. 2 client navigations.
5. A 1280×800 screenshot with a `document.title` banner.
6. 404 and strict-parsing checks.

Per-sample fields (`SAMPLE` and `SIDE` lines in `SUMMARY-*.txt`): status, `x-afldb-worker`, `x-nextjs-cache`,
`cache-control`, `<title>`, robots meta, description, h1, and whether the body shows the winner or award.

### 3.1 Award-season page `/awards/bf-western-bulldogs/2026`

| Run | Source | Pre (8) | Post (24 raw) | Cache evidence | Client nav (2) | Screenshot |
|---|---|---|---|---|---|---|
| `red` | `5199eb4f` | 8 × 404, title "Page not found \| AFLDB", `noindex` | **24 × 200**, 24/24 correct title ("2026 Charles Sutton Medal — Winner and Full Result \| AFLDB"), 24/24 winner in body, **0 `noindex`**; workers 1 and 2 both served | every response `x-nextjs-cache` absent, `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`. **No ISR file exists on disk** for the path before, immediately after, or after the samples | 2/2 title and body | `screenshots/red-full-load.png` |
| `green` | `b40c13ff` | same | same: **24/24** | same | 2/2 | `screenshots/green-full-load.png` |

So red equals green for this route. There is no cached 404 to go stale.

Build evidence: the route table (`build-excerpt-*.txt`) lists `ƒ /awards/[slug]/[season]`. The
`prerender-manifest.json` `dynamicRoutes` of both builds is `/brownlow/[year] /clubs/[slug] /honour-teams/[slug]
/matches/[id] /players/[slug] /seasons/[year] /sitemap/[__metadata_id__] /venues/[slug]`
(`prerender-manifest-dynamicRoutes.txt`).

The route's source (`src/app/awards/[slug]/[season]/page.tsx:29`) sets `export const revalidate = 86400` but has no
`generateStaticParams`, whereas every dynamic route in the manifest has one. (`/awards/[slug]` is also `ƒ`, for a different
reason: its own source comment says reading `searchParams` makes it render per request.)

### 3.2 The real ISR page the same publication changes: `/seasons/2026`

ISR `.meta` of `seasons/2026` (identical in all runs): status absent (= 200), tags
`_N_T_/layout,_N_T_/seasons/layout,_N_T_/seasons/[year]/layout,_N_T_/seasons/[year]/page,_N_T_/seasons/2026`.

| Run | Pre warm (12) | First post-publication request, per worker | First 8 post-publication samples show the new award | 8 more after the 24 raw samples |
|---|---|---|---|---|
| `red` | HIT on both workers, 0 show the award | worker 1 (acting) **MISS**; worker 2 **HIT** | **4/8** (worker 1: 4/4, worker 2: **0/4**) | still 4/8: worker 2 **0/4**, HIT, stale. `/seasons` is `revalidate = 3600`, so that stays until its window lapses |
| `green` | same | worker 2 (acting) **MISS**; worker 1 **MISS** (via the fan-out) | **8/8** (worker 1: 4/4, worker 2: 4/4) | 8/8, all HIT |

Server log of `green` (`revalidate-season` fan-out, once per worker):
```
[revalidate-season] /seasons/2026 /brownlow/2026 /awards/[slug]/[season] invalidated on worker 2 (pid …)
[revalidate-season] /seasons/2026 /brownlow/2026 /awards/[slug]/[season] invalidated on worker 1 (pid …)
```
Both traces: `POST /api/internal/revalidate-season` 200 on worker 2 and on worker 1. The base trace
(`trace-red.log`) has no such request, only the acting worker's `POST /admin/awards/revalidate`.

### 3.3 404 and strict-parsing checks (both builds, awards)

`/awards/bf-western-bulldogs/1950` (a genuinely missing season), `/…/2027`, `/…/02026`, `/…/2026.0`, `/…/+2026`,
`/…/2026abc`, `/…/%202026` and `/awards/no-such-award/2026` all answer **404** with "Page not found | AFLDB" and
`noindex`, in `red` and `green`, and again on a second pass for the first three. These are 8/8 and 3/3 in each run.

### 3.4 `green_brownlow`: the ISSUE-371 flow at the candidate build

`SKIP_BUILD=1` reuses the `green` build and clears only `brownlow/2026.*`. The flow is the ISSUE-371 one, through the real
`/admin/brownlow/2026` form.

| Phase | Result |
|---|---|
| Pre (8) | 404 on both workers; `.meta` status 404, tags `_N_T_/layout,_N_T_/brownlow/layout,_N_T_/brownlow/[year]/layout,_N_T_/brownlow/[year]/page,_N_T_/brownlow/2026`; `<title>` "Page not found \| AFLDB", `noindex` |
| Publish | "Season 2026 published: 146 polling players, 1242 votes, 1 medallist." (`POST /admin/brownlow/2026` 200, worker 1) |
| Post (24 raw) | **24/24** 200, correct title "2026 Brownlow Medal — Winner, Votes & Leaderboard \| AFLDB", correct body (146 polled), robots "index, follow" (0 `noindex`); first request per worker **MISS** (workers 1 and 2) |
| ISR on disk after | `.meta` status absent (= 200), same tags; `<title>` correct, robots `index, follow` |
| Client nav (2) | 2/2 title and body |
| Fan-out log | `… invalidated on worker 2` and `… on worker 1` |
| 404 checks | `/brownlow/1897`, `/1923`, `/02026`, `/2026.0`, `/+2026`, `/2026abc`, `/%202026`: 7/7 404, not-found title, `noindex` (and a `STALE` 404 on the cached second pass) |

The votes and names in the Brownlow screenshots are the SYNTHETIC seed, not real votes.

## 4. Other evidence in this folder

- `SUMMARY-red.txt`, `SUMMARY-green.txt`, `SUMMARY-green_brownlow.txt`: every STEP, SAMPLE, SIDE, ISR, NAV, CHECK and
  RESULT line, plus the `[revalidate-season]` server log lines.
- `trace-*.log`: the per-request `[trace]` lines (worker, status, url) for awards, brownlow and revalidate requests.
- `screenshots/`:
  - `red-full-load.png`, `green-full-load.png`: the award page with the title banner.
  - `red-admin-published.png`, `green-admin-published.png`, `green_brownlow-admin-published.png`: the admin screen
    after publication.
  - `green_brownlow-full-load.png`.
- `unit-*.log`, `typecheck-cand.log`, `lint-gate-cand.log`, `part1-rc.txt`.
- `README.md` in this folder is the earlier ISSUE-372 inventory and was **not** modified.

Screenshot checks (visual, 1280×800), `green-full-load.png`: the title banner reads "2026 Charles Sutton Medal — Winner and
Full Result | AFLDB", the h1 is "2026 Charles Sutton Medal", and the Winner table shows Marcus Bontempelli / Western Bulldogs.
`green_brownlow-full-load.png`: banner "2026 Brownlow Medal — Winner, Votes & Leaderboard | AFLDB", "146 players polled
votes", with the two "Recorded ineligible" labels. `red-full-load.png` is the same award page as green (same file size,
55,778 bytes).

## 5. Limits

- DEV host, synthetic 2026 data, a disposable database. Not production. **No production contact**, so whether production sets
  `AFLDB_REVALIDATE_URL`/`SECRET` was not checked.
- The conclusion that `/awards/[slug]/[season]` is not ISR comes from the build output, the prerender manifest and the
  response headers of this build. Production uses the same `npm run build`, but the production build was not inspected.
- The `/seasons/2026` stale state on the non-acting worker was observed for about 8 s after publication in `red`, not for
  the full 1 h window. The mechanism is the documented one (an entry the worker did not itself expire).
- An award other than a best-and-fairest, or a Coleman publication, was not exercised.
  - Coleman 2026 already has a stored winner in the rebuild, so it cannot be a 404 season.
  - The award route behaviour does not depend on the award.
- Only one awards season and one Brownlow season were run, and each run once (no repeat for variance).
- The client-navigation step used `router.push` because the cached award index page did not carry a link to the new
  season. That page is `ƒ`, so the cause was not investigated. It is not part of the verdict.
- The harness's first exploratory awards run (Norm Smith Medal, indexing off) is not tabled. It gave the same result for
  the award page (no ISR file, 24/24 200).

## 6. Findings

| ID | Grade | Where | Summary |
|---|---|---|---|
| F-001 | **MED** | `src/app/awards/[slug]/[season]/page.tsx:29`; commit `b40c13ff`; `docs/v2/evidence/issue372-20261121/README.md` §2 | The ISSUE-372 premise for award-season pages is not reproduced. The route is `ƒ` in the production build, so there is no cached 404 and no stale-404 head. `revalidate = 86400` is inert there because the route has no `generateStaticParams` (every ISR dynamic route in the manifest has one). Option B's `/awards/[slug]/[season]` pattern expiry (and the comments, docs, test names and `.env.example` text claiming it prevents a 24 h not-found head) therefore describes a non-existent failure. Escalated to the spawner: the A/B/C decision and the documentation wording should be revisited. The route pattern is harmless (it expires a tag no entry carries) and becomes meaningful only if someone adds `generateStaticParams`. |
| F-002 | INFO | `src/lib/admin/award-season-fanout.ts`, `src/app/admin/awards/revalidate/route.ts` | Positive, demonstrated: the new award fan-out makes a real ISR page, `/seasons/<y>`, refresh on **every** worker after an awards publication. Red left the non-acting worker stale (0/4 correct); green: 8/8 with `MISS` first on both workers. So option B is worth keeping, but for its concrete `/seasons/<y>` and `/brownlow/<y>` effect, not for the award-season pattern. |
| F-003 | INFO | harness | `AFLDB_INDEXING=on` is required at build and run time or every page is `noindex, nofollow` and the not-found `noindex` cannot be used as a discriminator. |

No test failed, the lint ratchet did not rise, and no defect was found in the commit's code.


## § Requalification at cf158d60 (22 November 2026)

**Verdict.** Green. Candidate `cf158d60` ("drop the inert award-season pattern; the award follow-up refreshes its season page on every worker") passes unit, typecheck, lint ratchet and build, and the harness shows the corrected mechanism end to end.

- **`/seasons/2026` (the PRIMARY measurement now).** Before publication both workers served it from cache (12 of 12 `HIT`, 0 showing the new award).
  - First request after publication, per worker: worker 1 `MISS`, worker 2 `MISS`.
  - 8 of 8 first post-publication samples show the new award, then all `HIT`.
  - Compare `red` (`5199eb4f`), where the non-acting worker kept the old page (0 of 4).
- **Fan-out log**: one line per worker, and the `/awards/[slug]/[season]` pattern is gone from it.
- **`/awards/<slug>/<season>`** is 200 with the correct title on both workers (24 of 24).
- **Brownlow (ISSUE-371 flow)**: 24 of 24 correct, no `noindex`, `MISS` first on both workers.
- **404 and strict-parsing checks**: all 404 with the not-found title and `noindex`.

### Setup

- **Source**: `git archive cf158d60` into `/mnt/ssd/afldb-backlog-20261122-q/cand2`. The `package-lock.json` sha256 is equal to `cand` (`984b4422…8e86`), so `node_modules` was a `cp -a` of `cand`'s.
- **Fingerprints** (from the run headers): `revalidate-season/route.ts` `72b48930288c82b4`, `admin/awards/revalidate/route.ts` `e2832acc430ee075`, `award-season-fanout.ts` `70dcccf1b67289b2`.
- **Harness**: the same files and flow as §1 and §3. This pass changed only these harness files:
  - `i372-repro.sh`: the summary `grep` now also keeps `SIDE` lines, which were previously only in the driver log.
  - New `i372-part1-cand2.sh` (unit, typecheck and lint at cand2) and `i372-chain2.sh` (the two runs).
- **Host and ports**: same as §1. App port 3140, isolated PostgreSQL 61530, `AFLDB_INDEXING=on` at build and run time. No production contact. Both ports were free after teardown, and the isolated cluster was stopped.

### Results

| Step | Result |
|---|---|
| `npx vitest run tests/settle-season-revalidation.test.ts tests/v2-coleman-projection.test.ts tests/admin-brownlow-actions.test.ts tests/auth.test.ts` | **rc=0; 4 files, 400/400** (97 + 42 + 38 + 223). Was 399 at `b40c13ff`; `settle-season-revalidation` is 97, up from 96. `unit-cand2.log` |
| `npm run typecheck` | **rc=0** (`typecheck-cand2.log`) |
| `npm run lint:gate` | **rc=0, PASSED**: 338 errors in 43 files = baseline 338 in 43, did not rise (`lint-gate-cand2.log`) |
| `npm run build` (harness, `AFLDB_ENV=production AFLDB_INDEXING=on`) | **rc=0**, BUILD_ID `xPThB6m0onAVp_G1RsAbD`. Route table `ƒ /awards/[slug]/[season]`; `prerender-manifest.json` `dynamicRoutes` unchanged, no awards route (`build-excerpt-green2.txt`) |
| `green2` (awards, `/seasons/2026` side check) | driver rc=0, see table below |
| `green2_brownlow` (ISSUE-371 flow; build reused) | driver rc=0, see §3 table below |

#### `green2`: `/seasons/2026` (real ISR page), per worker

Award: Charles Sutton Medal (`bf-western-bulldogs`) 2026, published through the real `/admin/awards/winners/new` form. The acting worker was 2. Revalidate follow-up `POST /admin/awards/revalidate` answered 200.

| Phase | Worker 1 | Worker 2 |
|---|---|---|
| Before publication (12 samples, 6 each) | 6/6 `HIT`, 0 show the new award | 6/6 `HIT`, 0 show the new award |
| First post-publication request | **`MISS`**, shows the new award | **`MISS`**, shows the new award |
| First post-publication 8 samples (4 each) | 4/4 show the award (`MISS`, then `HIT`) | 4/4 show the award (`MISS`, then `HIT`) |
| 8 more after the raw samples | 4/4 show the award, `HIT` | 4/4 show the award, `HIT` |

- **Totals**: 8/8 and 8/8 show the award.
- **ISR on disk for `seasons/2026`**: `.html` and `.meta` rewritten at 16:44:49Z (`.meta` 664 to 243 bytes). The `.rsc` was rewritten too.
- **Server log**, once per worker:
  ```
  [revalidate-season] /seasons/2026 /brownlow/2026 invalidated on worker 2 (pid 2099932)
  [revalidate-season] /seasons/2026 /brownlow/2026 invalidated on worker 1 (pid 2099931)
  ```
- **Trace**: `POST /admin/awards/revalidate` on worker 2, then `POST /api/internal/revalidate-season` 200 on worker 2 (13 ms) and on worker 1 (22 ms).
- **Revalidated list** the admin route returned: `/awards, /awards/bf-western-bulldogs, /sitemap-index.xml, /awards/bf-western-bulldogs/2026, /seasons/2026, /players/marcus-bontempelli-9073, /clubs/western-bulldogs`. That list is the acting worker's own local `revalidatePath` set and is unchanged. Only the cross-worker fan-out dropped the pattern.

#### `green2`: `/awards/bf-western-bulldogs/2026` (dynamic, never cached)

| Phase | Result |
|---|---|
| Pre (8) | 8 × 404, "Page not found \| AFLDB", `noindex` |
| Post (24 raw, both workers) | **24 × 200**, 24/24 title "2026 Charles Sutton Medal — Winner and Full Result \| AFLDB", 24/24 winner in body, **0 `noindex`**, robots `index, follow`; no `x-nextjs-cache` header, `cache-control: private, no-cache, no-store` |
| Client navigation (2) | 2/2 title and body (`router.push`, as in §5) |
| Screenshot | `screenshots/green2-full-load.png`. Viewed: banner, h1 "2026 Charles Sutton Medal" and the Marcus Bontempelli / Western Bulldogs winner row. |

#### `green2_brownlow`: the ISSUE-371 flow

| Phase | Result |
|---|---|
| Pre (8) | 8 × 404, not-found title, `noindex` |
| Publish | "Season 2026 published: 146 polling players, 1242 votes, 1 medallist." (`POST /admin/brownlow/2026` 200) |
| Post (24 raw) | **24/24** 200, correct title, correct body, **0 `noindex`**; first request per worker **`MISS`** (worker 1 `MISS`,`HIT`,`HIT`; worker 2 `MISS`,`HIT`,`HIT`) |
| Fan-out log | `… invalidated on worker 1`, `… on worker 2` (`POST /api/internal/revalidate-season` 200 on both) |
| Client navigation (2) | 2/2 title and body |
| 404 and strict-parsing | `/brownlow/1897`, `/1923`, `/02026`, `/2026.0`, `/+2026`, `/2026abc`, `/%202026`: **7/7** 404, not-found title, `noindex`; second pass 3/3 404 (`STALE`, as before) |

#### `green2`: 404 and strict-parsing (awards)

`/awards/bf-western-bulldogs/1950`, `/2027`, `/02026`, `/2026.0`, `/+2026`, `/2026abc`, `/%202026` and `/awards/no-such-award/2026`: **8/8** 404, not-found title, `noindex`. Second pass 3/3 404.

### Evidence files added

`SUMMARY-green2.txt`, `SUMMARY-green2_brownlow.txt`, `trace-green2.log`, `trace-green2_brownlow.log`, `build-excerpt-green2.txt`, `unit-cand2.log`, `typecheck-cand2.log`, `lint-gate-cand2.log`, `part1-rc-cand2.txt`, `screenshots/green2-*.png`, `screenshots/green2_brownlow-*.png`, and the harness files named above. The Brownlow votes and names in screenshots are the SYNTHETIC seed.

### Limits (this pass)

- One run each, no repeat for variance. DEV host, synthetic data, disposable database, no production contact (so the production `AFLDB_REVALIDATE_URL`/`SECRET` setting is still unchecked).
- The new fan-out path "season named only by an `/awards/<slug>/<yyyy>` path, with no `/seasons/<yyyy>`" was not exercised end to end: in this flow the admin form's list names both, and the log shows the fan-out firing. That branch is covered by the unit tests only.
- F-001 (the original premise was not reproducible for the award-season page) stands, and `cf158d60` is the code answer to it: the inert pattern is gone and the fan-out is judged on `/seasons/<y>`.
