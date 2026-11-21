> DOC: Execution plan for the 22 Nov 2026 owner-approved backlog run (372 option B, tracker decisions, prep kits).
> DOC: Tier T3 (multi-module: src/app api + admin routes, tools, docs, trackers). Orchestrator afldb-orchestrator.

# Plan: backlog run 2026-11-22 (owner decisions of 2026-11-22)

Worktree `D:\dev\afldb-backlog-20261121`, branch `claude/backlog-20261121`, tip `5199eb4f` = `origin/main`.
Source of decisions: the main session's brief (owner intent 2026-11-22) and
`docs/v2/evidence/backlog-20261121/OWNER-PACKET.md` (Q1-Q9, R0-R9, §4, §5).
Hard limits: no production contact by any agent; no push; local commits without AI trailers; no `wsl`;
on streamanator never `fuser -k 3100`, never touch `/mnt/ssd/afldb-i371-20261121`, `/mnt/ssd/afldb-i363-20261121`,
`/mnt/ssd/afldb-enh-20261116`, `/mnt/ssd/afldb-post7r3-*`; delete nothing listed in packet §4. Tests/builds run on
streamanator in fresh `/mnt/ssd/afldb-backlog-20261122-*` workspaces (the workstation has no Node).
Shell/Git/DEV execution is owner-authorised for this task.

## Facts established before planning (read-only)

- ISSUE-372 option B (`docs/v2/evidence/issue372-20261121/README.md` §5): "`revalidate-season` also expires
  `/awards/[slug]/[season]` (pattern, every worker; the input stays an integer year). Coleman/awards publication calls
  `revalidateSeason()` after commit as the Brownlow action does." Owner: keep A's 2027 season-opening refresh (an ISSUE-350
  runbook step that posts the fan-out for 2027 after the `seasons` row exists) and add the award-season refresh at
  publication; preserve D-232-3 (the nightly invalidates nothing; its unit unsets `AFLDB_REVALIDATE_SECRET`).
- Awards/Coleman Server Actions never call `revalidatePath` (Next 15.5 client hang, ISSUE-156 R-7). The client posts the
  server-computed paths to `/admin/awards/revalidate` (`src/app/admin/awards/revalidate/route.ts` ->
  `src/lib/admin/revalidate-route.ts` `applyRevalidateRequest`, allowlist `src/app/admin/awards/revalidate-paths.ts`,
  which admits `/awards/<slug>/<yyyy>`). Coleman publication returns `revalidatePaths` for the same route
  (`src/app/admin/operations/coleman/actions.ts:20-21,75,81`).
- Fan-out: `src/lib/acquisition/season-revalidation.ts` `revalidateSeason(config, season)` posts
  `/api/internal/revalidate-season` until every worker ordinal answers; route `seasonRevalidationPaths()` at
  `src/app/api/internal/revalidate-season/route.ts:97,183-184` returns `/seasons/<y>`, `/brownlow/<y>` (ISSUE-371).
- No CLI posts the fan-out today (callers: Brownlow actions, `tools/current-season/settle-afltables.ts`, retired).
- DEV (read-only probe 2026-11-22 02:53 AEDT): checkout `/home/arm/projects/afldb` at `8b024098` on `dev-v2-main`
  (upstream origin/main), 10 porcelain entries, `AFLDB_WORKERS=4`, beta gate on, **no `AFLDB_REVALIDATE_*` in `.env`**,
  timers: AFL API settle 05:01 nightly and an AFL API Brownlow timer every ~5 min.
- `deploy/sync-dev.ps1` deploys only a revision **published on the branch's upstream** (pin must be published). This run
  may not push; therefore a DEV deployment of a new local commit needs the main session to publish it.

## Steps

