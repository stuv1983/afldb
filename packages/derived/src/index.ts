/**
 * @afldb/derived — AFLDB V2 database-derived results (docs/v2/plan.md §3 D1, D6, D7).
 *
 * May import @afldb/domain and @afldb/db. Stage 4 adds the Coleman Medal derivation (plan D6,
 * ADR 0006) and the Brownlow reconciliation (plan D7, ADR 0007). Each workstream inserts its
 * exports directly below its own anchor line; keep the anchors.
 */
// @v2-stage4:coleman
export {
  COLEMAN_DERIVATION_VERSION,
  COLEMAN_INPUT_FORMAT,
  COLEMAN_INPUT_FORMAT_VERSION,
  COLEMAN_REFUSAL_CODES,
  COLEMAN_REQUIRED_CONTRACT_KEYS,
  ColemanContractError,
  colemanKey,
  deriveColeman,
  parseColemanContract,
  serialiseColemanDerivation,
  type ColemanContract,
  type ColemanDerivation,
  type ColemanDerivationInput,
  type ColemanDerivationInputs,
  type ColemanDerivationOutcome,
  type ColemanGoalFact,
  type ColemanId,
  type ColemanIdentityRow,
  type ColemanLeaderboardEntry,
  type ColemanMatchRow,
  type ColemanRefusal,
  type ColemanRefusalCode,
  type ColemanSeasonState,
  type ColemanWinner,
} from './coleman';
export {
  COLEMAN_COMPARISON_CATEGORIES,
  COLEMAN_COMPARISON_REPORT_FORMAT,
  COLEMAN_COMPARISON_REPORT_VERSION,
  COLEMAN_COMPARISON_REQUIRED,
  buildColemanComparisonReport,
  serialiseColemanComparisonReport,
  validateColemanComparisonReport,
  type ColemanComparisonCategory,
  type ColemanComparisonInput,
  type ColemanComparisonReport,
  type ColemanComparisonSeason,
  type ColemanReportDerivedWinner,
  type ColemanReportStoredRow,
  type ColemanStoredWinner,
} from './coleman-comparison';
// @v2-stage4:brownlow-reconciliation
export * from './brownlow-reconciliation';
export * from './brownlow-reconciliation-report';
