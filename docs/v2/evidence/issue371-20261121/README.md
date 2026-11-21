# AFLDB-ISSUE-371: DEV reproduction, root cause and fix (21 November 2026)

**Verdict.** Reproduced on DEV, red before the fix and green after it, with the same harness. There was no production contact
and DEV's `afldb.service` was not touched.

## 1. Setup

- **Host.** streamanator, as `arm`, with no sudo.
- **Workspace.** `/mnt/ssd/afldb-i371-20261121`. It is left on the host.
  - `cand/` holds a `git archive` of `40fb1c68` (= `origin/main`) with the fix overlaid.
  - `base/` holds the same tree with the two original source files, for the red unit run.
- **Database.**
  - Own isolated cluster `afldb_v2_isolated` on 127.0.0.1:61480, root `$W/pg`.
  - Template `afldb_v2_i371tpl_test` was restored from the accepted source-only rebuild
    `/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump` (sha256 `d8397aab…f165c63`, 20,662,515 bytes).
    `pg_restore` exited 0.
- **Disposable season.** `i371-seed-2026.sql` produced the seed template `afldb_v2_i371seed_test`. In it, 2026 has no
  `brownlow_season_votes` row, so `/brownlow/2026` is 404, as on production before publication.
  - Every one of the 207 home-and-away matches carries an attached 3/2/1 set: 621 rows, 207 of 207 accounted.
  - **These votes are SYNTHETIC**: the top three disposal-getters in each match. They are not real Brownlow votes, and the
    names in the screenshots are only the players those rows happen to name.
  - One super admin was created with the supported CLI, `tools/admin/create-admin.ts`. Its password and TOTP secret live
    only in `$W/secrets/admin.env` (mode 600) and appear in no evidence file.
- **Serving.** Each run gets a fresh copy of the seed DB and a production build (`npm run build`: `next build --webpack` plus
  `prepare-standalone`). It is served by the production entry point, `node deploy/server-cluster.mjs`.
  - Settings: `AFLDB_WORKERS=2` (as production), `NODE_ENV=production`, `AFLDB_ENV=production`, `AFLDB_TRACE_REQUESTS=on`
    for per-worker headers, private port 127.0.0.1:3120.
  - The server runs in its own process group (setsid, with a pgid check). The harness STOPs rather than kill a held port,
    and teardown signals only its own group.
  - `AFLDB_REVALIDATE_URL`/`SECRET` are set to the private origin unless `NO_FANOUT=1`.
- **Driver.** `i371-driver.mjs`, using this repository's Playwright.
  1. 8 raw requests on new connections (`agent:false`, so both workers are reached), then a 5 s pause.
  2. Log in through `/admin/login` with password and TOTP, then publish through the real `/admin/brownlow/2026` form. Two
     `ineligible` boxes are checked (2 hidden `ineligible` inputs), and the 20+ character note required for sealed season
     2026 is filled in.
  3. 3 × 8 raw samples.
  4. 4 client-side navigations: `/brownlow`, then click the `a[href="/brownlow/2026"]` link.
  5. Full-load screenshots at 1280×800. A banner shows the captured `document.title`.
  6. 404 and strict-parsing checks.
  7. ISR files on disk (`.next/standalone/.next/server/app/brownlow/2026.*`) are read before, immediately after and after the
     samples.

Commands, from `$W`:
```
bash cand/docs/v2/evidence/issue371-20261121/i371-setup.sh deps pg template
bash cand/docs/v2/evidence/issue371-20261121/i371-repro.sh seed
bash cand/docs/v2/evidence/issue371-20261121/i371-repro.sh run <label>      # SKIP_BUILD=1 reuses the build; NO_FANOUT=1
```

## 2. Results

