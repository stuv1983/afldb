# AFLDB V2 — architecture overview (implemented state)

Status: describes what exists in `D:\dev\afldbV2` at the close of Stage 3 (2026-10-19). Planned
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
| `@afldb/domain` | fixture status and round vocabulary, finals round codes, `isFixtureRoundType`, `isFixtureStatus`; `ImportBatchId`, `asImportBatchId`; the historical baseline manifest spec, sealed-season rule, validation and comparator (Stage 2); the coverage registry (`COVERAGE_REGISTRY`, `validateCoverageRegistry`, `checkCoverageEvidence`, `renderCoverageMatrix`) and the seal decision (`evaluateSeasonWrite`, `assertSeasonWritable`, `AUDITED_CORRECTION_WORKFLOWS`) (Stage 3) | re-exports of `src/lib/fixtures/spec.ts`, `src/lib/import-batch-id.ts` (both pure leaf modules); `packages/domain/src/historical-manifest.ts`, `coverage-registry.ts`, `season-seal.ts` (new in V2) |
| `@afldb/db` | `assertTestProcessDsn`, `testProcessDsnRefusal`, `isTestProcess`; the read-only manifest producer (`produceManifest`, `resolveProducerTarget`; never run) | re-export of `src/db/test-process-guard.ts` (new in V2, ADR 0005); `packages/db/src/historical-manifest-producer.ts` (new in V2) |
| `@afldb/acquisition` | the source-family registry contract; (Stage 3) the pipeline stage contract `AFL_API_PIPELINE` and stage map (§9), `replayAflApiSnapshot`/`aflApiPlanDigest`, the reconciliation report (`buildAflApiReconciliationReport`, validator, JSON Schema), the fixture contract (`classifyAflApiFixtureStatus`, `evaluateAflApiFixtureProjection`, `detectAflApiFixtureCollisions`), and re-exports of the pure/read-only stage code (client, rate limiter, season discovery and enumeration, snapshot readers, `claimSnapshotDir`, bundle emitters, `reconcile`) | re-exports of `src/lib/acquisition/*` modules whose runtime import closure reaches no `src/db/**`, `server-only`, `postgres` or writer module (`tests/v2-acquisition-pipeline.test.ts`); writers (settle, canonical apply, observation store, derived recompute) are cited by path in the stage contract, never re-exported (plan §7 R-016); `packages/acquisition/src/{pipeline,stage-map,replay,reconciliation-report,fixture-contract}.ts` (new in V2) |
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
  (`src/lib/acquisition/afl-api-ingestion-control.ts`). Stage 3 maps them as the stages of
  `@afldb/acquisition` (§9), enforces the historical seal at the three settle CLIs before any
  database client opens (except the Brownlow completed-season backtest, which first opens a client to prove the database is `afldb_test`; `tools/current-season/settle-season-seal.ts`, V2-GAP-006 narrowed), and
  proves that the acquire side imports no writer. Coverage per season and family:
  `docs/v2/coverage-matrix.md`. The AFL API fixtures writer is not built (V2-GAP-008, cutover
  blocker).

## 6. Test-process safety (ADR 0005)

No test can reach a non-test database: `tests/setup.ts` applies `applyTestDsnPolicy`, the database
clients refuse a non-`_test` database inside a test process, and `loadEnv()` does not rehydrate
connection variables from `.env` inside a test process. Outside a test process nothing changes.

## 7. Historical baseline (Stage 2)

The sealed historical baseline (seasons 1897-2025 today) is defined in
`docs/v2/historical-baseline.md`, its provenance model in `docs/v2/provenance.md`, and its
content-free verification manifest in `docs/v2/historical-manifest-spec.md`. The CLI is
`tools/v2/historical-manifest.ts` (`compare` offline; `produce` read-only and never run in Launch
A). Table ownership is drafted in `docs/v2/db-ownership-matrix.md`.

## 8. Decisions

ADRs 0001-0011 in `docs/v2/adr/` record plan decisions D1-D11; ADRs 0006-0011 are accepted but
not implemented yet, and say so.

