# ADR 0001 — In-place strangler layout with `packages/*` modules

- Status: Accepted, implemented in Stage 1 (2026-10-19)
- Plan decision: `docs/v2/plan.md` §3 D1; review resolutions R-009, R-010 (§7)

## Context

The owner's instruction names a target separation (`apps/web`, `apps/worker`, `packages/domain`,
`db`, `acquisition`, `derived`, `admin`, `testing`, `legacy/offline`) and allows other folder names
"if the existing repository makes another arrangement materially safer". The repository is a
single Next.js 16 App Router application at the root. The systemd units (`deploy/*.service`),
`tools/build/prepare-standalone.mjs`, the Caddy configuration and thousands of tests assume root
paths; a physical move of the application would change every one of them.

## Decision

- The Next.js application stays at the repository root and is `apps/web` logically.
- `apps/worker` is the documented mapping onto `tools/current-season/*` and the AFL API systemd
  units (`deploy/afldb-settle-afl-api*.{service,timer,sh}`); nothing is moved.
- New V2 code lives in `packages/<module>/src/**`, reached only through the package index:
  `@afldb/<module>` maps to `./packages/<module>/src/index.ts` in `tsconfig.json` `paths` and in
  the `vitest.config.mts` alias. Subpath imports (`@afldb/<module>/x`) are forbidden.
- Existing `src/lib/**` code is re-exported or wrapped by the owning package, not rewritten,
  unless a V2 requirement needs new behaviour.
- Package tests live under `tests/` (vitest collects `tests/**/*.test.ts` only).
- Dependency direction: `domain` imports nothing internal except pure leaf modules it re-exports
  (its transitive closure reaches no database, framework or IO module); `db` imports `domain`;
  `acquisition`, `derived`, `admin` import `domain` and `db`; `testing` may import any package and
  only `tests/**` may import `@afldb/testing`; `src/app/**` and `src/components/**` never import
  `@afldb/acquisition`; only `legacy/**` imports `legacy/**`.
- Enforcement is twofold: ESLint `no-restricted-imports` blocks in `eslint.config.mjs` (specifier
  patterns), and `tests/v2-module-boundaries.test.ts`, which resolves relative specifiers to files
  through the `@afldb/testing` checker, so a `../../packages/x` escape is caught too.

## Consequences

- No deployment path changes; the strangler grows inside the existing tree.
- `packages/derived` exports nothing until Stage 4 (no aspirational API).
- Next.js resolves `@afldb/*` through `tsconfig.json` `paths`; `next typegen` and `tsc` pass.
  A production `next build` was not run because it needs a database (V2-GAP-002).
