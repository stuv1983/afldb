# AFLDB-ISSUE-107 — Next.js 16 framework/runtime upgrade

- **Status:** Open
- **Severity:** Medium
- **Area:** Framework / Runtime / Deployment
- **Found:** 2026-08-29
- **Implementation owner:** `AFLDB-ISSUE-107`
- **Post-deployment hydration acceptance owner:** `AFLDB-ISSUE-068`
- **Candidate:** Next.js 15.5.23 → 16.3.1

## Objective

Implement and deploy the exact framework/runtime upgrade class proven by the ISSUE-068
matched A/B, while preserving application semantics and changing only one major runtime axis
at a time. This issue owns the upgrade through a validated Linux development deployment.
ISSUE-068 owns the final deployed 1,440-row hydration acceptance and remains open until that
acceptance passes.

## Evidence and causal boundary

Two independent 1,440-load passes on Next 15.5.23 produced 73 and 62 hydration/client errors.
Two matched passes on Next 16.3.1 produced zero and zero. All four runs had identical semantic
results (1,238 / 202 / 0), no HTTP or page errors, no violations, and no metamorphic
disagreements. Per-load `x-afldb-build` evidence bound every response to the intended build.

This proves the owning layer is the Next 15.5.23 framework dependency closure/runtime/client/
serving path. It does not prove a particular internal function, upstream commit, or the
`next` package in isolation. Next 16 also changes the segment-cache/prefetch serving format,
so the implementation and validation must treat the serving path as part of the candidate.

## Bounded scope

The first controlled upgrade must:

- move Next.js from 15.5.23 to exactly 16.3.1 and regenerate the associated lockfile closure;
- align directly coupled Next.js tooling packages where the dependency contract requires it;
- retain React and ReactDOM at resolved version 19.2.8 unless an actual dependency constraint
  makes that impossible;