| Run | Source | Build | Post-publication raw samples (24) | Client nav (4) | 404 checks |
|---|---|---|---|---|---|
| `red3` | `40fb1c68` (actions.ts sha256 `5f2466d8…`) | `X8_o0QRgdM13aChXcMPZC` | 8 × 200 with a correct body and title **"Page not found \| AFLDB"** (+ `robots noindex`, site-default description); 16 × 404 | title correct 1/4, body correct 3/4 (one shows the inverse: right title, "Page not found" body) | 9/9 404 + not-found title |
| `green1` | fix (actions.ts `b006716f…`, route.ts `6109ac2a…`) | `b9Zg3tFfLA39lazudlsXS` | **24/24** 200, correct body (146 polled, winner sentence, 6 "Recorded ineligible" labels), correct title and description | **4/4** title + body | 9/9 404 + not-found title |
| `green_nofanout` | fix, fan-out unconfigured | same as `green1` | 12 × 200 correct (acting worker 2), 12 × 404 (worker 1, still holding its own 404) | title 4/4, body 2/4 | — |

The red run reproduces the production symptom exactly. Per worker, in `SUMMARY-red3.txt` / `trace-red3.log`:

1. The 404 entry was written at 09:38:14 by **worker 2**. Its `.meta` holds `status 404`, tags
   `_N_T_/layout,_N_T_/brownlow/layout,_N_T_/brownlow/[year]/layout,_N_T_/brownlow/[year]/page,_N_T_/brownlow/2026`.
2. The publish Server Action ran on **worker 1**: `POST /admin/brownlow/2026` returned 200 with
   "Season 2026 published: 146 polling players, 1242 votes, 1 medallist."
3. The first post-publication request on worker 1 answered **404 with `x-nextjs-cache: STALE`**.
   - It then regenerated in the background.
   - From then on worker 1 answers **200 with the correct body and the not-found head**.
   - The persisted entry was rewritten at 09:38:22: `.meta` status absent (= 200), `2026.html` 179,811 bytes with
     `<title>Page not found | AFLDB</title>`.
4. Worker 2 kept answering its own fresh 404 (`HIT`).
5. The fan-out route ran, but it invalidated only `/seasons/2026`.

## 3. Root cause, with the first point of divergence

**First wrong thing (project code).** `src/app/admin/brownlow/actions.ts:290` at `40fb1c68` calls
`revalidatePath('/brownlow/${season}', 'page')`.

- Next 16.3.1 appends the type to the path: `node_modules/next/dist/server/web/spec-extension/revalidate.js:86-106`. The call
  therefore expires the tag `_N_T_/brownlow/2026/page`.
- A page's implicit tags are its route-file tags plus its pathname (`server/lib/implicit-tags.js:15-41, 56-70`). The entry
  carries `_N_T_/brownlow/[year]/page` and `_N_T_/brownlow/2026`, as seen in the `.meta` above. It never carries
  `/brownlow/2026/page`.
- **So the publication invalidated nothing, on any worker.** The Next guide says the same thing (`revalidatePath.md`): "If
  `path` is a literal path like `/product/1`, omit `type`".
- The same malformed form invalidated nothing at `:119`, `:120`, `:128`, `:129`, `:134`, `:286` and `:288`.

**Where head and body then diverge (framework behaviour, reached only because nothing was expired).**

1. A worker that did not itself write an entry has no cache-control for an on-demand path. It therefore treats the entry as
   stale after **1 s** (`server/lib/incremental-cache/index.js:153-162`).
2. The response cache resolves the stale 404 immediately and regenerates in the background (`server/response-cache/index.js:210-216`).
3. Serving that stale entry sets `res.statusCode = cachedData.status` (404) on the shared response object
   (`build/templates/app-page-runtime.js:1212`).
4. The background render then reads `is404: res.statusCode === 404` (`server/app-render/app-render.js:2089`, and the
   prerender paths `:5065/:5299/:5627/:5812`).
5. It resolves metadata with `errorType: 'not-found'` (`app-render.js:1174-1181`) and adds the error `noindex`
   (`app-render.js:315-320`). Meanwhile the page segment renders normally, because the row now exists.
6. The stored entry is a 200 page with the not-found boundary's `<head>`. It is served until its own window lapses, which
   matches the "roughly hourly" recovery seen in production.

