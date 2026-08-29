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
