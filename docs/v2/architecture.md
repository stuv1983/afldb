# AFLDB V2 — architecture overview (implemented state)

Status: describes what exists in `D:\dev\afldbV2` at the close of Stage 1 (2026-10-19). Planned
work is labelled as such and points at its plan decision; nothing here is aspirational.

## 1. Shape

AFLDB V2 is a controlled fork and in-place strangler rebuild of the AFLDB Next.js 16 / PostgreSQL
application (ADR 0001). The application stays at the repository root; V2 code grows in
`packages/*` beside it and takes over responsibilities module by module.

```text
repository root  (logical apps/web)       src/app, src/components, src/search, src/db, src/lib
tools/current-season + deploy/afldb-settle-afl-api*   (logical apps/worker)
packages/
  domain       pure domain types and rules            -> imports nothing internal
  db           database access boundary               -> domain
  acquisition  acquisition boundary (AFL API)         -> domain, db
  derived      database-derived results               -> domain, db
  admin        restricted, audited admin services     -> domain, db
  testing      test fixtures and contract checks      -> any package; imported only by tests/**
legacy/        (not created yet; plan D10, Stage 4)   imported only by legacy/**
```

## 2. Application mapping

| Logical unit | Physical location | Runs as |
|---|---|---|
| `apps/web` | repository root: `src/app` (52 public pages, 56 admin pages, 19 route handlers, 30 server-action files), `src/components`, `src/search`, `src/db/queries` (74 modules), `src/lib` (118 files) | `deploy/afldb.service` → `deploy/server-cluster.mjs` |
| `apps/worker` | `tools/current-season/*` (AFL API acquire/settle CLIs) | `deploy/afldb-settle-afl-api.{service,timer,sh}` (05:00 nightly), `deploy/afldb-settle-afl-api-brownlow.{service,timer,sh}` (every 5 minutes) |
| legacy runtime ingestion | CSV upload/submissions, email intake, AFL Tables settle, Squiggle/Kali refresh | see `docs/v2/inventory.md` invoker matrix L1-L13; disposition is Stage 4/5 work |

Counts are from `docs/v2/inventory.md`, where each has its re-derivation command.

## 3. Packages as they exist

| Package | Exports (Stage 1) | Source of each export |
|---|---|---|
| `@afldb/domain` | fixture status and round vocabulary, finals round codes, `isFixtureRoundType`, `isFixtureStatus`; `ImportBatchId`, `asImportBatchId` | re-exports of `src/lib/fixtures/spec.ts`, `src/lib/import-batch-id.ts` (both pure leaf modules) |
| `@afldb/db` | `assertTestProcessDsn`, `testProcessDsnRefusal`, `isTestProcess` | re-export of `src/db/test-process-guard.ts` (new in V2, ADR 0005) |
| `@afldb/acquisition` | the source-family registry contract (`parseSourceFamilyRegistry`, `getSourceFamily`, `isPromotable`, ...) | re-export of `src/lib/acquisition/source-families.ts` |
| `@afldb/derived` | nothing | deliberately empty until Stage 4 (ADR 0006) |
| `@afldb/admin` | `hasCapability`, `Capability`, `CapabilityRole`, `CapabilityViewer` | re-export of `src/lib/auth/capabilities.ts` |
| `@afldb/testing` | `applyTestDsnPolicy` and DSN helpers; the module-boundary checker | `packages/testing/src/dsn-policy.ts`, `packages/testing/src/module-boundaries.ts` (new in V2) |

The connection pools (`src/db/client.ts`, `src/db/authClient.ts`) are not re-exported: importing
`client.ts` builds a pool, so a package index that re-exported it would open a pool on import.

## 4. Boundary enforcement

- `tsconfig.json` `paths`: `"@afldb/*": ["./packages/*/src/index.ts"]`; `vitest.config.mts`
  mirrors it with a regex alias that matches the bare package name only.
- `eslint.config.mjs`: `no-restricted-imports` blocks per layer (subpath imports, `legacy/**`,
  path imports into `packages/`, `@afldb/testing` outside tests, the package dependency direction,
  `@afldb/acquisition` from `src/app`/`src/components`, framework/DB imports in `domain`).
- `tests/v2-module-boundaries.test.ts`: fixtures for every rule; a scan of `src`, `tools`,
  `packages` and `deploy` with relative specifiers resolved to files; a transitive purity walk of
  `@afldb/domain`; alias resolution of every package; and ESLint probes proving the rules fire.

## 5. Data and safety boundaries that already exist (inherited, unchanged)

- Least-privilege roles: `afldb_app` (read-only public site, `DATABASE_URL`), `afldb_auth`
  (operational tables, `AFLDB_AUTH_DATABASE_URL`), `afldb_import` (statistical writes,
  `AFLDB_IMPORT_DATABASE_URL`), `afldb_owner` (migrations). New public tables are unreadable and
  unwritable until their migration opts in (migrations 039 and 045).
- Statistical admin mutations write their `data_edits` audit row in the same transaction as the
  mutation (migration 066, AFLDB-ISSUE-027).
- The AFL API pipeline: snapshot (`src/lib/acquisition/afl-api-snapshot.ts`), staging projections
  (migration 103), identity adjudication (migration 104), settle/promotion
  (`src/lib/acquisition/settle-afl-api.ts`, `settle-core.ts`), and the ingestion switches
  (`src/lib/acquisition/afl-api-ingestion-control.ts`). Stage 3 wraps these in `@afldb/acquisition`.

## 6. Test-process safety (ADR 0005)

No test can reach a non-test database: `tests/setup.ts` applies `applyTestDsnPolicy`, the database
clients refuse a non-`_test` database inside a test process, and `loadEnv()` does not rehydrate
connection variables from `.env` inside a test process. Outside a test process nothing changes.

## 7. Decisions

ADRs 0001-0011 in `docs/v2/adr/` record plan decisions D1-D11; ADRs 0006-0011 are accepted but
not implemented yet, and say so.
