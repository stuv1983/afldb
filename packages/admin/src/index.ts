/**
 * @afldb/admin — AFLDB V2 restricted administration services (docs/v2/plan.md §3 D1, D8, D9).
 *
 * May import @afldb/domain and @afldb/db. Re-exports the existing Admin Centre capability policy
 * (AFLDB-ISSUE-155), which every audited admin service will check.
 */
export {
  hasCapability,
  type Capability,
  type CapabilityRole,
  type CapabilityViewer,
} from '@/lib/auth/capabilities';

// Curated awards (AFLDB V2 Stage 4, docs/v2/adr/0008-curated-awards.md): the audited proposal ->
// validation -> review -> transactional approval workflow. Pure services over the @afldb/db
// SqlExecutor port; the production promotion port lives in src/db/queries/award-proposals.ts and
// is NOT imported here (it is server-only).
export {
  BROWNLOW_AWARD_SLUG,
  CURATED_AWARD_TRANSITIONS,
  CuratedAwardError,
  MAX_SEASON,
  MIN_SEASON,
  PENDING_STATUSES,
  PROPOSAL_ACTIONS,
  PROPOSAL_SOURCE_KINDS,
  APPROVED_REVISION_NOTE_MIN_LENGTH,
  PROPOSAL_STATUSES,
  SELF_APPROVAL_ATTESTATION_MIN_LENGTH,
  TERMINAL_STATUSES,
  assertCanEditAwards,
  assertCanReadAwards,
  assertTransition,
  checkDecisionNote,
  decideFourEyes,
  isLegalTransition,
  normaliseProposalInput,
  splitPlayerIdentity,
  validateAwardProposal,
  valuesToJson,
  type CuratedAwardErrorCode,
  type CuratedAwardsViewer,
  type FourEyesDecision,
  type ProposalAction,
  type ProposalInput,
  type ProposalSourceKind,
  type ProposalStatus,
  type ProposalValues,
  type TransitionEdge,
  type ValidationCode,
  type ValidationFacts,
  type ValidationIssue,
  type ValidationResult,
} from './curated-awards-model';
export {
  approveProposal,
  createProposal,
  createProposalsFromFile,
  listProposals,
  readProposalHistory,
  rejectProposal,
  reviseApprovedProposal,
  reviseProposal,
  validateProposal,
  type ApproveDependencies,
  type ApprovedWinnerRevisionPort,
  type ApprovedWinnerRevisionRequest,
  type ApprovedWinnerRevisionResult,
  type AwardPromotionPort,
  type AwardPromotionRequest,
  type AwardPromotionResult,
  type CreateProposalInput,
  type DecisionInput,
  type DecisionRecord,
  type ProposalFilter,
  type ProposalHistory,
  type ProposalRecord,
  type ReviseApprovedDependencies,
  type ReviseApprovedInput,
  type ReviseApprovedResult,
  type ReviseInput,
  type ServiceOptions,
} from './curated-awards';
export {
  AWARD_PROPOSAL_FILE_FORMAT,
  AWARD_PROPOSAL_FILE_VERSION,
  FILE_SOURCE_KINDS,
  MAX_FILE_ROWS,
  parseAwardProposalFile,
  parseCsvRecords,
  type AwardProposalFileDefaults,
  type AwardProposalFileFormat,
  type FileRowError,
  type ParsedAwardProposalFile,
} from './curated-awards-file';