- run on Node.js 20.9 or newer (the repository's documented Node.js 22 remains suitable);
- keep Webpack for the first upgrade by building with `next build --webpack`;
- preserve the existing standalone packaging and clustered serving topology;
- handle Next 16's framework-managed TypeScript configuration and generated `next-env.d.ts`
  state deliberately and reproducibly;
- preserve application, data, authentication, authorization, security-header, routing and
  natural-language search semantics; and
- deploy to development first, with no production rollout until every development gate below
  passes.

This issue does not own unrelated dependency refreshes, UI redesign, parser/compiler changes,
authentication stderr cleanup, database changes, worker reductions, or a switch to Turbopack.

## Implementation runbook

### Phase 0 — Freeze the control

1. Start from the then-current development source, not an old ISSUE-068 worktree or copied A/B
   source tree.
2. Record the current Node version, resolved Next/React/ReactDOM versions, build command,
   standalone layout, route smoke results, and the development `AFLDB_WORKERS` /
   `AFLDB_POOL_MAX` controls.
3. Confirm Node is at least 20.9 before changing dependencies.
4. Establish the current DB-free typecheck/unit baseline and the guarded integration baseline.
   Any pre-existing failure must be recorded before it can be distinguished from upgrade
   fallout.

### Phase 1 — Upgrade one framework axis

1. Change the direct Next.js dependency to exactly 16.3.1 and update the package lock using the
   repository's normal package-manager workflow.
2. Update directly coupled Next.js tooling only where required for a coherent Next 16 closure.
   Do not bundle unrelated package upgrades into the same change.
3. Keep React and ReactDOM resolved to 19.2.8. If the package manager reports a genuine
   incompatibility requiring either to change, stop and adjudicate that expanded experiment
   before proceeding.
4. Change the controlled production build command to `next build --webpack`, retaining the
   existing `tools/build/prepare-standalone.mjs` step.
5. Do not enable Turbopack or change framework and bundler simultaneously.

### Phase 2 — Reconcile framework controls

1. Run the supported Next 16 type-generation/build path and inspect every framework-proposed
   `tsconfig.json` and generated `next-env.d.ts` effect.
2. Keep required Next plugins, generated-type include paths and framework declarations. Do not
   hand-edit generated declarations or blindly restore the Next 15 shape.
3. Ensure a clean install followed by type generation/build reproduces the required generated
   state. Document which files are framework-managed and which configuration is maintained by
   AFLDB.
4. Review Next 16 segment-cache/prefetch behaviour on AFLDB routes. Preserve intentional
   application prefetch choices, but do not force the old serving format merely to mimic
   Next 15.

### Phase 3 — Local and test validation

Run in this order so failures remain attributable:

1. dependency/lockfile integrity and clean install;
2. typecheck;
3. unit tests;
4. DB-free integration tests;
5. guarded database integration tests against a database whose name ends in `_test` only;
6. lint, if it is part of the current project gate;
7. `next build --webpack` plus standalone preparation; and
8. focused route/E2E regression checks across public pages, `/search`, authentication/beta
   boundaries, admin route protection, route handlers, Server Actions/navigation, static
   assets and standalone startup.

The route/E2E checks must look for console, page, RSC and hydration errors as well as visible
semantics. They are upgrade regression coverage, not ISSUE-068's final 1,440-row acceptance.

### Phase 4 — Development deployment

1. Deploy only to the real Linux development runtime using the normal standalone/systemd
   path.
2. Build with Webpack and perform a legitimate service restart. Do not bypass systemd.
3. Prove the built `.next/standalone/.next/BUILD_ID` equals the live `x-afldb-build` value.
4. Verify Node >=20.9, health, static assets, cluster worker count and connection-pool controls
   after restart.
5. Re-run the focused route/E2E regression set against the live development service.
6. Preserve build identity and deployment evidence for ISSUE-068.

### Phase 5 — ISSUE-068 acceptance handoff

Once all ISSUE-107 development gates are green, ISSUE-068 runs one comparable 1,440-row sweep
against the live Linux development service. Every response must prove the intended build via
`x-afldb-build`; worker/concurrency controls must not be reduced. Acceptance requires zero
unexplained hydration/client errors and no semantic regression from 1,238 / 202 / 0.

Only after that pass may ISSUE-068 close and a production rollout be considered. Production
deployment is not automatic and remains a separately reviewed operator action.

## Implementation evidence — 2026-08-29

ISSUE-107 remains **Open**. The bounded local implementation is complete and is ready to enter
the Linux development gate, but this Windows worktree has no `.env`, build database or `_test`
database. It therefore cannot legitimately prove database-backed page collection, standalone
output, guarded integration, production-route E2E or the Linux/systemd runtime.

### Phase 0 control

- Local Node: `v22.21.0`; the documented Linux development service pins Node `v22.23.2`.
  Both satisfy Next 16.3.1's package-declared `>=20.9.0` requirement.
- Baseline resolved closure after clean `npm ci`: Next `15.5.23`, React `19.2.8`, ReactDOM
  `19.2.8`, eslint-config-next `15.5.24`.
- Baseline production command: `next build` followed by
  `tools/build/prepare-standalone.mjs`; standalone output was configured but absent after the
  failed baseline build.
- Documented Linux development controls: `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10` (52 maximum
  application/auth connections under the documented formula).
- Baseline typecheck reproduced the expected **8 errors in 4 files**, with no extras:
  `season-rollover.ts` (2), `db-test-rebuild.test.ts` (4),
  `integration/draftguru-import.test.ts` (1), and
  `integration/observation-spine.test.ts` (1).
- Baseline DB-free Vitest: 65 files / 2,090 tests passed, 18 skipped, with one pre-existing
  failure because the gitignored DraftGuru `full-history-20260826` corpus is absent.
- Baseline lint: 172 errors and 81 warnings. This was already not a green repository gate.
- Baseline Next 15 Webpack compilation succeeded, then framework typechecking stopped on the
  known `season-rollover.ts` error before page collection or standalone emission.

### Phase 1 dependency and bundler result

- Direct dependencies now pin Next exactly `16.3.1` and eslint-config-next exactly `16.3.1`.
- A clean `npm ci` resolves Next `16.3.1`, React `19.2.8`, ReactDOM `19.2.8`, and
  eslint-config-next `16.3.1`; `npm ls` reports a coherent top-level closure.
- `npm audit` reports zero vulnerabilities. The existing PostCSS/Sharp security overrides are
  retained deliberately so the controlled upgrade does not introduce another dependency axis.
- Both scripts are explicitly Webpack-controlled: `next dev --webpack -p 3100` and
  `next build --webpack`; standalone preparation remains chained to the production build.
  Turbopack was neither enabled nor used.

### Phase 2 framework controls and serving-path review

- `next typegen` made the mandatory tracked `tsconfig.json` change from `jsx: preserve` to
  `jsx: react-jsx`, and added `.next/dev/types/**/*.ts` beside the existing production route
  type include.
- Generated/ignored `next-env.d.ts` now uses imports for `.next/types/routes.d.ts` and
  `.next/types/root-params.d.ts`. `npm run typecheck` runs `next typegen` first, so deleting
  `.next` plus `next-env.d.ts` after a clean install reproduced the same generated state and a
  green typecheck. The generated declaration was not hand-edited or made source-controlled.
- Next 16's dev server appended its version-matched managed agent-rules block to the existing
  `CLAUDE.md`, pointing future work at the installed `node_modules/next/dist/docs/`.
- The Next 16 native flat ESLint exports replaced the incompatible Next 15 `FlatCompat`
  adapter; the now-unused direct `@eslint/eslintrc` dependency was removed.
- The deprecated `middleware.ts` convention is retained for this first controlled upgrade.
  Next 16.3.1's installed upgrade guide states that renaming it to `proxy.ts` also changes its
  runtime from Edge to Node.js; taking that second runtime axis here would weaken the A/B
  control. The deprecation warning is recorded and is not a build failure.
- Next 16's layout-deduplicated, incremental navigation prefetch/segment-cache format is
  accepted as part of the proven serving-path candidate. AFLDB's intentional
  `prefetch={false}` primary/mobile navigation remains unchanged; no configuration attempts to
  force Next 15's `.rsc` or static output shape.

### Phase 3 local validation result

- The initial post-upgrade typecheck had exactly the same 8-error baseline and no new Next 16
  errors. All 8 became blockers once `next build --webpack` reached framework typechecking, so
  the runbook's blocker exception was applied narrowly:
  - `manifestRowTotal()` now supplies the existing numeric `reduce` operation's generic;
  - `resolvePython()` accepts the one optional environment key it actually reads without
    inheriting Next's required `NODE_ENV` augmentation;
  - the DraftGuru integration setup now passes its guarded `_test` DSN to the advisory-lock
    helper (restoring the lock its comments and teardown already required); and
  - the observation-spine test's conditional JSON fixture is explicitly `JsonValue`.
- Post-repair `npm run typecheck`: **PASS, 0 errors**. This is a legitimate disappearance of
  the known 8-error baseline, not a claim that it was green before the upgrade.
- Focused compatibility/semantic tests: **10 files, 800 tests passed**, covering auth,
  indexing, SEO, NL parse/plan/description/regression/semantic mapping, season rollover and
  the database rebuild harness. The two directly owning DB-free suites also passed 333 tests.
- Full DB-free Vitest after the upgrade is unchanged from baseline: 65 files / 2,090 tests
  passed, 18 skipped, and the same one missing gitignored DraftGuru-corpus failure.
- Guarded database integration: **not run**; no `AFLDB_TEST_DATABASE_URL` is present, and the
  guard correctly refuses any non-`_test` substitution.
- Lint now executes under the supported Next 16 flat config. It reports 180 errors and 81
  warnings versus baseline 172/81. The **net** delta is +8 errors, but the diagnostic-set delta
  is nine new errors minus one removed generated-file error: Next 16's native config ignores
  `next-env.d.ts`, removing the baseline `next-env.d.ts:3`
  `@typescript-eslint/triple-slash-reference` error ("Do not use a triple slash reference for
  ./.next/types/routes.d.ts, use `import` style instead."), while
  `eslint-plugin-react-hooks` 7.1.1's recommended preset newly enables
  `react-hooks/set-state-in-effect` at error severity. All nine newly exposed diagnostics are
  classification **A (new rule exposure only)**: the source patterns and React/ReactDOM 19.2.8
  runtime are unchanged, and Next 16's installed native config directly supplies the rule, so
  none is a framework compatibility defect or a flat-config mismatch.

  | File | Line | Rule | Message | Class |
  | --- | ---: | --- | --- | --- |
  | `src/app/admin/AdminNav.tsx` | 55 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |
  | `src/app/admin/AdminSection.tsx` | 48 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |
  | `src/app/admin/settings/SearchPlaceholderSettings.tsx` | 44 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |
  | `src/app/admin/settings/SearchPlaceholderSettings.tsx` | 81 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |
  | `src/components/ConsentBanner.tsx` | 46 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |
  | `src/components/PlayerPicker.tsx` | 55 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |
  | `src/components/ReorderableSections.tsx` | 77 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |
  | `src/components/SearchBox.tsx` | 67 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |
  | `src/components/SearchBox.tsx` | 119 | `react-hooks/set-state-in-effect` | `Error: Calling setState synchronously within an effect can trigger cascading renders` (`Avoid calling setState() directly within an effect`) | A |

  No rule was suppressed and no source or lint-config repair was made for this non-blocking
  exposure.
- `next build --webpack`: Webpack compilation **PASS** and framework TypeScript **PASS**; page
  data collection then stops while collecting `/_not-found` and `/aflw/clubs/[code]`, both with
  the same sole cause: `DATABASE_URL is not set`. The middleware-convention deprecation and
  Next-internal `dynamic-rendering.js` Edge-API messages are non-fatal warnings; no other Next 16
  build error occurs before the database configuration stop. Standalone output/preparation is
  therefore **not proven locally** and must be the first Linux development build gate.
- A live Next 16.3.1 Webpack dev process proved `/` -> `/beta` (307), `/admin` ->
  `/admin/login` (307), and `/robots.txt` (200), without framework-error response bodies.
  Data-backed routes returned the expected environment failure because no build/runtime DSN
  exists. The in-app browser was unavailable, so console/hydration inspection was not run.
- The dev server also warned that `src/app/sitemap.ts` and
  `src/app/sitemap.xml/route.ts` both resolve to `/sitemap.xml`. This is classified
  **pre-existing/non-causal**: both route sources implement the pre-upgrade segmented sitemap
  design and neither was introduced or changed by ISSUE-107. Next 16's build manifest still
  contains the explicit `/sitemap.xml/route` index and generated
  `/sitemap/[__metadata_id__]/route` segments. No SEO route was removed or redesigned under this
  framework-only issue; the live focused route gate must still verify the intended response.
- The ISSUE-068 1,440-row sweep was **not run**, as required by the ownership boundary.

### Phase 4 Linux development preparation and exact residual

- `deploy/sync-dev.ps1` now always enforces Node >=20.9 and captures the standalone BUILD_ID.
  Its explicit `-Issue107Gate` mode refuses skipped install/build/restart/health stages, checks
  live development controls remain `AFLDB_WORKERS=4` / `AFLDB_POOL_MAX=10`, and fails if the
  live `x-afldb-build` header is absent or differs from
  `.next/standalone/.next/BUILD_ID`. PowerShell parsing and `-WhatIf -Issue107Gate` pass; no SSH
  or deployment was performed.
- Before that gate, the Linux development `.env` must have `AFLDB_TRACE_REQUESTS=on`; the
  option is documented in `.env.example` and `docs/deployment.md`. This preserves per-response
  build/worker evidence through ISSUE-068 acceptance without making tracing a production
  default.
- Exact next action: after the user commits/pushes the reviewed local changes, run the guarded
  DB integration and full `npm run build` on Linux development, then execute
  `deploy/sync-dev.ps1 -Issue107Gate` through the normal Git/npm/systemd path. Preserve the
  build ID, service status, health, worker/pool evidence and focused route/E2E console results.
  ISSUE-107 stays Open until those G2/G3 results are green.
- Exact ISSUE-068 handoff after G3: run one comparable live Linux-dev 1,440-row sweep with
  every response bound to that build ID, `AFLDB_WORKERS=4` and established concurrency
  unchanged. ISSUE-068 may close only at zero unexplained hydration/client errors and no
  semantic regression from 1,238 / 202 / 0.

## Linux development evidence — 2026-08-29

Executed on the real development host `arm@10.0.40.100` (`streamanator`) against
`/home/arm/projects/afldb`. No production host, database or credential was contacted at any
point, and no local Git operation was performed.

### Pre-deploy database safety gate

Resolved from the host's own `.env` (mode `600 arm:arm`), passwords redacted:

| Variable | Role | Host | Database |
|---|---|---|---|
| `DATABASE_URL` | `afldb_app` | `localhost:5432` | `afldb_dev` |
| `AFLDB_OWNER_DATABASE_URL` | `afldb_owner` | `localhost:5432` | `afldb_dev` |
| `AFLDB_TEST_DATABASE_URL` | `afldb_owner` | `localhost:5432` | `afldb_test` |
| `AFLDB_IMPORT_DATABASE_URL` | `afldb_import` | `localhost:5432` | `afldb_dev` |
| `AFLDB_AUTH_DATABASE_URL` | `afldb_auth` | `localhost:5432` | `afldb_dev` |
| `AFLDB_BACKUP_DATABASE_URL` | `afldb_backup` | `localhost:5432` | `afldb_dev` |
| `AFLDB_PROD_DATABASE_URL` | — | — | **absent** |

No production database was selectable by this workflow: `AFLDB_PROD_DATABASE_URL` is absent
from `.env`, the unit's `UnsetEnvironment=` drops it along with the import/owner/test/backup
DSNs, and the running service holds only `DATABASE_URL` and `AFLDB_AUTH_DATABASE_URL`, both
naming `afldb_dev`. `AFLDB_TEST_IMPORT_DATABASE_URL` is also absent, so `db:test:rebuild`'s
data stages fail closed and cannot inherit the development import DSN.

Read-only identity checks: PostgreSQL 16.15; `afldb_dev` holds 13,363 players / 17,044 matches
/ 130 seasons; `afldb_test` holds 13,277 players / 16,838 matches / 130 seasons and is at
**77/77 migrations**. `afldb_dev` is at **70/77**, with `071`–`077` pending. Neither database
was mutated to establish identity.

### Deployment-path defects found and repaired

`-Issue107Gate` could not prove what it claims on this host until four defects in the
deployment path were repaired. All four are ISSUE-107-owned, because ISSUE-107 introduced the
gate and its evidence contract.

1. **Node floor could not be met over SSH.** The systemd unit pins nvm's Node `v22.23.2`, but
   nvm is not on a non-interactive (or login) SSH `PATH`, which resolves `/usr/bin/node`
   `v18.19.1` — below Next 16's `>=20.9`. `sync-dev.ps1` now selects the nvm default before
   the version check, so the build runs on the same runtime that serves it. Hosts without nvm
   keep their `PATH` Node and are still held to the floor check.
2. **The gate ran without `set -Eeuo pipefail`.** PowerShell writes a UTF-8 BOM into a native
   command's stdin pipe, so the remote shell failed on the script's first line
   (`bash: line 1: ﻿set: command not found`) and then continued past failed stages, able to
   exit 0 regardless. The remote script is now base64-encoded, which is immune to the BOM,
   CRLF and PowerShell's argument handling.
3. **Six evidence lines described the workstation, not the server.** They were double-quoted
   PowerShell strings, so `$(hostname)`, `$(pwd)`, `$(node --version)`, `$(npm --version)` and
   `$(git rev-parse --short HEAD)` expanded locally. The reported Node version, deployed
   revision and — critically — the `git status --porcelain` dirty-tree guard were all measured
   on Windows. They are now single-quoted and evaluate on the server.
4. **`sudo -n systemctl restart` cannot work here.** `sudo` requires a password on this host
   (`sudo -n true` is refused; `systemctl restart` without sudo returns *Interactive
   authentication required*). The unit runs as `arm` with `Restart=always`, so the gate now
   falls back to terminating `MainPID` and letting **systemd** respawn the service from the
   unit, proving the respawn by a changed `MainPID` rather than assuming it. systemd is not
   bypassed and the environment file is re-read.

One runtime control was missing rather than wrong: `AFLDB_POOL_MAX` was set nowhere, so the
pool relied on the `?? 10` default in `src/db/client.ts` and could not be proven in the
running process. `AFLDB_POOL_MAX=10` was added to the host `.env`, which changes no effective
value. `AFLDB_WORKERS=4` comes from `Environment=` in the unit rather than `.env` as
`docs/deployment.md` §5 describes; that inconsistency is pre-existing and was left alone.

### Node, source and closure

- Deployment-path Node `v22.23.2`, npm `10.9.8` (service runtime, floor satisfied).
- Checkout advanced `73e6a7e` → `be2a963` on branch `dev` by the deployment path's own
  `git pull --ff-only`; the server was 179 files behind, not merely missing ISSUE-107.
- Installed closure: Next `16.3.1`, React `19.2.8`, ReactDOM `19.2.8`, eslint-config-next
  `16.3.1`. `npm ci` clean, **0 vulnerabilities**.
- `npm run typecheck` (`next typegen && tsc --noEmit`) on Linux: **PASS, 0 errors**.

### Database-backed validation — NOT green, and not attributable to Next 16

`vitest run` against the guarded `afldb_test` DSN (the harness redirects `DATABASE_URL` to the
`_test` database and refuses any other target):

| Run | Files | Tests |
|---|---|---|
| Default (parallel) | 7 failed / 82 passed / 5 skipped | 36 failed / 2,497 passed / 85 skipped |
| `--no-file-parallelism` | 6 failed / 83 passed / 5 skipped | 33 failed / 2,500 passed / 85 skipped |

The three failures that appear only under parallelism are cross-file interference on the one
shared `afldb_test` — a transient `2094` season was asserted against by `release-gates` while
another suite held it, and it is absent from the database at rest.

The 33 stable failures are **classification C/E, not A**. Every failing file
(`release-gates`, `database`, `db-health`, `data-editor`, `settle-afltables`,
`draftguru-acquisition`, `db-test-rebuild`) imports nothing from `next`, `react` or
`src/app`; every assertion is PostgreSQL content or on-disk corpus state. The Next.js version
has no surface on them. The cause is that `afldb_test`'s **data** has never been rebuilt to
the current full-history expectations, while its **schema** is current:

- Brownlow season votes total `0`/`null` against an expected `79,113`;
- 12,422 players without a date of birth against an expected 883, and 855 with one against an
  expected 12,478;
- `player_match_stats` 685,471 against an expected 694,210;
- draft-link identity resolution `5` against an expected `3,459`;
- `ENOENT .../data/sources/draftguru/full-history-20260826` — the gitignored DraftGuru corpus
  is absent on the host, which is the same cause as the pre-existing local baseline failure.

Rebuilding is out of ISSUE-107's scope and is blocked here anyway: `db:test:rebuild` is
destructive, requires the absent `AFLDB_TEST_IMPORT_DATABASE_URL`, and preflights the absent
corpus. Tracked separately as **`AFLDB-ISSUE-108`**. **G2's integration leg is therefore not
green, and ISSUE-107 is not claimed to be Resolved on this evidence.**

### Next 16 Webpack build and standalone output

`npm run build` = `next build --webpack && node tools/build/prepare-standalone.mjs`, run
through the deployment path against the legitimate `afldb_dev` environment Next loads from
`.env`:

- `▲ Next.js 16.3.1 (webpack)`, `Environments: .env`;
- Webpack compiled successfully in 28.4s;
- framework TypeScript finished in 41s;
- **page data collection succeeded using 23 workers** — the exact point the Windows build
  could not reach;
- 1,499 static pages generated in 29.4s; build traces collected;
- `prepare-standalone` copied `.next/static`, `public` and `deploy/coming-soon`, and created
  `.next/cache` for ISR.

Standalone output verified independently of the script: `server.js` present, `.next/static`
present with 119 files, `public` present, ISR cache present, and `next` `16.3.1` inside the
standalone bundle.

**BUILD_ID: `uZReW8G1XnsGnG5FNYY-I`** — identical in `.next/BUILD_ID` and
`.next/standalone/.next/BUILD_ID`.

The only build warnings are the two already classified as non-fatal: the `middleware` →
`proxy` convention deprecation (deliberately retained, since renaming also moves Edge → Node
runtime) and Next's internal `dynamic-rendering.js` Edge-API notice. **No duplicate-route
warning for `/sitemap.xml` appeared in the Linux production build.**

### Deployment gate, live identity and health

`deploy/sync-dev.ps1 -Issue107Gate -SkipMigrate -AllowDirtyServer` — **exit 0**.

- `-SkipMigrate` is permitted by `-Issue107Gate` (which refuses only install/build/restart/
  health skips) and was used deliberately: ISSUE-107 adds no migration, and `afldb_dev`'s
  seven pending migrations belong to other merged issues. Skipping them affects no ISSUE-107
  or ISSUE-068 gate — only `/admin/data-editor`, `/admin/current-season` and the acquisition
  tooling touch `data_overrides`/`staging.*`, all `force-dynamic` and outside both gates'
  route sets. See the residual below.
- `-AllowDirtyServer` was needed only because repair (3) made the dirty-tree guard finally
  measure the server. Every entry is untracked operational residue (`.deploy-backups/`, two
  `.env.bak-*`, a stray `FETCH_HEAD`, five NL corpus CSVs); no tracked file is modified, and
  `git pull --ff-only` cannot touch untracked paths.

Proven after the restart:

| Check | Result |
|---|---|
| Restart | systemd respawned the service, `457477` → `2019778`, `NRestarts=1` |
| Service | `active (running)`, 4 × `next-server (v16.3.1)` under the cluster primary |
| Runtime | `/home/arm/.nvm/versions/node/v22.23.2/bin/node deploy/server-cluster.mjs` |
| Controls | `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`, `AFLDB_TRACE_REQUESTS=on` in `/proc/<pid>/environ` |
| Service DSNs | `DATABASE_URL` and `AFLDB_AUTH_DATABASE_URL`, both `afldb_dev`; no others present |
| `/api/health` | `200 {"status":"ok","database":"ok","latencyMs":23}` |
| Built BUILD_ID | `uZReW8G1XnsGnG5FNYY-I` |
| Live `x-afldb-build` | `uZReW8G1XnsGnG5FNYY-I` — **equal** |
| Journal | zero error-level entries since the restart |

No stale Next 15 process or build survives: every worker reports `next-server (v16.3.1)`, the
standalone bundle resolves `next@16.3.1`, and the previous build `wGcOJY2wbxuLL8MW5OYGV` is no
longer served. The only journal warnings are two systemd
`Failed to kill control group ... ignoring: Invalid argument` lines at restart, after which the
service started cleanly with all four workers.

### Focused live route and browser validation

A real Chromium was driven on the development host against `http://10.0.40.100:8090`,
recording HTTP status, redirect target, `x-afldb-build`, console errors and uncaught page
errors. Nothing was suppressed and no concurrency was reduced. The beta-authenticated pass
reused the existing saved sweep session rather than redeeming an access code.

**17 of 17 routes clean. Zero console errors, zero uncaught page errors, zero hydration/client
errors. Every response carried `x-afldb-build: uZReW8G1XnsGnG5FNYY-I`.**

| Pass | Routes |
|---|---|
| Anonymous (beta gate on) | `/` → `/beta`, `/beta`, `/admin` → `/admin/login`, `/admin/login`, `/robots.txt`, `/sitemap.xml` → `/beta?from=%2Fsitemap.xml`, `/api/health` |
| Beta-authenticated | `/`, `/clubs`, `/clubs/carlton` (SSG), `/players/scott-pendlebury-4182` (SSG), `/seasons/2026` (SSG), `/brownlow/1990` (SSG), `/records`, `/advanced-search` → `/players`, `/search?q=…` (NL), `/grid-solver` |

An initial run reported six routes as unclean; the cause was the harness waiting for
`networkidle`, which `/beta`, `/admin/login` and `/search` never reach. Re-run against `load`
plus a settle window, every route is clean. This is recorded because the first result was not
an application defect and must not be read as one.

### Sitemap classification after Linux validation — closed

The **pre-existing/non-causal** classification is confirmed and the question is now closed:

- the Next 16 Linux production build emits **no** duplicate-route warning;
- the build manifest carries both the explicit `○ /sitemap.xml` index and the generated
  `● /sitemap/[__metadata_id__]` segments, as designed;
- fetched with a beta-admitted session, `/sitemap.xml` returns `404 Not found` — which is the
  **intended** behaviour, not a regression: `src/app/sitemap.xml/route.ts` and
  `src/app/sitemap.ts` both return 404 / an empty segment list when `indexingEnabled()` is
  false, and development deliberately leaves `AFLDB_INDEXING` unset. `/robots.txt` correctly
  returns `Disallow: /` on the same host.

Next 16 introduced no sitemap regression, and nothing was repaired under ISSUE-107.

### Residual — `afldb_dev` migrations 071–077 — CLOSED 2026-08-29

`afldb_dev` was seven migrations behind the deployed code: pre-existing deployment debt from
other merged issues (`071` audit-link FK indexes, `072` DOB conflict ownership, `073`/`075`
`data_overrides`, `074` source-observation spine, `076` afltables settle projections, `077`
AFL API lineups), not an ISSUE-107 change — ISSUE-107 adds no migration.

On operator instruction the pending committed migrations were applied through the normal
authorised development workflow (`npm run db:migrate`, which targets `dev` and refuses any
other target).

Pre-application safety, all confirmed before anything ran:

- migration target proven server-side as `database=afldb_dev user=afldb_owner port=5432`;
- `AFLDB_PROD_DATABASE_URL` absent from both `.env` and the shell environment;
- `AFLDB_MIGRATE_TARGET` unset, so the runner defaults to `dev`;
- status exactly `70` applied with the seven committed files pending and nothing else.

Result — all seven applied in order, no failures:

```
071_audit_link_fk_indexes.sql        ok (32 ms)
072_dob_conflict_ownership.sql       ok (108 ms)
073_data_overrides.sql               ok (36 ms)
074_source_observation_spine.sql     ok (156 ms)
075_data_overrides_fk_index.sql      ok (14 ms)
076_afltables_settle_projections.sql ok (145 ms)
077_afl_api_lineups.sql              ok (59 ms)
```

Post-application: **77/77 applied, 0 pending**. Checksum integrity re-verified twice — `db:status`
re-reads every applied file, and a second `db:migrate` is a clean no-op
(`Nothing to apply — schema is up to date`); the runner refuses to run at all if an applied
migration's bytes have changed, so this is positive evidence of no drift. All nine new objects
exist: `public.data_overrides`, `public.promotion_candidates`, `public.promotion_decisions`,
`staging.source_payloads`, `staging.source_record_versions`, `staging.source_records`,
`staging.afltables_match`, `staging.afltables_player_match`, `staging.afl_api_lineup`.

**No separate privileges reconciliation was required.** The routine deployment
(`docs/deployment.md` §3) does not include one, and migration `074` calls
`afldb_meta.grant_app_read()` for its public tables itself. Verified with read-only
`has_table_privilege()` — `afldb_app` holds `SELECT` on `promotion_candidates`,
`promotion_decisions` and every new `staging` table; `afldb_import` holds
`SELECT/INSERT/UPDATE` on the importer-owned staging tables. `tools/maintenance/privileges.sql`
was deliberately not run: its hand-maintained lists can revoke, and nothing required it.

Production was not touched at any point.

### Post-migration smoke — all green

| Check | Result |
|---|---|
| `/api/health` | `200 {"status":"ok","database":"ok","latencyMs":0}` |
| `/admin` | `307` → `/admin/login` |
| `/admin/data-editor` | `307` → `/admin/login` (no 500; the missing-relation failure mode is gone) |
| `/admin/current-season` | `307` → `/admin/login` (no 500) |
| Live `x-afldb-build` | `uZReW8G1XnsGnG5FNYY-I` — **unchanged**, no rebuild or restart |
| Service | `active`, `MainPID 2019778`, `NRestarts=1` — same process as the deployment |
| Runtime | `next-server (v16.3.1)` × 4 |
| Controls | `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`, `AFLDB_TRACE_REQUESTS=on` |
| Journal | zero error-level entries |

Stated precisely, because it would be easy to overclaim: the admin checks prove the routes are
served and correctly protected, and that their schema dependencies now exist and are readable
by the roles that need them. They do **not** prove the authenticated pages render, because no
super-admin session was created — doing so would have meant minting credentials on the
development host.

### Defect exposed by the migration — `AFLDB-ISSUE-109`

Applying `073` made a pre-existing contradiction reachable rather than introducing one. Before
the migration `/admin/data-editor`'s save path failed on a missing relation; it will now fail on
a missing grant. `saveEdit()` in `src/db/queries/data-edits.ts` opens a short-lived
**`afldb_import`** connection and, inside that transaction, `INSERT`s into `data_overrides` — but
migration `073` grants `afldb_import` only `SELECT` on that table, deliberately and with a
comment saying so, and `tools/maintenance/privileges.sql` reconciles to the same `SELECT`-only
grant. Confirmed live: `has_table_privilege('afldb_import','data_overrides','INSERT')` is
`false`. Tracked as `AFLDB-ISSUE-109`; not repaired here, because grants belong in a migration
and ISSUE-107 owns no schema change.

## Gates

- **G0 — Candidate integrity:** Next 16.3.1; React/ReactDOM 19.2.8; Node >=20.9; Webpack chosen.
- **G1 — Configuration integrity:** lockfile coherent; Next 16 TypeScript/generated controls
  understood; standalone preparation retained; no unrelated dependency or bundler change.
- **G2 — Application regression:** build, typecheck, unit, integration and focused route/E2E
  checks pass with application/security semantics preserved.
- **G3 — Development runtime:** legitimate Linux dev deployment is healthy; built and live
  build IDs match; worker/pool controls are unchanged.
- **G4 — Hydration acceptance:** ISSUE-068's deployed 1,440-row run has zero unexplained
  hydration/client errors and semantic 1,238 / 202 / 0 or better without changed expectations.
- **G5 — Production eligibility:** G0-G4 are green and the production rollout receives its own
  review. Until then, production is out of scope.

Current state (2026-08-29, after the Linux development gate): **G0 PASS; G1 PASS; G2 PARTIAL —
build, typecheck and focused route/E2E all PASS on Linux, but the guarded database integration
does NOT pass and is blocked by `AFLDB-ISSUE-108` (`afldb_test` data, provably not framework
attributable); G3 PASS; G4 PENDING under ISSUE-068; G5 PENDING.** Neither ISSUE-107 nor
ISSUE-068 is resolved.

ISSUE-107 stays **Open** on G2 alone. Every gate it owns outright is green: the Next 16.3.1
Webpack build, complete standalone output, `BUILD_ID uZReW8G1XnsGnG5FNYY-I` proven live via
`x-afldb-build`, a systemd-managed restart, health, unchanged 4-worker/10-pool controls, and
17/17 clean live routes with zero hydration or client errors.

## Handoff to AFLDB-ISSUE-068 — the exact deployed build

ISSUE-068's final acceptance sweep runs against this build and no other.

| Item | Value |
|---|---|
| Host | `arm@10.0.40.100` (`streamanator`), `/home/arm/projects/afldb` |
| Base URL | `http://10.0.40.100:8090` (Caddy) → `127.0.0.1:3100` |
| Deployed commit | `be2a963` on branch `dev` |
| **BUILD_ID** | **`uZReW8G1XnsGnG5FNYY-I`** |
| Live `x-afldb-build` | `uZReW8G1XnsGnG5FNYY-I` — proven equal to the standalone BUILD_ID |
| Next.js | `16.3.1`, proven live (4 × `next-server (v16.3.1)`) |
| React / ReactDOM | `19.2.8` / `19.2.8` |
| Bundler | Webpack (`next build --webpack`); Turbopack not used |
| Node (Linux) | `v22.23.2` (npm `10.9.8`) |
| Application database | `afldb_dev` — the intended development database, proven from `/proc/<pid>/environ` |
| Guarded test database | `afldb_test`, available, schema at 77/77 (data blocked by ISSUE-108) |
| `AFLDB_TRACE_REQUESTS` | `on` (live; `x-afldb-worker` present on every response) |
| `AFLDB_WORKERS` | `4` (live) |
| `AFLDB_POOL_MAX` | `10` (live) |
| Playwright workers | `4` — `playwright.nl-stress.config.ts` defaults to `NL_UI_WORKERS ?? 4`; leave `NL_UI_WORKERS` unset |
| Beta session | `tests/nl-ui/.auth/state.json` on the host is current; otherwise set `AFLDB_E2E_BETA_CODE` to an unlimited code |
| Focused live browser result | 17/17 routes clean; zero console, page and hydration errors |

ISSUE-068 acceptance is unchanged: 1,440 / 1,440 observations at the same 4-worker
concurrency posture, zero unexplained hydration errors, zero unexplained client errors, zero
violations, and no semantic regression from pass 1,238 / fail 202 / unscored 0 / answered
1,238 / unanswerable 43 / absent 159 / http_error 0 / page_error 0. Every response must bind to
`uZReW8G1XnsGnG5FNYY-I`.

**Handoff executed and accepted — 2026-08-29.** The sweep ran against this exact build and
passed every condition: 1,440 / 1,440 observed, all carrying `uZReW8G1XnsGnG5FNYY-I`, zero
hydration errors on every cut, zero client errors, zero violations, zero metamorphic
disagreements, zero HTTP and page errors, and no semantic regression — outcomes improved to
1,440 / 0 / 0. That improvement belongs to the NL work merged between the A/B source and
`be2a963`, not to the framework upgrade; see `AFLDB-ISSUE-068.md` for the full result and the
corpus provenance. ISSUE-068 remains Open pending an explicit decision to close.

## Stop conditions

Stop the upgrade and keep ISSUE-107 open if any of the following occurs:

- React or ReactDOM must change from 19.2.8 without prior adjudication;
- the only apparent build fix is switching to Turbopack or changing another major runtime axis;
- a Next-generated TypeScript/configuration change cannot be explained or reproduced;
- Node is below 20.9 on the target runtime;
- typecheck, tests, routes, security boundaries, search semantics or standalone packaging
  regress;
- the live `x-afldb-build` does not match the intended built artifact;
- deployment requires reduced `AFLDB_WORKERS`, reduced concurrency, hidden console errors or
  weakened authentication/security controls; or
- ISSUE-068's acceptance has any unexplained hydration/client error or regresses the
  1,238 / 202 / 0 semantic result.

On a stop, preserve the exact build, closure, logs and test evidence. Restore the development
runtime through the normal reviewed deployment path if service safety requires it; do not
reinterpret a rollback or a lower-concurrency run as acceptance.

## Completion

ISSUE-107 is complete when the bounded Next 16.3.1/Webpack closure is implemented, its owned
validation is green, it is proven live on Linux development, and its build/deployment evidence
has been handed to ISSUE-068. The final 1,440-row pass remains an ISSUE-068-owned acceptance
step and a production-eligibility gate; it is not reassigned to ISSUE-107. No exact upstream
Next.js line or commit is required.