## 9. AFL API pipeline stage map (Stage 3)

Generated from the `@afldb/acquisition` stage contract by `tools/v2/acquisition-stage-map.ts`;
a test fails if this table and the code disagree (every cited `path:line` must hold the export).

<!-- stage-map:begin -->
| Stage | Location | Symbol | Writes |
| --- | --- | --- | --- |
| acquire | `src/lib/acquisition/afl-api-client.ts:90` | `planAflApiTokenRequest` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:116` | `planAflApiSeasonMatchesRequest` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:131` | `planAflApiCompSeasonsRequest` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:166` | `planAflApiPlayerStatsRequest` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:174` | `planAflApiMatchRosterRequest` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:182` | `planAflApiBrownlowSeasonRequest` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:398` | `requestAflApi` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:494` | `fetchAflApiToken` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:535` | `fetchAflApiCfsResource` | nothing |
| acquire | `src/lib/acquisition/afl-api-client.ts:632` | `selectAflApiMatches` | nothing |
| acquire | `src/lib/acquisition/afl-api-season-discovery.ts:118` | `parseAflApiCompSeasons` | nothing |
| acquire | `src/lib/acquisition/afl-api-season-discovery.ts:182` | `proposeAflApiSeasons` | nothing |
| acquire | `src/lib/acquisition/afl-api-acquisition-constants.ts:28` | `AFL_API_FIXTURE_ACQUISITION_KIND` | nothing |
| acquire | `src/lib/acquisition/afl-api-acquisition-constants.ts:38` | `isAflApiBrownlowEnabled` | nothing |
| acquire | `tools/current-season/acquire-afl-api.ts:96` | `parseAcquireArgs` | nothing |
| acquire | `tools/current-season/acquire-afl-api.ts:225` | `runAcquisition` | nothing |
| acquire | `tools/current-season/acquire-afl-api-brownlow.ts:67` | `parseAcquireBrownlowArgs` | nothing |
| acquire | `tools/current-season/acquire-afl-api-brownlow.ts:144` | `runBrownlowAcquisition` | nothing |
| snapshot | `src/lib/acquisition/snapshot-dir.ts:23` | `claimSnapshotDir` | snapshot_files |
| snapshot | `tools/current-season/acquire-afl-api.ts:138` | `buildAflApiLabel` | snapshot_files |
| snapshot | `tools/current-season/acquire-afl-api.ts:435` | `cleanupPartialSnapshot` | snapshot_files |
| snapshot | `tools/current-season/acquire-afl-api-brownlow.ts:84` | `buildAflApiBrownlowLabel` | snapshot_files |
| snapshot | `tools/current-season/acquire-afl-api-brownlow.ts:265` | `cleanupPartialBrownlowSnapshot` | snapshot_files |
| snapshot | `src/lib/acquisition/afl-api-snapshot.ts:40` | `aflApiSnapshotRoot` | snapshot_files |
| snapshot | `src/lib/acquisition/afl-api-snapshot.ts:55` | `verifyAflApiSnapshotManifest` | snapshot_files |
| snapshot | `src/lib/acquisition/afl-api-snapshot.ts:99` | `aflApiUnitSourcesFrom` | snapshot_files |
| snapshot | `src/lib/acquisition/afl-api-snapshot.ts:134` | `aflApiSeasonFeedTextFrom` | snapshot_files |
| snapshot | `src/lib/acquisition/afl-api-snapshot.ts:152` | `aflApiSnapshotManifestSha256` | snapshot_files |
| snapshot | `packages/acquisition/src/replay.ts:79` | `replayAflApiSnapshot` | snapshot_files |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:329` | `emitAflApiMatch` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:533` | `emitAflApiPlayerMatchStats` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:726` | `emitAflApiMatchRoster` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:834` | `emitAflApiBrownlowMatchVotes` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:928` | `emitAflApiBrownlowLeaderboard` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:1180` | `buildAflApiMatchBundle` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:1296` | `buildAflApiSettleRecords` | staging |
| validate_stage | `src/lib/acquisition/settle-afl-api.ts:241` | `buildAflApiSettleBundle` | staging |
| validate_stage | `src/lib/acquisition/afl-api-season-enumeration.ts:156` | `assessAflApiSeasonEnumeration` | staging |
| validate_stage | `src/lib/acquisition/observations.ts:128` | `canonicalJson` | staging |
| validate_stage | `src/lib/acquisition/observation-store.ts:60` | `persistSourceObservation` | staging |
| resolve_identity | `src/lib/acquisition/afl-api-bundle.ts:215` | `parseAflApiIdentities` | nothing |
| resolve_identity | `src/lib/acquisition/afl-api-rounds.ts:135` | `translateAflRound` | nothing |
| resolve_identity | `src/lib/acquisition/afl-api-match-resolver.ts:142` | `resolveAflApiMatch` | nothing |
| resolve_identity | `src/lib/acquisition/afl-api-player-resolver.ts:59` | `resolveAflApiPlayer` | nothing |
| resolve_identity | `src/lib/acquisition/afl-api-fixture-identity.ts:294` | `resolveAflApiMatchViaFixtureObservation` | nothing |
| resolve_identity | `packages/acquisition/src/fixture-contract.ts:112` | `classifyAflApiFixtureStatus` | nothing |
| resolve_identity | `packages/acquisition/src/fixture-contract.ts:230` | `evaluateAflApiFixtureProjection` | nothing |
| resolve_identity | `packages/acquisition/src/fixture-contract.ts:479` | `detectAflApiFixtureCollisions` | nothing |
| reconcile | `src/lib/acquisition/reconciliation.ts:467` | `reconcile` | nothing |
| reconcile | `src/lib/acquisition/afl-api-settle-plan.ts:520` | `planAflApiMatchUnit` | nothing |
| reconcile | `src/lib/acquisition/afl-api-brownlow.ts:1360` | `reconcileAflApiBrownlowSeason` | nothing |
| reconcile | `packages/acquisition/src/reconciliation-report.ts:136` | `buildAflApiReconciliationReport` | nothing |
| reconcile | `packages/acquisition/src/reconciliation-report.ts:248` | `validateAflApiReconciliationReport` | nothing |
| promote | `tools/current-season/settle-afl-api.ts:123` | `loadAflApiSettleBundle` | canonical |
| promote | `tools/current-season/settle-afl-api.ts:225` | `runAflApiSettleCli` | canonical |
| promote | `tools/current-season/settle-season-seal.ts:30` | `refuseSealedSeasonForSettle` | canonical |
| promote | `packages/domain/src/season-seal.ts:122` | `evaluateSeasonWrite` | canonical |
| promote | `packages/domain/src/season-seal.ts:168` | `assertSeasonWritable` | canonical |
| promote | `src/lib/acquisition/settle-core.ts:392` | `acquireSettlePromotionGate` | canonical |
| promote | `src/lib/acquisition/settle-afl-api.ts:1973` | `runSettleAflApi` | canonical |
| promote | `src/lib/acquisition/settle-afl-api.ts:1969` | `normaliseAflApiCountersAfterFullRollback` | canonical |
| promote | `src/lib/acquisition/afl-api-brownlow.ts:1415` | `runSettleAflApiBrownlow` | canonical |
| promote | `src/lib/acquisition/canonical-apply.ts:1041` | `applyCanonicalUnit` | canonical |
| derive | `src/lib/acquisition/settle-core.ts:297` | `runDerivedRecomputeWithDeadlockRetry` | derived |
| derive | `src/db/queries/player-derived.ts:46` | `recomputePlayerDerivedStats` | derived |
| derive | `src/db/queries/player-derived.ts:435` | `recomputeClubSeasons` | derived |
| derive | `src/db/queries/player-derived.ts:537` | `recomputeSeasonMetadata` | derived |
| derive | `src/db/queries/player-derived.ts:383` | `recomputeSeasonBrownlowStatus` | derived |
| derive | `src/db/queries/player-derived.ts:678` | `recomputeBrownlowCoverage` | derived |
<!-- stage-map:end -->
