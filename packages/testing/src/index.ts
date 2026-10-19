/**
 * @afldb/testing — AFLDB V2 test fixtures, contract checks and isolated test helpers
 * (docs/v2/plan.md §3 D1, D5). Only tests/** may import it.
 */
export {
  APP_DSN,
  LIBPQ_CONNECTION_VARIABLES,
  TEST_DSN,
  TEST_IMPORT_DSN,
  applyTestDsnPolicy,
  databaseNameOf,
  isDsnVariable,
  namesTestDatabase,
  type DsnEnv,
  type DsnPolicyResult,
} from './dsn-policy';
export {
  ALLOWED_PACKAGE_DEPENDENCIES,
  IMPURE_EXTERNALS,
  PACKAGE_MODULES,
  boundaryRuleBroken,
  checkBoundaries,
  extractImportSpecifiers,
  layerOf,
  purityViolations,
  resolveSpecifier,
  type BoundaryViolation,
  type Layer,
  type PackageModule,
  type ResolvedImport,
  type SourceFile,
} from './module-boundaries';
export {
  createInMemoryPglite,
  pgliteExecutor,
  type InMemoryPglite,
} from './pglite';
