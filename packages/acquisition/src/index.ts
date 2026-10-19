/**
 * @afldb/acquisition — AFLDB V2 acquisition boundary (docs/v2/plan.md §3 D1).
 *
 * May import @afldb/domain and @afldb/db. Never imported by src/app or src/components.
 * Acquisition never writes final tables; writes go through promotion/settle. The AFL API
 * facade over the existing client/snapshot/staging/resolve/promote code is Stage 3 work; until
 * then this package re-exports only the existing source-family registry contract.
 */
export {
  DEFAULT_CORROBORATION_POLICY,
  SourceFamilyContractError,
  areCoSources,
  countIndependentWitnesses,
  findSourceFamily,
  getSourceFamily,
  independenceGroups,
  isPromotable,
  parseSourceFamilyRegistry,
  type SourceFamilyContract,
  type SourceFamilyRegistry,
} from '@/lib/acquisition/source-families';

// Stage 3 (AFL API pipeline) export blocks. Each workstream inserts its exports directly
// below its own anchor line; keep the anchors.
// @v2-stage3:pipeline-facade
// @v2-stage3:fixture-contract
// AFL API fixture identity contract (AFLDB-ISSUE-229 safe surrounding contracts; pure, no writer).
export {
  AFL_API_FIXTURE_DEFERRED_STATUSES,
  AFL_API_FIXTURE_SCHEDULED_STATUSES,
  classifyAflApiFixtureStatus,
  detectAflApiFixtureCollisions,
  evaluateAflApiFixtureProjection,
  type AflApiFixtureCollision,
  type AflApiFixtureCollisionCode,
  type AflApiFixtureContractContext,
  type AflApiFixtureEvaluation,
  type AflApiFixtureProjection,
  type AflApiFixtureRefusal,
  type AflApiFixtureRefusalCode,
  type AflApiFixtureStatusClass,
} from './fixture-contract';
// @v2-stage3:reconciliation-report