**S1 (372 code, T2 within `src/app` + `src/lib`).** Smallest change implementing B:
1. `revalidate-season/route.ts`: also expire award-season pages for the year. Preferred design: one typed pattern call
   `revalidatePath('/awards/[slug]/[season]', 'page')` (the README's stated B), kept separate from the untyped concrete
   loop so the ISSUE-371/372 guard still holds; reply `paths` lists it. (Alternative considered: concrete
   `/awards/<slug>/<y>` for every award slug, needs a DB read inside the secret-gated route; rejected as larger.)
2. `/admin/awards/revalidate/route.ts`: after the allowlisted local revalidation, for each distinct year named by a
   revalidated `/awards/<slug>/<yyyy>` path, call the season fan-out best-effort (same never-throw shape as
   `fanOutSeason` in `src/app/admin/brownlow/actions.ts:159-170`). Route handler, not Server Action, so the R-7 hang
   rule holds. Capability check stays the first statement (auth contract test).
3. 2027 opening refresh: a small CLI `tools/maintenance/revalidate-season.ts --season <y>` that reads
   `AFLDB_REVALIDATE_URL`/`SECRET` from the environment/.env (never argv) and calls `revalidateSeason`; exits non-zero
   on an incomplete cluster. Procedure 01 (`run2/ops/procedures/01-season-opening.md`) gains the step after `accept`.
   (If a reviewer judges the CLI unnecessary, the alternative is a documented loopback POST, which would put the secret
   on a command line — not acceptable.)
4. Tests (extend, no new suite unless none fits): `tests/settle-season-revalidation.test.ts` (route paths, typed
   pattern, guard still green), the closest awards-revalidate route test (to locate), a CLI test beside existing
   maintenance tool tests.
5. Docs: `docs/deployment.md` §7c and `.env.example` scope note (the secret now also expires award-season pages).

**S2 (qualification on streamanator).** Fresh workspace `/mnt/ssd/afldb-backlog-20261122-q`, `git archive` of the
commit, `npm ci`, focused unit (red at `5199eb4f` where meaningful, green at the fix), `typecheck`, `lint:gate`,
`npm run build`. Then a 2-worker production-build harness adapted from `docs/v2/evidence/issue371-20261121/`
(own isolated cluster, disposable seed, real admin login + TOTP, real publish form) for an award season:
red at `5199eb4f`, green at the fix, plus the Brownlow 371 path re-run at the fix so 371+372 are qualified together.

**S3 (DEV, owner-authorised).** (a) Deploy `5199eb4f` (published) with `deploy/sync-dev.ps1` pinned
(`-ExpectedRevision`, `-ExpectedBranch dev-v2-main`), after `-Phase assess` READY; the DEV tree's 10 porcelain
entries are assessed by the gate, never discarded. (b) Add `AFLDB_REVALIDATE_URL`/`SECRET` to DEV `.env` only if the
owner's DEV authorisation covers it and the gate's `.env` name policy allows it (else report). (c) Red repro on DEV:
cache `/awards/<slug>/<S>` (and `/brownlow/<S>` if DEV has an unpublished season with attached votes) as 404 on every
worker, publish through the admin UI, sample raw head (`<title>`, robots, standings/body) per worker
(`x-afldb-worker` trace header), no restart. (d) Green: requires the fix commit published by the main session; then
deploy it and repeat on a different 404 season. DEV data writes are DEV-only and recorded.

**S4 (release candidate record).** `docs/v2/evidence/backlog-20261121/RC-371-372.md`: revision, qualification,
DEV evidence, production precondition (`AFLDB_REVALIDATE_URL` and `AFLDB_REVALIDATE_SECRET` in production `.env`,
status supplied by the main session), acceptance probes. Prepare only.

**S5 (trackers, docs only).** issues.md entries for 332, 348, 350, 351, 352, 357, 362, 364 (decisions recorded with
date and verbatim intent), 372 (option B), 363 (no decision recorded); IssuesIndex.md + Open Issues table; blockers.md;
operating record G0b/G0c rows per packet §5; ISSUE-351 ledger pointer (F-02). CHANGELOG only for 372 (behaviour) and
364 resolution.

**S6 (preparation kits, docs only, under `docs/v2/evidence/backlog-20261121/kits/`).** R2 (forced-command line, hourly
streamanator wrapper per procedure 04 §4, install steps, alarm destination left blank), R3 (streamanator destination
0700 dir, daily job ~03:10, first-run verification, F-07 retention-hold disposition), R1 + R6 (F-02, F-06 applied;
proposed weekly slot; reboot prerequisites with status), R4 combined Caddy kit + R5 presentation (log paths,
retention, live-invite check; awaiting the production `ls` and count), R8 attended opening (date blank, window
2027-02-15..03-03, with the S1.3 refresh step). F-09: move `prune-not-found.sh` (31 lines) to `tools/maintenance/`
with a test only if small; else record follow-up.

**S7 (348, may dispatch afldb-worker).** Fresh DraftGuru export per `tools/rebuild/draftguru/README.md:1353-1380`,
classify/extract_pairs, `import_draftguru.py --dry-run --guard-report` against production rows from the main
session's R0 dump restored into an isolated cluster on streamanator (path pending); until then, everything else.
Compare 5961/6784/6626 against the reviewed 2026-11-05 CSV (hash in `SHA256SUMS.owner-csv`). No production write.

**S8 (364).** Verify `lint:gate` in `preflight` and `merge:ready` and `c79d7d06` ancestor of `origin/main`; resolve.

**S9 (363).** Quote Q9 and G-c verbatim from the ISSUE-363 record, explain, recommend; continue decision-independent
verification only.

**S10.** `docs/v2/evidence/backlog-20261121/RUN-20261122.md`; `afldb-closure` verification of the code step; commits
reported with tested revisions.

## Risks to review

- R-a: the typed pattern expires every award-season page on every fan-out (Brownlow finalise/correct/void also fans
  out), causing lazy one-time re-renders; acceptable?
- R-b: fan-out from a route handler posts to the same cluster; recursion/deadlock risk with the worker answering
  `/admin/awards/revalidate` (Brownlow does it from a Server Action today).
- R-c: DEV verification is gated on publication by the main session (no push allowed here).
- R-d: DEV has 4 workers, production 2; DEV lacks the fan-out env.
- R-e: DEV Brownlow publication may be infeasible (no unpublished season with complete votes).