So the head is not cached separately from the body. The not-found metadata is baked into the regenerated ISR entry, and the
RSC payload, by a regeneration that inherited the stale entry's 404 status.

**Why every worker matters.** `revalidatePath` is per-process (see `src/lib/acquisition/season-revalidation.ts` header). The
fixed call expires the tag only on the worker that served the action. `green_nofanout` shows the other worker keeping its 404.
Once that worker's window lapses, it would take the same stale-404 path and persist the wrong head.

## 4. Fix (Next-documented mechanisms only)

1. `src/app/admin/brownlow/actions.ts`: every concrete path drops the type argument (`revalidatePath('/brownlow/2026')`).
   Route patterns (`/players/[slug]`) and static routes (`/brownlow`, `/admin/brownlow`) keep `'page'`.
   - An expired tag makes the entry `isStale === -1`, which Next serves through a **blocking** render on a clean response,
     never through the stale-404 path. `green1` shows `x-nextjs-cache: MISS` on both workers' first post-publication request.
2. `src/app/api/internal/revalidate-season/route.ts`: the existing cross-worker fan-out (AFLDB-ISSUE-134, already called by
   the publish action) now invalidates `/brownlow/<year>` as well as `/seasons/<year>`.
   - The input is still only an integer year, and the reply adds `paths`.
   - Server log: `[revalidate-season] /seasons/2026 /brownlow/2026 invalidated on worker 1` and `… on worker 2`.
3. Tests: `tests/admin-brownlow-actions.test.ts` asserts the concrete-path form and an invariant over every action: a type is
   only ever paired with a pattern or a static route. It also asserts the publish fan-out call.
   `tests/settle-season-revalidation.test.ts` asserts the route's two concrete paths.
4. Docs: `docs/deployment.md` §7c and `.env.example` say what the secret now authorises.

## 5. Verification

- **Focused unit** (`unit-focused-red-green.log`): `tests/admin-brownlow-actions.test.ts` + `tests/settle-season-revalidation.test.ts`.
  - Base `40fb1c68`: 8 failed / 116 passed (124).
  - Fix: 124/124 passed.
- **`npm run typecheck`:** rc=0.
- **eslint** on the 4 changed code/test files: rc=0.
- **`npm run lint:gate`:** rc=0, PASSED. It is a ratchet: 338 errors in 43 files equals the baseline of existing debt.
- **Reproduction:** red3 vs green1 as tabled in §2.
- **ISSUE-357 strict parsing.** These still 404 with "Page not found | AFLDB" on both runs, including a second, cached pass:
  `/brownlow/02026`, `/2026.0`, `/+2026`, `/2026abc`, `/%202026`. So do the genuinely missing seasons `/brownlow/1897` and
  `/brownlow/1923`.

**Visual evidence** (1280×800, `screenshots/`):

| Screenshot | Shows |
|---|---|
| `red3-full-load-1.png` | Correct standings, captured title "Page not found \| AFLDB" |
| `red3-client-nav.png` | The same after a client-side navigation |
| `green1-full-load-0.png` | Correct standings, captured title "2026 Brownlow Medal — Winner, Votes & Leaderboard \| AFLDB" |
| `green1-client-nav.png` | The same after a client-side navigation |

## 6. Limits of this evidence

- DEV is not production. The production state (both workers 200 with the wrong head) needs both workers to take the
  stale-404 path. That happens when neither knows the route's cache-control, for example after the release restart, or after
  the hour has passed. The harness reproduced it on the non-writing worker within seconds.
- Whether production sets `AFLDB_REVALIDATE_URL`/`AFLDB_REVALIDATE_SECRET` was not checked (no production contact). Without
  them, only the acting worker is refreshed (`green_nofanout`).
- No E2E journey was added to `tests/e2e/journeys.spec.ts`. Publishing 2026 there would change the shared journey database
  that the "pending Brownlow" journeys depend on. This harness is the end-to-end evidence.
