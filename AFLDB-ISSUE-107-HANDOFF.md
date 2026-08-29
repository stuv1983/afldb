# AFLDB-ISSUE-107 Linux Dev Handoff

## Current repository state

Implementation commit: `5ace3df Upgrade dev runtime to Next.js 16`

The user has already fast-forwarded `5ace3df` into `dev`, pushed `dev` to `origin/dev`, and
confirmed that `dev` and `origin/dev` are synchronized. No Git action is required or
recommended before Claude starts.

## Current status

- AFLDB-ISSUE-107 remains **Open**.
- Implementation is complete enough to enter the Linux dev validation gate.
- Do not mark AFLDB-ISSUE-107 Resolved until its remaining Linux gates pass.
- AFLDB-ISSUE-068 remains **Open** and owns the final post-deployment 1,440-row hydration
  acceptance.

## Implemented target

- Next.js upgraded from 15.5.23 to 16.3.1.
- `eslint-config-next` upgraded to 16.3.1.
- React and ReactDOM remain 19.2.8.
- Webpack is retained explicitly; production build uses `next build --webpack`.
- Node >=20.9 is enforced and documented.
- Next 16 TypeScript and configuration controls are accommodated.
- ESLint uses the native Next 16 flat configuration.
- `middleware.ts` is intentionally retained to avoid simultaneously changing runtime semantics
  to `proxy.ts`.
- The known Next 16 segment-cache/prefetch serving-format difference is acknowledged.
- No database migration was added.
- Parser, SQL generation, NL-answer semantics, and application behaviour were not redesigned.

## Compatibility repairs

Four existing type defects became hard blockers when Next 16's build reached framework
TypeScript. These are build-compatibility repairs, not AFLDB-ISSUE-068 hydration fixes:

- `src/lib/rollover/season-rollover.ts`: supplied the existing numeric `reduce` operation's
  generic so its accumulator is typed as `number`.
- `tools/db/rebuild-test.ts`: allowed the optional environment key read by `resolvePython()`
  without inheriting Next's required `NODE_ENV` augmentation.
- `tests/integration/draftguru-import.test.ts`: passed the already guarded `_test` DSN to the
  advisory-lock helper, matching the test's existing lock and teardown intent.
- `tests/integration/observation-spine.test.ts`: typed the conditional JSON fixture as
  `JsonValue`.

## Typecheck

- Before AFLDB-ISSUE-107: 8 known errors in 4 files.
- Immediately after the upgrade: the same 8 errors and zero additional Next 16 TypeScript
  errors.
- After the bounded repairs: `npm run typecheck` passes with 0 errors.

## Local build

The Next 16.3.1 Webpack build:

- completed Webpack compilation;
- completed framework TypeScript;
- reached `Collecting page data using 19 workers`;
- then stopped because `DATABASE_URL is not set`;
- exposed the same missing-`DATABASE_URL` cause through `/_not-found` and
  `/aflw/clubs/[code]`; and
- encountered no other Next 16 build failure before that point.

Standalone preparation therefore did not run locally. No fake `DATABASE_URL` was introduced.

## Completed validation

- Clean `npm ci`: **PASS**.
- Focused DB-free tests: **800/800 PASS**.
- Broader DB-free suite: **2,090 PASS / 18 skipped**.
- One unchanged missing gitignored DraftGuru-corpus failure remains external to ISSUE-107.
- `npm audit`: **0 vulnerabilities**.
- Deployment script parse and `-WhatIf -Issue107Gate`: **PASS**.
- Local HTTP:
  - `/` -> `/beta`: 307
  - `/admin` -> `/admin/login`: 307
  - `/robots.txt`: 200
- The 1,440-row hydration sweep was **not run**.
- Database integration was **not run locally** because no authorised `_test` DSN was available.
- Production deployment was **not performed**.

## Lint classification

- Baseline: 172 errors / 81 warnings.
- Next 16: 180 errors / 81 warnings.
- Diagnostic-set change: nine newly surfaced `react-hooks/set-state-in-effect` errors minus one
  generated `next-env.d.ts` diagnostic that disappears; net +8 errors.
- All nine new diagnostics are existing source patterns newly exposed by the intended Next 16
  React Hooks lint rules.
- No lint rule was suppressed and no source rewrite was made merely to restore the old count.

Affected locations:

- `src/app/admin/AdminNav.tsx`
- `src/app/admin/AdminSection.tsx`
- `src/app/admin/settings/SearchPlaceholderSettings.tsx` (2)
- `src/components/ConsentBanner.tsx`
- `src/components/PlayerPicker.tsx`
- `src/components/ReorderableSections.tsx`
- `src/components/SearchBox.tsx` (2)

## Sitemap classification

The `/sitemap.xml` duplicate-route warning is adjudicated as **pre-existing/non-causal**. Do not
repair it under AFLDB-ISSUE-107 unless new Linux evidence disproves that classification.

## Claude startup reading

Read these files first:

1. `CLAUDE.md`
2. `AFLDB-ISSUE-107.md`
3. `AFLDB-ISSUE-107-HANDOFF.md`
4. `AFLDB-ISSUE-068.md`
5. `deploy/sync-dev.ps1`
6. `docs/deployment.md`

## Exact remaining Linux dev gates

1. Use the legitimate Linux dev environment and its real database configuration.
2. Run the guarded database integration required by `AFLDB-ISSUE-107.md`.
3. Complete the legitimate database-backed Next 16 Webpack build.
4. Prove complete standalone output and record its `BUILD_ID`.
5. Preserve the AFLDB-ISSUE-068 runtime controls:
   - `AFLDB_TRACE_REQUESTS=on`
   - 4 workers
   - database pool 10
6. Run `deploy/sync-dev.ps1 -Issue107Gate` using the exact invocation and environment prescribed
   by the runbook.
7. Prove the required Node version, clean dependency install, Webpack build, standalone
   `BUILD_ID`, systemd restart, health, runtime controls, and that live `x-afldb-build` matches
   the intended `BUILD_ID`.
8. Run focused live route/E2E validation, including console and hydration behaviour plus the
   intended sitemap response.
9. Do not run the final 1,440-row hydration acceptance as ISSUE-107 unless the runbook explicitly
   requires it.
10. Once the ISSUE-107 Linux gates pass, hand back to ISSUE-068 for one final 1,440-row
    acceptance with the established worker and concurrency controls, zero unexplained
    hydration/client errors, and no semantic regression from `1238 / 202 / 0`.

## Stop conditions

Claude must stop rather than widen scope if:

- a migration appears necessary;
- React or ReactDOM would need changing;
- Webpack cannot be retained;
- application semantics would need redesign;
- production deployment would be required;
- a database would be mutated outside an expressly authorised test/dev gate; or
- a failure clearly belongs to another issue.

## First recommended Claude action

After reading the six startup files, inspect the legitimate Linux dev environment against the
runbook's prerequisites—especially Node >=20.9, the real dev database configuration, and the
required `AFLDB_TRACE_REQUESTS=on`, 4-worker, and pool-10 controls—then begin the guarded database
integration gate. No Git action is required before Claude starts.
