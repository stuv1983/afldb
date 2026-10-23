# AFLDB V2 — architecture overview (implemented state)

Status: describes what exists in `D:\dev\afldbV2` at the close of Stage 6, the final V2 stage (2026-10-19). Planned
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
legacy/offline/  quarantined offline tools (Stage 4)    imported only by legacy/**
```

## 2. Application mapping

| Logical unit | Physical location | Runs as |
|---|---|---|
| `apps/web` | repository root: `src/app` (52 public pages, 56 admin pages, 19 route handlers, 30 server-action files), `src/components`, `src/search`, `src/db/queries` (74 modules), `src/lib` (118 files) | `deploy/afldb.service` → `deploy/server-cluster.mjs` |
| `apps/worker` | `tools/current-season/*` (AFL API acquire/settle CLIs) | `deploy/afldb-settle-afl-api.{service,timer,sh}` (05:00 nightly), `deploy/afldb-settle-afl-api-brownlow.{service,timer,sh}` (every 5 minutes) |
| legacy runtime ingestion | AFL Tables nightly settle; the email-intake timer posting to a retired route | classified in `docs/v2/legacy-disposition.md` (Stage 4); the CSV, submission, email-intake, Squiggle/Kali and AFL Tables trigger admin paths refuse since Stage 5; the settle stays until the ISSUE-316 cutover (V2-GAP-011) and the timer until Stage 6 (V2-GAP-013) |
| offline legacy tools | `legacy/offline/**` (the Squiggle/Kali CLI), `tools/migration/*`, `tools/rebuild/**` | manual only; no scheduler, no runtime import (guards in `tests/v2-module-boundaries.test.ts`); `npm run current-season:update` refuses |

Counts are from `docs/v2/inventory.md`, where each has its re-derivation command; Stage 5 added 5
admin pages (`/admin/operations/**`) and 2 server-action files, and deleted 4 admin components.

## 3. Packages as they exist

| Package | Exports | Source of each export |
|---|---|---|
| `@afldb/domain` | fixture status and round vocabulary, finals round codes, `isFixtureRoundType`, `isFixtureStatus`; `ImportBatchId`, `asImportBatchId`; the historical baseline manifest spec, sealed-season rule, validation and comparator (Stage 2); the coverage registry (`COVERAGE_REGISTRY`, `validateCoverageRegistry`, `checkCoverageEvidence`, `renderCoverageMatrix`) and the seal decision (`evaluateSeasonWrite`, `assertSeasonWritable`, `AUDITED_CORRECTION_WORKFLOWS`) (Stage 3; Stage 4 added the audited workflow ids for derived-award publication and curated-award approval); the retired-entry registry (`RETIRED_ENTRIES`, `findRetiredEntry`, `renderRetiredEntryRefusal`) (Stage 4); the retired admin surfaces (`RETIRED_ADMIN_SURFACES`, `findRetiredAdminSurface`, `renderRetiredAdminRefusal`, `retiredAdminRefusal`, `LEGACY_RETIRED_CODE`) (Stage 5) | re-exports of `src/lib/fixtures/spec.ts`, `src/lib/import-batch-id.ts` (both pure leaf modules); `packages/domain/src/historical-manifest.ts`, `coverage-registry.ts`, `season-seal.ts`, `legacy-retirement.ts` (new in V2) |
| `@afldb/db` | `assertTestProcessDsn`, `testProcessDsnRefusal`, `isTestProcess`; the read-only manifest producer (`produceManifest`, `resolveProducerTarget`; never run); (Stage 4) the SQL port `SqlExecutor`, `TransactionalSqlExecutor`, the postgres.js adapters `postgresExecutor`, `postgresTransactionExecutor`, `nativeTransactionOf` | re-export of `src/db/test-process-guard.ts` (new in V2, ADR 0005); `packages/db/src/historical-manifest-producer.ts`, `sql-executor.ts` (new in V2) |
| `@afldb/acquisition` | the source-family registry contract; (Stage 3) the pipeline stage contract `AFL_API_PIPELINE` and stage map (§9), `replayAflApiSnapshot`/`aflApiPlanDigest`, the reconciliation report (`buildAflApiReconciliationReport`, validator, JSON Schema), the fixture contract (`classifyAflApiFixtureStatus`, `evaluateAflApiFixtureProjection`, `detectAflApiFixtureCollisions`), and re-exports of the pure/read-only stage code (client, rate limiter, season discovery and enumeration, snapshot readers, `claimSnapshotDir`, bundle emitters, `reconcile`) | re-exports of `src/lib/acquisition/*` modules whose runtime import closure reaches no `src/db/**`, `server-only`, `postgres` or writer module (`tests/v2-acquisition-pipeline.test.ts`); writers (settle, canonical apply, observation store, derived recompute) are cited by path in the stage contract, never re-exported (plan §7 R-016); `packages/acquisition/src/{pipeline,stage-map,replay,reconciliation-report,fixture-contract}.ts` (new in V2) |
| `@afldb/derived` | (Stage 4) the Coleman derivation (`deriveColeman`, `parseColemanContract`, `colemanKey`, `serialiseColemanDerivation`, `COLEMAN_DERIVATION_VERSION`), the comparison report (`buildColemanComparisonReport`, validator), the audited publisher (`publishColemanResult`, `checkColemanPublication`, `planColemanPublication`; ADR 0006); the Brownlow reconciliation (`reconcileBrownlowSeason`, `validateBrownlowReconciliationInput`) and its report (`serialiseBrownlowReconciliationReport`, `validateBrownlowReconciliationReport`, JSON Schema; ADR 0007) | `packages/derived/src/{coleman,coleman-comparison,coleman-publication,brownlow-reconciliation,brownlow-reconciliation-report}.ts` (new in V2) |
| `@afldb/admin` | `hasCapability`, `Capability`, `CapabilityRole`, `CapabilityViewer`; (Stage 4) the curated award workflow: `createProposal`, `createProposalsFromFile`, `validateProposal`, `approveProposal`, `rejectProposal`, `reviseProposal`, `listProposals`, `readProposalHistory`, `parseAwardProposalFile`, `CURATED_AWARD_TRANSITIONS`, `assertTransition`, `validateAwardProposal` (ADR 0008) | re-export of `src/lib/auth/capabilities.ts`; `packages/admin/src/{curated-awards-model,curated-awards,curated-awards-file}.ts` (new in V2). The production promotion port is the server-only `src/db/queries/award-proposals.ts` (calls `insertAwardWinner`), never imported by the package |
| `@afldb/testing` | `applyTestDsnPolicy` and DSN helpers; the module-boundary checker; (Stage 4) the legacy guards (`LEGACY_RUNTIME_MODULES`, `legacyRuntimeEdges`, `publicRuntimeLegacyReach`, `offlineToolImports`, `scheduledLegacyReferences`, `retiredEntryWiring`) and the in-memory PGlite helper (`createInMemoryPglite`, `pgliteExecutor`; ADR 0012) | `packages/testing/src/dsn-policy.ts`, `module-boundaries.ts`, `pglite.ts` (new in V2) |

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

ADRs 0001-0012 in `docs/v2/adr/` record plan decisions D1-D11 and the PGlite test database
(0012). ADRs 0006 (Coleman), 0007 (Brownlow reconciliation), 0008 (curated awards) and 0010
(legacy disposition) are implemented in Stage 4, each stating what is unexecuted; 0009 (admin
operations centre) is implemented in Stage 5 (§10). Migrations from
Stage 4: `111_curated_award_proposals.sql`, `112_derived_award_results.sql` (ADR 0004; executed
only on in-memory PGlite, unexecuted on PostgreSQL, V2-GAP-017).

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
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:838` | `emitAflApiBrownlowMatchVotes` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:933` | `emitAflApiBrownlowLeaderboard` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:1185` | `buildAflApiMatchBundle` | staging |
| validate_stage | `src/lib/acquisition/afl-api-bundle.ts:1301` | `buildAflApiSettleRecords` | staging |
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
| reconcile | `src/lib/acquisition/afl-api-brownlow.ts:1397` | `reconcileAflApiBrownlowSeason` | nothing |
| reconcile | `packages/acquisition/src/reconciliation-report.ts:136` | `buildAflApiReconciliationReport` | nothing |
| reconcile | `packages/acquisition/src/reconciliation-report.ts:248` | `validateAflApiReconciliationReport` | nothing |
| promote | `tools/current-season/settle-afl-api.ts:123` | `loadAflApiSettleBundle` | canonical |
| promote | `tools/current-season/settle-afl-api.ts:225` | `runAflApiSettleCli` | canonical |
| promote | `tools/current-season/settle-season-seal.ts:30` | `refuseSealedSeasonForSettle` | canonical |
| promote | `packages/domain/src/season-seal.ts:124` | `evaluateSeasonWrite` | canonical |
| promote | `packages/domain/src/season-seal.ts:170` | `assertSeasonWritable` | canonical |
| promote | `src/lib/acquisition/settle-core.ts:392` | `acquireSettlePromotionGate` | canonical |
| promote | `src/lib/acquisition/settle-afl-api.ts:1973` | `runSettleAflApi` | canonical |
| promote | `src/lib/acquisition/settle-afl-api.ts:1969` | `normaliseAflApiCountersAfterFullRollback` | canonical |
| promote | `src/lib/acquisition/afl-api-brownlow.ts:1502` | `runSettleAflApiBrownlow` | canonical |
| promote | `src/lib/acquisition/canonical-apply.ts:1041` | `applyCanonicalUnit` | canonical |
| derive | `src/lib/acquisition/settle-core.ts:297` | `runDerivedRecomputeWithDeadlockRetry` | derived |
| derive | `src/db/queries/player-derived.ts:47` | `recomputePlayerDerivedStats` | derived |
| derive | `src/db/queries/player-derived.ts:425` | `recomputeClubSeasons` | derived |
| derive | `src/db/queries/player-derived.ts:527` | `recomputeSeasonMetadata` | derived |
| derive | `src/db/queries/player-derived.ts:379` | `recomputeSeasonBrownlowStatus` | derived |
| derive | `src/db/queries/player-derived.ts:670` | `recomputeBrownlowCoverage` | derived |
<!-- stage-map:end -->

## 10. Admin operations centre (Stage 5)

Pages `/admin/operations` (read-only overview), `/admin/operations/awards`, `/awards/[id]`,
`/coleman` and `/brownlow` (`src/app/admin/operations/**`; operating guide
`docs/v2/admin-operations.md`). Layering: page or server action (capability guard first) ->
`src/lib/admin/operations-centre.ts` (server-only; capability checked again; one transaction per
mutation through the Stage 4 services; best-effort activity-trail row after it settles) ->
`@afldb/admin` / `@afldb/derived` over the `SqlExecutor` port, with the server-only adapters
`withAwardProposalExecutor` and `awardWinnerPromotionPort` (`src/db/queries/award-proposals.ts`),
the read loaders `src/db/queries/{coleman-inputs,brownlow-reconciliation-inputs}.ts` and the
sealed-season loader `src/lib/seasons/sealed-seasons.ts`. Presentational components are pure
(`_components/*`); `OperationsClientForms.tsx` is the only client module. Retired legacy admin
surfaces refuse through `src/lib/admin/retired-admin.ts` (plan §7 R-030). Nothing here has run on
PostgreSQL or been rendered in a browser (V2-GAP-017, V2-GAP-022).

## 11. Shadow rehearsal tooling (Stage 6)

Offline comparison and shadow-only capture for the operator-run rehearsal in
`docs/v2/shadow-rehearsal.md`. None of it has run against a database.

| Piece | Where | Role |
|---|---|---|
| shadow target policy | `packages/domain/src/shadow-target.ts` (`@afldb/domain`) | only `afldb_v2_shadow[_<tag>]_test` is a target; reserved names refused by name; pure (plan §7 R-044) |
| row-count format | `packages/domain/src/table-row-counts.ts` | `afldb.v2.table-row-counts` v1 and `V2_ADDED_TABLES` (migrations 111/112) |
| row-count producer | `packages/db/src/table-row-counts-producer.ts` (`@afldb/db`) | read-only census over an injected query function, with the manifest producer's discipline |
| parity core | `packages/derived/src/shadow-parity.ts` (`@afldb/derived`) | policy `v2.parity.1`: five checks; report `afldb.v2.shadow-parity-report` v1; coverage export `afldb.v2.coverage-registry-export` v1 (plan §7 R-045) |
| CLIs | `tools/v2/shadow-parity.ts` (offline `compare`, `coverage-export`), `tools/v2/shadow-capture.ts` (`row-counts`), `tools/v2/shadow-award-reports.ts` (`coleman`, `brownlow`; run with `--conditions=react-server` because it reuses the server-only Stage 5 loaders), `tools/v2/shadow-guard.ts` (`check`) | thin, testable entry points; the capture tools refuse every non-shadow target and have no override flag |

The parity core lives in `@afldb/derived` because that is the only module allowed to see both the
historical manifest (`@afldb/domain`) and the award report formats (`@afldb/derived`). Operational
documents: `docs/v2/shadow-rehearsal.md`, `docs/v2/cutover-runbook.md` (with the migration plan),
`docs/v2/rollback-runbook.md` (backup and rollback), `docs/v2/go-no-go.md`,
`docs/v2/risk-register.md`, `docs/v2/final-report.md`.
