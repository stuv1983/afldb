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
