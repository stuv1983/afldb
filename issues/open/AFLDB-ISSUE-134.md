# AFLDB-ISSUE-134 — Current-season settle should invalidate/revalidate affected public season ISR

**Branch:** `claude/issue-134` (worktree `D:\dev\afldb-issue-134`) — **base `25c976d`**
**Started:** 2026-09-04
**Migration:** none (confirmed — no persistent schema state is required)
**Production:** no production write, purge, rebuild, restart or deployment is authorised by this runbook.

---

## 1. Stage 1 — current-state proof (complete)

Every claim below was re-derived from the code on this branch, not carried over from
`AFLDB-ISSUE-133`.

### 1.1 The route is still ISR, unchanged

`src/app/seasons/[year]/page.tsx:46`

```ts
export const revalidate = 3600;
```

plus `generateStaticParams()` (`:54`) returning every season from `listSeasons()`, with the
comment recording *why* it prerenders (~130 pages; on-demand rendering costs "roughly a second
per request"). So every season, the in-progress one included, is written into the full route
cache at build time and is only re-rendered when its 3600 s window expires.

`generateMetadata()` and the page body read the season through `src/db/queries/seasons.ts`
directly — no `fetch`, no `unstable_cache`, no `cacheTag`. There is therefore **no data-level
tag** on this route: the only cache identity it has is the route path itself.

### 1.2 The settle path still contains no invalidation of any kind

Repository-wide search for `revalidatePath|revalidateTag|unstable_cache` over `src/` and
`tools/` returns **only** `src/app/admin/**/actions.ts` (Server Actions) — nothing under
`src/lib/acquisition/`, nothing under `tools/`, nothing under `deploy/`.

The automatic path is:

- `deploy/afldb-settle-afltables.timer` → `OnCalendar=*-*-* 04:30`, `RandomizedDelaySec=15min`
- `deploy/afldb-settle-afltables.service` → `Type=oneshot`, `User=arm`, one `ExecStart`
- `deploy/afldb-settle-afltables.sh` → `acquire_core.R` → `import_fitzroy_core.py` →
  `tools/current-season/settle-afltables.ts --label … --apply --auto-apply
  --require-complete-source`

There is no `ExecStartPost=`, no post-settle curl, no restart, no rebuild. Confirmed F1.

### 1.3 The in-process precedents

| Caller | Call |
|---|---|
| `src/app/admin/data-editor/actions.ts` (8 sites) | `revalidatePath('/', 'layout')` |
| `src/app/admin/content/actions.ts:84`, `src/app/admin/settings/actions.ts:134` | `revalidatePath('/', 'layout')` |
| `src/app/admin/player-links/actions.ts:30-37` | per-route patterns, **including `revalidatePath('/seasons/[year]', 'page')`** |
| `src/app/admin/current-season/actions.ts:112` | `revalidatePath('/admin/current-season')` only |

`player-links/actions.ts:34` is the closest precedent for the season route and proves the
repository already treats `/seasons/[year]` as an invalidation target — but it fires from a
Server Action inside the web process, which the settle is not.

### 1.4 The deployed cache metadata convention

`ISSUE-133` observed on production that `/seasons/2026`'s prerender carries cache tag
`_N_T_/seasons/2026`. That is Next's *implicit* path tag, and it is reproducible from the
installed framework rather than having to be hardcoded:

- `next/dist/lib/constants.js:283` — `NEXT_CACHE_IMPLICIT_TAG_ID = '_N_T_'`
- `next/dist/server/web/spec-extension/revalidate.js` — `revalidatePath(p)` composes
  `` `${NEXT_CACHE_IMPLICIT_TAG_ID}${removeTrailingSlash(p)}` ``

So `revalidatePath('/seasons/2026')` produces **exactly** the tag ISSUE-133 read off the
deployed `2026.meta`. The private `_N_T_` prefix therefore never has to appear in AFLDB code —
`revalidatePath` is the supported way to name that tag, and `revalidateTag('_N_T_/…')` would be
the same thing spelled with a framework-internal constant. **`revalidatePath` chosen.**

### 1.5 The framework is Next **16.3.1**, not 15

`package.json:32` and `package-lock.json:5497` both pin `next@16.3.1` (upgraded by `5ace3df`,
`AFLDB-ISSUE-107`, deployed to dev 2026-08-29 and to production per `CHANGELOG.md:1166`). The
issue text says "Next.js 15"; that is stale. Everything below was verified against the
16.3.1 tree in `node_modules/`, and against the bundled agent docs
(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`).

`next.config.ts` sets **no** `cacheHandler`, no `cacheComponents`, no `cacheMaxMemorySize`. The
defaults are therefore in force.

### 1.6 THE DECIDING FINDING — invalidation is per-process, and the cluster has 2–4 processes

Three facts, read out of `node_modules/next/dist`:

1. **`tagsManifest` is a module-level `Map` in the worker's own heap.**
   `server/lib/incremental-cache/tags-manifest.external.js:29` — `const tagsManifest = new Map()`.
   `FileSystemCache.revalidateTag()` (`file-system-cache.js:43-72`) writes only into that Map.
   Nothing is written to disk, no IPC, no lock file.

2. **The ISR read consults that Map, and an in-memory LRU in front of the file cache.**
   `file-system-cache.js:78` reads `FileSystemCache.memoryCache` (a per-process static LRU,
   `memory-cache.external.js`, default `cacheMaxMemorySize: 50 MB`,
   `server/config-shared.js:102`) *before* touching the disk, and `:222` decides staleness for
   an `APP_PAGE` entry with `areTagsExpired(cacheTags, data.lastModified)` — i.e. against that
   same in-process Map.

3. **The `x-next-revalidated-tags` header path does not cover pages.**
   `NEXT_CACHE_REVALIDATED_TAGS_HEADER` (`lib/constants.js:276`) feeds
   `IncrementalCache.revalidatedTags`, which `file-system-cache.js` consults **only** in the
   `CachedRouteKind.FETCH` branch (`:240`). The `APP_PAGE` branch at `:222` never looks at it.
   So there is no supported header by which one process can tell another that a *page* was
   invalidated.

The deployment runs `deploy/server-cluster.mjs`: `node:cluster` with `AFLDB_WORKERS` workers
(**dev 4, production 2** — `deploy/afldb.service` documents both), each importing
`.next/standalone/server.js` in **its own process**, round-robin behind one shared socket.

**Consequence:** a single loopback HTTP call to a revalidation route lands on exactly one
worker and invalidates exactly that worker's cache. The other 1–3 workers keep serving their own
in-memory/on-disk copy until their own 3600 s window expires. Equally, deleting the on-disk
`.next` cache files would not help, because `memoryCache` is read first. **Any single-request
design is wrong here**, and this is the property ISSUE-134 explicitly asked to be proved rather
than assumed.

### 1.7 Candidate mechanisms, evaluated

| Candidate | Verdict |
|---|---|
| Call `revalidatePath()` from the settle CLI | **Impossible.** `revalidate()` (`revalidate.js`) throws `Invariant: static generation store missing` without `workAsyncStorage`; the settle is a separate `tsx` process with no Next runtime at all. |
| `revalidateTag('_N_T_/seasons/<y>')` | Same reachability problem, and spells a framework-internal constant by hand. `revalidatePath` composes the identical tag (§1.4). Rejected in favour of `revalidatePath`. |
| `updateTag(...)` | Refused by the framework outside a Server Action (`revalidate.js`, error `E872`). Not available to a Route Handler. |
| `x-next-revalidated-tags` request header | Does not apply to `APP_PAGE` entries (§1.6.3). |
| Delete `.next` ISR cache files directly | Not a documented interface, and **provably insufficient**: the per-process `memoryCache` is read before disk (§1.6.2). Also blocked by the settle unit's `ProtectSystem=strict` / `ReadWritePaths=` (`.next` is not writable to that unit). Rejected. |
| Custom `cacheHandler` with shared storage | Would work, but replaces the whole ISR storage layer of a live site to fix a one-route staleness window. Far wider than the issue. Rejected as disproportionate. |
| `ExecStartPost=` rebuild / restart of `afldb.service` | A full `next build` per night (≈130 season prerenders + every other route) to publish one season's rows, and a restart drops every worker's warm cache. Explicitly excluded by the issue's scope constraints. Rejected. |
| **Authenticated loopback Route Handler calling `revalidatePath`, invoked once per worker** | **Chosen.** See §2. |

---

## 2. Chosen architecture

> After the settle transaction commits, and only if it actually changed canonical rows, the
> settle CLI POSTs `{ season }` to an authenticated loopback route on the running site, and
> **keeps posting on fresh TCP connections until every cluster worker has answered**, each
> worker calling `revalidatePath('/seasons/<year>')` in its own process. Coverage is verified
> from the worker identity the cluster already assigns; anything less than full coverage is a
> reported failure.

### 2.1 Why it satisfies each required property

| Required property | How |
|---|---|
| Only after a successful canonical commit | The call site is in `runSettleCli()` **after** `runSettleAfltables()` has returned, which is after its transaction committed, and is guarded on `result.applied === true`. A dry run and a throw both return/propagate before it. |
| Targets only affected season output | One path, `/seasons/<bundle.season>`, taken from the validated bundle. The bundle carries exactly one season (`in_season.single_season`). |
| No-op on identical 0/0 reruns | Guarded on `canonicalRowsInserted + canonicalRowsUpdated + canonicalApplicationsLogged > 0`. The idempotent rerun scores 0/0/0 and no request is made. |
| Never before commit | `--dry-run` rolls back and never reaches the call; the guard is on `applied`. |
| Ingestion does not depend on the request | The settle transaction is already committed and closed when the request is made. A failure logs and sets a non-zero **exit code only**, exactly as `--require-complete-source` does (`AFLDB-ISSUE-128`); no data is rolled back, nothing is retried into the database. |
| Fails observably | Post-commit `process.exitCode = 1` → red `afldb-settle-afltables.service` → visible in `systemctl status`, the journal, and the Super Admin settle panel. Plus explicit log lines naming the attempts and the workers reached. |
| Nightly reliability preserved | Unconfigured hosts are inert (no env → no attempt → no failure). The timer, cadence and chain are untouched. |
| Works with the multi-worker deployment | The coverage loop is the whole point (§1.6). |
| No full rebuild | None. |

### 2.2 Components

1. **`src/lib/acquisition/season-revalidation.ts`** *(new)* — the whole boundary, pure and
   injectable: config parsing (including a loopback-only check on the configured URL), the
   post-settle decision predicate, the worker-coverage loop, the typed outcome and its
   rendering. No Next import, so the settle CLI does not pull the framework in.
2. **`src/app/api/internal/revalidate-season/route.ts`** *(new)* — `POST`; 503 when
   unconfigured, timing-safe shared-secret check, loopback-only, a failure-only rate limiter,
   an integer `season` and nothing else, then `revalidatePath(seasonPath(season))`. Replies with
   the worker identity so the caller can prove coverage.
3. **`src/middleware.ts`** — the route joins `/api/admin/email-intake` in `PUBLIC_PREFIXES`
   (machine-to-machine, gated by its own secret, not a session).
4. **`deploy/server-cluster.mjs`** — export `AFLDB_WORKER_COUNT` beside the existing
   `AFLDB_WORKER_ID` at fork time, so the route can state the true worker count rather than the
   caller having to re-derive the `min(4, availableParallelism())` default.
5. **`tools/current-season/settle-afltables.ts`** — call the boundary after the applied run;
   render the outcome; set the post-commit exit code on failure.
6. **`docs/deployment.md`** — the "Cache invalidation" paragraph and the environment table.

### 2.3 Security

- Inert unless **both** `AFLDB_REVALIDATE_URL` and `AFLDB_REVALIDATE_SECRET` are set — the
  `AFLDB_SETTLE_TRIGGER` fail-closed convention. Neither is a tracked file's contents.
- The route returns **503** when `AFLDB_REVALIDATE_SECRET` is unset, so an unprovisioned host
  exposes nothing.
- Secret compared with `timingSafeEqual` on equal-length buffers (the `email-intake` helper's
  shape).
- **Loopback only, both ends.** The client refuses a configured URL whose host is not
  `127.0.0.1`/`::1`/`localhost`, so a mistyped `.env` cannot post the secret to a public host.
  The route refuses any request carrying `x-forwarded-for` / `x-forwarded-host`, which Caddy
  always adds (`deploy/Caddyfile.production` proxies to `127.0.0.1:3100`), so a request that
  arrived through the public proxy is rejected before the secret is even compared.
- **No user-controlled path or tag.** The body carries a single integer `season`; the handler
  builds the path itself with `seasonPath()` after bounds-checking the integer. There is no
  input by which any other path, pattern, layout or tag can be reached.
- Failure-only rate limiter on the secret check (`email-intake`'s `AUTH_FAILURES` shape).

### 2.4 Deliberate exclusions

- **Match and club pages are not invalidated.** ISSUE-134 §Scope puts "the ISR window of other
  routes" out of scope. A settle that inserts a *new* match creates a path that was never
  prerendered, so it is rendered on demand and is not stale; a settle that *updates* one leaves
  `/matches/<id>` stale for up to its own window. That is the same class of limitation, one
  route wider, and belongs to a separate decision rather than being smuggled in here.
- **No warming request.** Marking the tag is enough: the next visit on each worker misses and
  blocks on a fresh render. Warming would land on one arbitrary worker and prove nothing.

---

## 3. Implementation (complete)

### 3.1 Files changed

| File | Change |
|---|---|
| `src/lib/acquisition/season-revalidation.ts` | **new** — config (loopback-only, both-or-neither), `shouldRevalidateSeason()`, the worker-coverage loop, the `node:http` transport with `agent: false`, and the operator rendering. No Next import. |
| `src/app/api/internal/revalidate-season/route.ts` | **new** — `POST`; 503 unconfigured → 404 if proxied → 429 if the failure limiter has tripped → 401 on a bad secret → 400 on anything but an integer season → `revalidatePath(seasonPath(season))`; replies `{ok, path, workerId, workerCount}`. |
| `src/middleware.ts` | `/api/internal/revalidate-season` added to `PUBLIC_PREFIXES`, beside `/api/admin/email-intake`. |
| `deploy/server-cluster.mjs` | `AFLDB_WORKER_COUNT` exported at fork time beside `AFLDB_WORKER_ID`. |
| `deploy/afldb-settle-afltables.service` | comment only — records that `AFLDB_REVALIDATE_SECRET`/`_URL` deliberately survive `UnsetEnvironment=`, and what that secret can and cannot do. |
| `tools/current-season/settle-afltables.ts` | `SettleCliDeps.env` / `.revalidate` injection points; `maybeRevalidate()`; `SettleCliOutcome.revalidation`; the post-commit exit code in `main()`. |
| `.env.example` | new section for the two names. |
| `docs/deployment.md` | §7c (new), the "Cache invalidation" paragraph, two environment-table rows. |
| `tests/settle-season-revalidation.test.ts` | **new** — the DB-free contract. |
| `tests/integration/settle-afltables.test.ts` | §S6 `cli()` injects the boundary; three assertions added (applied+changed → published; dry run → nothing; idempotent rerun → nothing). |

**No migration. No schema change. No timer or cadence change. No change to canonical
ingestion semantics, to `revalidate = 3600`, or to any other route.**

### 3.2 The exact ordering, as implemented

```
runSettleAfltables(...)          transaction OPENS, writes, COMMITS, returns
  ↓  (a throw here propagates; nothing below runs)
counters / completeness / report rendered
  ↓
shouldRevalidateSeason(result)   applied && inserted+updated+ledger > 0
  ↓  false → outcome.revalidation = null, exit 0
readRevalidateConfig(env)        null (unconfigured) → outcome.revalidation = null, exit 0
  ↓                              throws (half/mis-configured) → caught → !ok
revalidateSeason(config, season) posts until every worker ordinal answers
  ↓
main(): outcome.revalidation && !ok → process.exitCode = 1
```

### 3.3 Deviations from the brief

- **The framework is Next 16.3.1, not 15** (§1.5). The brief's candidate list was written for
  15; every candidate was re-evaluated against 16.3.1's actual source, and the finding that
  decided the design (§1.6) is a 16.3.1 finding.
- **`revalidateTag('_N_T_/seasons/<y>')` is not used**, although the brief lists it and
  ISSUE-133 observed that tag. `revalidatePath('/seasons/<y>')` composes the identical tag
  through a public API instead of hardcoding a framework-private prefix (§1.4).
- **One new test file** rather than extending an existing suite, for the reason
  `tests/admin-current-season-settle.test.ts` gives for its own existence (whole-file
  `vi.mock`). The after-commit proof was added to the existing integration suite, which is
  where the real transaction boundary is.

## 4. Tests

### 4.1 `tests/settle-season-revalidation.test.ts` (DB-free)

| Required by the brief | Covered by |
|---|---|
| Successful settle with canonical mutations triggers invalidation after commit | "invalidates the bundle's own season after an applied run that changed data"; integration §S6 (real commit) |
| Identical 0/0 rerun does not | "makes no request at all on an identical 0/0 rerun"; integration §S6 (real rerun) |
| Failed / rolled-back settle does not | "makes no request on a dry run…", "makes no request when the settle transaction itself failed"; integration §S6 dry run |
| The correct season is targeted | `seasons` recorded from the injected boundary equals `[2026]`; route asserts `revalidatePath('/seasons/2026')` |
| Arbitrary path/tag injection impossible | "admits no arbitrary path, pattern or tag" — 15 hostile bodies, all 400, `revalidatePath` never called |
| Existing settle behaviour and counters unchanged | "leaves the existing counters and outcome shape untouched" |
| Existing season page behaviour intact | "still declares the ISR window and prerenders every season" |
| Multi-worker correctness | 4-worker and 2-worker coverage, a disturbed rotation, a single-process server, and a wedged worker that **fails** rather than reporting success |
| Fails observably, never throws | HTTP refusal, socket refusal, unbounded error message |
| Security | 503 unconfigured, 401 wrong/empty secret, 404 when proxied, proxy check **before** the secret, failure-only rate limiting, 429 |

### 4.2 Commands

```bash
npx vitest run tests/settle-season-revalidation.test.ts
npx vitest run tests/current-season-import.test.ts tests/admin-current-season-settle.test.ts
npx tsc --noEmit
npx eslint src/lib/acquisition/season-revalidation.ts src/app/api/internal/revalidate-season/route.ts src/middleware.ts tools/current-season/settle-afltables.ts tests/settle-season-revalidation.test.ts
# needs afldb_test (AFLDB_TEST_DATABASE_URL); the real after-commit proof
npx vitest run tests/integration/settle-afltables.test.ts
```

## 5. Validation (2026-09-04, workstation)

### 5.1 Stage fix — one test-only TypeScript correction

`npx tsc --noEmit` had exactly one failure, in the new test file and nowhere else:

```
tests/settle-season-revalidation.test.ts(626,...)
  { 'x-forwarded-for': string; 'x-forwarded-host'?: undefined }
| { 'x-forwarded-host': string; 'x-forwarded-for'?: undefined }
  is not assignable to Record<string, string>
```

TypeScript widens two object literals with disjoint keys into a union of mutually-optional
shapes, which the `post(body, headers: Record<string, string>)` helper will not take. Fixed by
annotating the case list — `const proxied: Record<string, string>[] = [...]` — and nothing else.
**No production code was changed to satisfy the compiler.**

### 5.2 Gates

| Gate | Result |
|---|---|
| `npx vitest run tests/settle-season-revalidation.test.ts` | **49 passed / 49** |
| `npx vitest run tests/current-season-import.test.ts tests/admin-current-season-settle.test.ts` | **287 passed / 287** |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` (7 touched files, `deploy/server-cluster.mjs` and the integration suite included) | **clean** |
| `npx vitest run tests/integration/settle-afltables.test.ts` | **64 passed / 1 skipped**, 240.85 s — see §5.4 |

`npm ci` completed with 0 vulnerabilities; the worktree now has its own `node_modules` (no
junction).

Note on the count: an earlier PowerShell run reported 283 passed / 4 skipped for the same two
files. The four are `it.skipIf(!haveSh)` cases in `tests/current-season-import.test.ts:4348-4382`
which need `/bin/sh` on PATH. Run from Git Bash they execute and pass, hence 287/287 — strictly
more coverage, not a changed expectation.

### 5.3 Two hardening changes made during this stage

Both came out of scrutinising the coverage contract (§6), not out of the compiler.

1. `revalidateSeason()` now keeps the **largest** worker count any reply reported, not the
   latest. Workers can only disagree if the service restarted with a different `AFLDB_WORKERS`
   part-way through the loop, and believing the smaller number would let a partly-covered
   cluster report success.
2. The request is built by an exported `buildRevalidateRequest()`, so `agent: false` and
   `Connection: close` are **asserted by a test** rather than only argued for in a comment.

### 5.4 The integration gate — blocked, then RESOLVED (2026-09-04)

**The blocker, as it stood.** `tests/integration/settle-afltables.test.ts` needs
`AFLDB_TEST_DATABASE_URL`, and `afldb_test` lives on `streamanator`; the workstation has no
local PostgreSQL server. Nothing was listening on 127.0.0.1:5432 or :55432, so the SSH
local-forward was not up, and the session's auto-mode classifier refused to open one
(`ssh -N -L 55432:127.0.0.1:5432 streamanator` — "Blocked by classifier"). Read-only
`ssh <command>` calls to the same host were permitted, so the refusal was specific to the
tunnel.

**Resolved.** The tunnel was opened and the gate ran against `afldb_test` through the
workstation SSH local-forward on **127.0.0.1:55432**.

| Fact | Value |
|---|---|
| Suite | `tests/integration/settle-afltables.test.ts` |
| Result | **64 passed / 1 skipped**, 0 failed |
| Duration | **240.85 s** |
| Target | `afldb_test` on `streamanator`, reached over the workstation SSH tunnel at `127.0.0.1:55432` |

**The one skipped case is pre-existing and is not an ISSUE-134 failure.** It is the restricted
importer-role validation, which is `skipIf`-gated on `AFLDB_TEST_IMPORT_DATABASE_URL`; that
variable is not set in this environment. It skips identically on `main` and has nothing to do
with this change.

With this, **every repository gate is green** — including the only place the after-commit
ordering is proved against a real transaction (§4.1): the three §S6 assertions in §6's last
row are now executed, not pending.

## 6. The worker-coverage contract, and where each claim is enforced

| Claim | Enforced by | Proved by |
|---|---|---|
| Each worker has a **server-assigned** ordinal | `deploy/server-cluster.mjs` — the primary calls `fork(ordinal)` with `AFLDB_WORKER_ID: String(ordinal)` for ordinals 1..N, and the `exit` handler re-forks with `ordinal ?? ordinals.size + 1` so a replacement inherits the dead worker's ordinal instead of drifting upwards | "is told the cluster size by the supervisor…" asserts all three source facts |
| The route returns that ordinal **from server state, not request input** | `route.ts` `workerIdentity()` reads `process.env.AFLDB_WORKER_ID` / `AFLDB_WORKER_COUNT` and nothing else; no header or body field reaches it | "takes the worker identity from process state, never from the request" — a request asserting `workerId: '99'` in both body and headers is answered with the process's own `'2'` of `4` |
| A nonsensical count is not propagated | `Number.isSafeInteger(declared) && declared > 0`, else 1 | "refuses to believe a nonsensical worker count" — `0`, `-3`, `four`, `2.5`, `''` all answer 1 |
| **Duplicate answers cannot satisfy coverage** | `if (!workersReached.includes(id)) workersReached.push(id)` — distinct ordinals only | "counts DISTINCT ordinals: repeats never accumulate towards coverage" — 24 answers all from worker `2` of a 3-worker cluster → `ok: false` |
| Success requires **every** ordinal, as defined by `AFLDB_WORKER_COUNT` | `ok = workerCount > 0 ? workersReached.length >= workerCount : workersReached.length > 0`; ordinals are 1..N and the count is N, so N distinct ordinals is total coverage | "is not satisfied by 3 of 4 workers"; "FAILS rather than reporting success when a worker never answers" (1 of 2 → `ok: false`, bounded at 16 attempts) |
| A mid-loop restart cannot shrink the requirement | the largest reported count wins (§5.3) | "takes the LARGEST cluster size reported…" — a reply claiming 4 followed by replies claiming 2 keeps `workerCount: 4` and `ok: false` |
| **Fresh TCP connections** stop one keep-alive socket pinning every request to one worker | `buildRevalidateRequest()` sets `agent: false` and `Connection: close`; `node:cluster` round-robins CONNECTIONS, so a pooled socket returns to the same worker for ever | "opens a FRESH connection per attempt…" asserts `options.agent === false`, `headers.connection === 'close'`, the fixed route path and origin, and the `{season}`-only body |
| Short coverage **fails observably** | `ok:false` → `renderRevalidateOutcome` emits `ISR INVALIDATION FAILED …` → `main()` sets `process.exitCode = 1` → red `afldb-settle-afltables.service` | "fails observably when the route refuses/when the socket does"; "reports a failed invalidation without disturbing the committed run"; and the source-level gate test "decides the exit code AFTER the run returns…", which mirrors the AFLDB-ISSUE-128 test at `tests/current-season-import.test.ts:4195` |
| The boundary is reached only **after** the commit | `maybeRevalidate()` is called after `runSettleAfltables()` returns and is guarded on `shouldRevalidateSeason(result)` | "reaches the boundary only after runSettleAfltables has returned" (source ordering); plus the three integration §S6 assertions, **now executed against a real committed transaction on `afldb_test`** (§5.4) |

**Conclusion: the contract is enforced by the code and now asserted by tests.** Two gaps found
while scrutinising it were closed rather than documented away (§5.3).

**What the repository still cannot prove, and why DEV acceptance exists.** Every row above is
asserted against an *injected* boundary or a single process. Nothing in the repository runs a
real 4-worker cluster, so the one claim no test can close is that N fresh loopback connections
actually reach N distinct workers through `node:cluster`'s connection round-robin. That is the
irreplaceable host proof, and it is the centre of §9.3.

## 7. DEV preflight — read-only, `streamanator`, 2026-09-04

Executed over `ssh streamanator` with read-only commands. **No host mutation.**

| Fact | Value |
|---|---|
| Hostname | `streamanator` |
| Checkout | `/home/arm/projects/afldb`, branch **`main`**, `169d738` ("Merge ISSUE-113 tracked Brownlow season artefact") |
| Working tree | untracked backups only (`.deploy-backups/`, `.env.bak-*`, `FETCH_HEAD`) |
| Build | `.next/BUILD_ID` = `S6wER-7aEXc_B3EID7XMX` |
| `afldb.service` | `active (running)`, MainPID 856072, started Fri 2026-09-04 14:22:37 AEST |
| Listener | `127.0.0.1:3100`, held by the primary (pid 856072) — loopback only, Caddy in front |
| Workers | **4** — `ps --ppid 856072` shows exactly four `next-server (v16.3.1)` children |
| `AFLDB_WORKERS` in `.env` | **ABSENT** (`grep -c` = 0). 24 cores, so `server-cluster.mjs` takes its `Math.min(4, availableParallelism())` default |
| `AFLDB_POOL_MAX` | 10 |
| `PORT` | 3100 |
| `AFLDB_SETTLE_TRIGGER` | `systemd` (the ISSUE-127 on-demand trigger is installed) |
| `afldb-settle-afltables.service` | `inactive`, last `Result=success`, `ExecMainStatus=0` |
| `afldb-settle-afltables.timer` | **`not-found`** — never installed on dev, as recorded at the ISSUE-127 closeout. This issue does not install it |
| `AFLDB_REVALIDATE_URL` | **absent** (`grep -c` = 0) |
| `AFLDB_REVALIDATE_SECRET` | **absent** (`grep -c` = 0) |
| Remote | `origin` → `git@github.com-afldb-deploy:stuv1983/afldb.git` |

### 7.1 The preflight validated a design decision

`AFLDB_WORKERS` is **not set on dev**, yet dev runs four workers. A worker process therefore
cannot recover the cluster size from the environment, and `availableParallelism()` inside a
worker would report **24**, not 4. This is the real-host confirmation that
`AFLDB_WORKER_COUNT`, exported by the primary at fork time, was necessary rather than
convenient — without it the coverage loop would have demanded 24 ordinals from a 4-worker
cluster and failed every night.

(Incidental, not acted on: the comment block in `deploy/afldb.service` states that development
sets `AFLDB_WORKERS=4` in its `.env`. It does not. The effective worker count is 4 either way,
so the comment is misleading rather than wrong in effect. Out of scope here.)

## 8. Stage record

| Stage | State |
|---|---|
| 1. Current-state proof | **Complete** — §1 |
| 2. Architecture chosen | **Complete** — §2 |
| 3. Implementation | **Complete** — §3 |
| 4. Repository gates | **ALL GREEN** — unit 49/49, focused 287/287, `tsc` clean, ESLint clean, integration 64 passed / 1 pre-existing skip in 240.85 s — §5.2, §5.4 |
| 5. Coverage-contract scrutiny | **Complete** — §6; two hardening changes made (§5.3) |
| 6. DEV preflight (read-only) | **Complete** — §7 |
| 7. DEV acceptance | **IN PROGRESS** — operator approved §9; implementation checkpoint committed and pushed on `claude/issue-134` |
| 8. Close-out | pending |

**Exact next action:** execute the §9 DEV acceptance on `streamanator` — deploy the pushed
`claude/issue-134` commit, prove the route fails closed, prove real four-worker coverage, prove
`/seasons/2026` regenerates, then restore dev to `main`. **PROD is not touched.**

## 9. DEV acceptance plan — proposed, NOT executed

**Dev currently serves `main` at `169d738`.** Every step below moves it onto
`claude/issue-134` and back. Nothing here runs until the operator agrees, and **no production
step exists**.

### 9.1 Prerequisites

- §5.4 integration gate green.
- The branch committed and pushed to `origin` (it is currently local-only).
- Operator confirms nobody is mid-test on dev's current build.

### 9.2 Deploy (dev only)

    ssh streamanator
    cd ~/projects/afldb
    git fetch origin
    git checkout claude/issue-134
    npm ci

    # The two new names. Generate the secret ON THE HOST; it is never committed.
    printf 'AFLDB_REVALIDATE_URL=http://127.0.0.1:3100\n' >> .env
    printf 'AFLDB_REVALIDATE_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env

    npm run build
    sudo systemctl restart afldb          # dev sudo needs a password

### 9.3 Acceptance — the multi-worker property, on the real cluster

    # A. Four workers, as the preflight measured.
    ps --ppid "$(systemctl show afldb --property=MainPID --value)" -o pid,cmd --no-headers

    # B. Warm /seasons/2026 on every worker, and record the on-disk entry.
    for i in 1 2 3 4 5 6 7 8; do curl -s -o /dev/null http://127.0.0.1:3100/seasons/2026; done
    ls -l --time-style=full-iso .next/standalone/.next/server/app/seasons/2026.html

    # C. THE PROOF. Four posts must be answered by four DISTINCT workerIds.
    S=$(grep '^AFLDB_REVALIDATE_SECRET=' .env | cut -d= -f2-)
    for i in 1 2 3 4; do
      curl -s -X POST http://127.0.0.1:3100/api/internal/revalidate-season \
        -H "x-afldb-revalidate-secret: $S" -H 'content-type: application/json' \
        -d '{"season":2026}'; echo
    done
    # Expect: {"ok":true,"path":"/seasons/2026","workerId":"1".."4","workerCount":4}

    # D. Regeneration, well inside the hour.
    curl -s -o /dev/null http://127.0.0.1:3100/seasons/2026
    ls -l --time-style=full-iso .next/standalone/.next/server/app/seasons/2026.html   # mtime moved

    # E. The gates hold on the real host.
    #    no secret -> 401 ; proxied -> 404 ; non-integer season -> 400
    #    and from OUTSIDE through Caddy (http://10.0.40.100/...) -> must not be usable

### 9.4 Acceptance — the settle end to end

The **on-demand trigger** is used, not the timer (dev has no timer, and this issue does not
install one). `AFLDB_SETTLE_TRIGGER=systemd` is already set, so the Super Admin control works,
or the unit can be started directly:

    sudo -u arm /usr/bin/systemctl start --no-block afldb-settle-afltables.service
    journalctl -u afldb-settle-afltables -n 60 --no-pager
    # Expect either "Season 2026 published: /seasons/2026 invalidated on 4/4 worker(s)"
    # or, on a 0/0 rerun, NO revalidation line at all.
    systemctl show afldb-settle-afltables.service --property=Result --property=ExecMainStatus

Run it **twice**: the first run publishes only if it actually changed canonical rows; the
second, over the same source, must make no request and must still exit 0.

### 9.5 Restore

    git checkout main && npm ci && npm run build && sudo systemctl restart afldb

The two `.env` lines may stay (they are the intended dev configuration) or be removed; with the
branch reverted the route no longer exists and they are inert either way.

### 9.6 Known risks to record when it runs

- Dev sudo needs a password (ISSUE-127).
- A full `npm run build` is required — the route is new.
- Moving dev off `main` interrupts anyone testing the current build.
- Step C is the one irreplaceable observation: it is the only place the per-process invalidation
  finding (§1.6) is confirmed against a real 4-worker cluster rather than a simulated one.
