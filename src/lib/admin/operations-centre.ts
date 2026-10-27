import 'server-only';

import {
  MAX_SEASON,
  MIN_SEASON,
  CuratedAwardError,
  approveProposal,
  assertCanEditAwards,
  createProposalsFromFile,
  hasCapability,
  listProposals,
  readProposalHistory,
  rejectProposal,
  reviseApprovedProposal,
  validateProposal,
  type ApprovedWinnerRevisionPort,
  type AwardProposalFileDefaults,
  type AwardProposalFileFormat,
  type AwardPromotionPort,
  type CuratedAwardErrorCode,
  type CuratedAwardsViewer,
  type ProposalFilter,
  type ProposalHistory,
  type ProposalInput,
  type ProposalRecord,
  type ValidationIssue,
} from '@afldb/admin';
import type { TransactionalSqlExecutor } from '@afldb/db';
import {
  BROWNLOW_ELIGIBILITY_RULES,
  COLEMAN_PUBLICATION_WORKFLOW,
  buildColemanComparisonReport,
  deriveColeman,
  planColemanPublication,
  publishColemanResult,
  reconcileBrownlowSeason,
  ColemanContractError,
  type BrownlowEligibilityRule,
  type BrownlowReconciliationReport,
  type ColemanComparisonReport,
  type ColemanContract,
  type ColemanDerivationOutcome,
  type ColemanLeaderboardEntry,
  type ColemanProjectionPreview,
  type ColemanProjectionResult,
  type ColemanPublicationOutcome,
  type ColemanPublicationRefusalCode,
  type ColemanRefusal,
  type ColemanRefusalCode,
  type ColemanWinner,
} from '@afldb/derived';
// Launch F F-D stream A (Brownlow eligibility): a separate import, so the block above stays untouched.
import {
  BROWNLOW_ELIGIBILITY_VERDICTS,
  determineBrownlowMedal,
  type BrownlowEligibilityVerdict,
  type BrownlowEvidenceBasis,
  type BrownlowMedalDetermination,
  type BrownlowOutcome,
  type BrownlowSeasonState,
} from '@afldb/derived';
import {
  CORRECTION_NOTE_MAX_LENGTH,
  CORRECTION_NOTE_MIN_LENGTH,
  isSealedSeason,
  sealedSeasonsFrom,
  type SealedSeasons,
  type SeasonRegistry,
} from '@afldb/domain';

import {
  awardWinnerPromotionPort,
  awardWinnerRevisionPort,
  withAwardProposalExecutor,
} from '@/db/queries/award-proposals';
import {
  BrownlowInputError,
  loadBrownlowReconciliationInputWithEvidence,
  type BrownlowStagingEvidence,
} from '@/db/queries/brownlow-reconciliation-inputs';
import type { ProviderTeamIdentity } from '@/lib/brownlow/provider-team-club-map';
import { loadProviderTeamIdentities } from '@/lib/brownlow/provider-team-identities';
import {
  loadBrownlowEligibilityEvidence,
  recordBrownlowEligibilityDecision,
  type BrownlowEligibilityDecisionView,
  type BrownlowEligibilityRefusalCode,
  type BrownlowPlayerIdentityView,
} from '@/db/queries/brownlow-eligibility';
import {
  AFL_API_FINDING_SECTIONS,
  isAflApiFindingCursor,
  readAflApiSettleFindings,
  type AflApiFindingSection,
  type AflApiFindingsPage,
} from '@/db/queries/afl-api-settle-findings';
import { colemanAwardWinnerProjection, type ColemanAwardWinnerProjectionPort } from '@/db/queries/coleman-award-winners';
import {
  listColemanPublications,
  loadColemanContract,
  loadColemanDerivationInput,
  loadStoredColemanWinners,
  type ColemanPublicationRow,
} from '@/db/queries/coleman-inputs';
import { audit, type AdminUser } from '@/lib/auth/session';
import { SeasonRegistryError, loadSealedSeasons, loadSeasonRegistry } from '@/lib/seasons/sealed-seasons';

/**
 * The operations centre's SERVER CALLERS (AFLDB V2 Stage 5, plan D9; V2-GAP-021).
 *
 * This is the one place the audited, transactional, fail-closed `@afldb/admin` / `@afldb/derived`
 * services meet production: the postgres.js import connection (`withAwardProposalExecutor`), the
 * production promotion port (`awardWinnerPromotionPort`, the existing `insertAwardWinner`), the
 * sealed-season registry and the read loaders. Server actions and server-rendered pages call these
 * functions; nothing else should call the services.
 *
 * CONTRACT FOR EVERY FUNCTION
 *  - takes the signed-in {@link AdminUser} (from `requireCapability`) and an injectable `deps`;
 *  - returns `{ ok: true, ... } | { ok: false, code, error }` and NEVER throws to its caller. An
 *    unexpected error is logged (`console.error`) and returned as `code: 'unexpected'`;
 *  - checks the capability ITSELF, so it still refuses if a route guard were bypassed;
 *  - READS (`list…`, `read…`, `compare…`, `reconcile…`) write nothing, audit nothing (the existing
 *    convention: a read-only refresh writes no `auth_audit_log` row).
 *
 * AUDITING. Every MUTATION attempt writes exactly ONE best-effort `auth_audit_log` row via
 * `audit()` — success, `unchanged`, and every refusal (a capability refusal reached past the route
 * guard, a seal refusal, a stale proposal, an unexpected error): see {@link OPERATIONS_AUDIT_ACTIONS}.
 * It is written AFTER the transaction has settled and can never change the outcome: a failure is
 * `console.error`-ed and surfaced as `auditWarning` on the result (so an operator does not
 * resubmit), exactly the awards-actions pattern (src/app/admin/awards/actions.ts). The audit detail
 * carries ids, the season, the outcome and codes — never row content. The DURABLE, in-transaction
 * audit is the existing one: the proposal ledger (`award_proposal_decisions`) and, on approval,
 * `data_edits` via `insertAwardWinner`, for curated awards; `derived_award_results.correction` for
 * a Coleman publication. The `auth_audit_log` row is the activity trail beside it.
 *
 * NOT RUN against PostgreSQL from the V2 workstation (plan D2/R-017): tests/v2-admin-operations.test.ts
 * runs these callers over in-memory PGlite and stub tables only.
 */

/* ------------------------------------------------------------------ *
 * Result types
 * ------------------------------------------------------------------ */

export type OperationErrorCode =
  | CuratedAwardErrorCode
  | Exclude<ColemanPublicationRefusalCode, 'capability_denied'>
  /** The operator did not attest that the season is settled (plan R-022). */
  | 'settled_required'
  /** `data/reference/seasons.json` is unreadable or malformed: the seal cannot be evaluated. */
  | 'season_registry_unavailable'
  /** `data/reference/coleman-derivation.json` is unreadable or malformed. */
  | 'coleman_contract_unavailable'
  /** The staged Brownlow rows of one match contradict each other; nothing was reconciled. */
  | 'brownlow_input_inconsistent'
  /** Launch F F-D: the typed refusals of a Brownlow eligibility decision (src/db/queries/brownlow-eligibility.ts). */
  | Exclude<BrownlowEligibilityRefusalCode, 'capability_denied'>
  | 'unexpected';

export type OperationFailure = {
  ok: false;
  code: OperationErrorCode;
  error: string;
  /** Validation issues behind an `invalid_file` / `stale_validation` refusal, when there are any. */
  issues?: ValidationIssue[];
  /** For `derivation_refused`: the Coleman derivation's own typed refusal code. */
  derivationCode?: ColemanRefusalCode;
  /** Present when the mutation's `auth_audit_log` row could not be written. */
  auditWarning?: string;
};

export type OperationSuccess<T extends object> = { ok: true; auditWarning?: string } & T;

export type OperationResult<T extends object> = OperationSuccess<T> | OperationFailure;

/** The `auth_audit_log.action` values the operations centre writes. */
export const OPERATIONS_AUDIT_ACTIONS = {
  curatedCreated: 'admin.curated_award_created',
  curatedValidated: 'admin.curated_award_validated',
  curatedApproved: 'admin.curated_award_approved',
  curatedRejected: 'admin.curated_award_rejected',
  curatedRevised: 'admin.curated_award_revised',
  curatedRefused: 'admin.curated_award_refused',
  colemanPublished: 'admin.coleman_published',
  colemanRefused: 'admin.coleman_publication_refused',
  brownlowEligibilityDecided: 'admin.brownlow_eligibility_decided',
  brownlowEligibilityRefused: 'admin.brownlow_eligibility_refused',
} as const;

/** Said when the activity-trail row could not be written. The change itself is already committed. */
export const AUDIT_WARNING =
  'The change was made, but its administrative activity audit could not be written. '
  + 'Do not submit it again; ask an administrator to reconcile the audit log.';

/* ------------------------------------------------------------------ *
 * Dependencies
 * ------------------------------------------------------------------ */

export type OperationsDeps = {
  /** Runs `work` with an import-role executor on one short-lived connection. */
  withExecutor: <T>(work: (executor: TransactionalSqlExecutor) => Promise<T>) => Promise<T>;
  /** The promotion port an approval writes `award_winners` through. */
  promotion: AwardPromotionPort;
  /** The port an approved-winner revision writes `award_winners` through (V2-GAP-018). */
  revision: ApprovedWinnerRevisionPort;
  /** The sealed range, read FRESH on every approval. Throws {@link SeasonRegistryError}. */
  loadSealed: () => SealedSeasons;
  /** The season registry (Coleman completeness, Brownlow season state). Throws {@link SeasonRegistryError}. */
  loadRegistry: () => SeasonRegistry;
  /** The Coleman derivation contract. Throws `ColemanContractError`. */
  loadContract: () => ColemanContract;
  /** The committed provider team identities (V2-GAP-023). Throws `ProviderTeamIdentityError`. */
  loadProviderTeamIdentities: () => readonly ProviderTeamIdentity[];
  now: () => Date;
};

function resolveDeps(deps?: Partial<OperationsDeps>): OperationsDeps {
  return {
    withExecutor: deps?.withExecutor ?? withAwardProposalExecutor,
    promotion: deps?.promotion ?? awardWinnerPromotionPort,
    revision: deps?.revision ?? awardWinnerRevisionPort,
    loadSealed: deps?.loadSealed ?? (() => loadSealedSeasons()),
    loadRegistry: deps?.loadRegistry ?? (() => loadSeasonRegistry()),
    loadContract: deps?.loadContract ?? (() => loadColemanContract()),
    loadProviderTeamIdentities: deps?.loadProviderTeamIdentities ?? (() => loadProviderTeamIdentities()),
    now: deps?.now ?? (() => new Date()),
  };
}

/* ------------------------------------------------------------------ *
 * Shared plumbing
 * ------------------------------------------------------------------ */

/** A refusal this module raises itself (the services raise their own typed errors). */
class OperationRefusal extends Error {
  readonly code: OperationErrorCode;

  readonly derivationCode?: ColemanRefusalCode;

  constructor(code: OperationErrorCode, message: string, derivationCode?: ColemanRefusalCode) {
    super(message);
    this.name = 'OperationRefusal';
    this.code = code;
    this.derivationCode = derivationCode;
  }
}

function viewerOf(admin: AdminUser): CuratedAwardsViewer {
  return { role: admin.role, canManageAdmins: admin.canManageAdmins, userId: admin.id };
}

function toFailure(error: unknown): OperationFailure {
  if (error instanceof OperationRefusal) {
    return {
      ok: false, code: error.code, error: error.message,
      ...(error.derivationCode === undefined ? {} : { derivationCode: error.derivationCode }),
    };
  }
  if (error instanceof CuratedAwardError) {
    return {
      ok: false, code: error.code, error: error.message,
      ...(error.issues.length > 0 ? { issues: [...error.issues] } : {}),
    };
  }
  if (error instanceof SeasonRegistryError) {
    return { ok: false, code: 'season_registry_unavailable', error: error.message };
  }
  if (error instanceof ColemanContractError) {
    return { ok: false, code: 'coleman_contract_unavailable', error: error.message };
  }
  if (error instanceof BrownlowInputError) {
    return { ok: false, code: 'brownlow_input_inconsistent', error: error.message };
  }
  console.error('Operations centre: unexpected error', error);
  return {
    ok: false,
    code: 'unexpected',
    error: 'The operation failed unexpectedly. Nothing from this request was committed; see the server log.',
  };
}

/** Best-effort activity-trail row. Resolves to a warning when it could not be written; never throws. */
async function writeAudit(
  admin: AdminUser,
  action: string,
  detail: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    await audit(action, detail, { userId: admin.id, label: admin.email });
    return undefined;
  } catch (error) {
    console.error(`Operations centre: failed to write the ${action} audit row`, error);
    return AUDIT_WARNING;
  }
}

const idOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

type MutationOutcome<T extends object> = { value: T; detail: Record<string, unknown> };

/**
 * Run one mutation and write exactly one audit row for its outcome (see the header). The audit is
 * written after `work` has settled (committed or rolled back) and cannot change what is returned.
 */
async function runMutation<T extends object>(
  admin: AdminUser,
  actions: { done: string; refused: string },
  request: Record<string, unknown>,
  work: () => Promise<MutationOutcome<T>>,
): Promise<OperationResult<T>> {
  let outcome: MutationOutcome<T>;
  try {
    outcome = await work();
  } catch (error) {
    const failure = toFailure(error);
    const warning = await writeAudit(admin, actions.refused, {
      ...request,
      outcome: 'refused',
      code: failure.code,
      ...(failure.derivationCode === undefined ? {} : { derivationCode: failure.derivationCode }),
      ...(failure.issues === undefined ? {} : { issueCodes: failure.issues.map((issue) => issue.code) }),
    });
    return warning === undefined ? failure : { ...failure, auditWarning: warning };
  }
  const warning = await writeAudit(admin, actions.done, { ...request, ...outcome.detail });
  return { ok: true, ...outcome.value, ...(warning === undefined ? {} : { auditWarning: warning }) };
}

/** Run one read; never audits. */
async function runRead<T extends object>(work: () => Promise<T>): Promise<OperationResult<T>> {
  try {
    return { ok: true, ...(await work()) };
  } catch (error) {
    return toFailure(error);
  }
}

function requireSeason(season: unknown): number {
  if (typeof season !== 'number' || !Number.isInteger(season) || season < MIN_SEASON || season > MAX_SEASON) {
    throw new OperationRefusal('invalid_input', `The season must be a whole year from ${MIN_SEASON} to ${MAX_SEASON}.`);
  }
  return season;
}

/* ------------------------------------------------------------------ *
 * Curated awards
 * ------------------------------------------------------------------ */

/** The undecided and decided proposals, newest first (`data.awards.read`). Writes nothing. */
export async function listCuratedQueue(
  admin: AdminUser,
  filter: ProposalFilter = {},
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ proposals: ProposalRecord[] }>> {
  const d = resolveDeps(deps);
  return runRead(async () => ({
    proposals: await d.withExecutor((executor) => listProposals(viewerOf(admin), executor, filter)),
  }));
}

/** Every revision of one proposal and every ledger row on any of them (`data.awards.read`). Writes nothing. */
export async function readCuratedHistory(
  admin: AdminUser,
  input: { proposalId: number },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ history: ProposalHistory }>> {
  const d = resolveDeps(deps);
  return runRead(async () => ({
    history: await d.withExecutor((executor) => readProposalHistory(viewerOf(admin), executor, input)),
  }));
}

/**
 * Validate a pending proposal against the database (`data.awards.edit`). Moves it to `validated` or
 * `validation_failed` and writes one ledger row; `validation` says which. Reversible: a pending
 * proposal can be validated again, revised, or rejected.
 */
export async function validateCurated(
  admin: AdminUser,
  input: { proposalId: number; decisionNote?: string | null },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ proposal: ProposalRecord; validation: 'validated' | 'validation_failed' }>> {
  const d = resolveDeps(deps);
  const viewer = viewerOf(admin);
  return runMutation(
    admin,
    { done: OPERATIONS_AUDIT_ACTIONS.curatedValidated, refused: OPERATIONS_AUDIT_ACTIONS.curatedRefused },
    { operation: 'validate', proposalId: idOrNull(input.proposalId) },
    async () => {
      assertCanEditAwards(viewer);
      const proposal = await d.withExecutor((executor) => validateProposal(viewer, executor, input, { now: d.now }));
      const validation = proposal.status === 'validated' ? 'validated' : 'validation_failed';
      return {
        value: { proposal, validation },
        detail: {
          season: proposal.season,
          outcome: validation,
          issueCodes: (proposal.validationResult?.issues ?? []).map((issue) => issue.code),
        },
      };
    },
  );
}

/**
 * Approve a validated proposal (`data.awards.edit`): ONE transaction that re-validates, passes the
 * season seal, writes the canonical `award_winners` row (with its `data_overrides` and `data_edits`
 * rows) through the production promotion port, sets the proposal `approved` and writes the ledger
 * row. `approved` is terminal for this action; correcting the approved winner afterwards is
 * {@link reviseApprovedCurated} (V2-GAP-018) or the existing replace/correct lifecycle in /admin/awards.
 *
 * FOUR EYES (V2-GAP-019): the creator of the revision may not approve it unless they are a super
 * admin and supply `selfApprovalAttestation`. The result carries `revalidatePaths` (V2-GAP-024): the
 * public pages the new winner moves, for the client to post to /admin/awards/revalidate.
 *
 * The sealed range is read from `data/reference/seasons.json` on EVERY call. A loader failure
 * refuses (`season_registry_unavailable`) before any connection is opened. An approval into a
 * sealed season needs a decision note of 20..2000 characters, else `season_sealed_correction_invalid`
 * and nothing is written.
 */
export async function approveCurated(
  admin: AdminUser,
  input: { proposalId: number; decisionNote?: string | null; selfApprovalAttestation?: string | null },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{
  proposal: ProposalRecord;
  entityKey: string;
  sealedSeason: boolean;
  selfApproval: boolean;
  revalidatePaths: string[];
}>> {
  const d = resolveDeps(deps);
  const viewer = viewerOf(admin);
  return runMutation(
    admin,
    { done: OPERATIONS_AUDIT_ACTIONS.curatedApproved, refused: OPERATIONS_AUDIT_ACTIONS.curatedRefused },
    { operation: 'approve', proposalId: idOrNull(input.proposalId) },
    async () => {
      // Capability first: a refused viewer must not even cause the registry to be read.
      assertCanEditAwards(viewer);
      const sealed = d.loadSealed();
      const approved = await d.withExecutor((executor) => approveProposal(
        viewer, executor, input, { promotion: d.promotion, sealed }, { now: d.now },
      ));
      const sealedSeason = isSealedSeason(sealed, approved.proposal.season);
      const selfApproval = approved.proposal.createdBy === viewer.userId;
      return {
        value: {
          proposal: approved.proposal,
          entityKey: approved.promotion.entityKey,
          sealedSeason,
          selfApproval,
          revalidatePaths: [...(approved.promotion.revalidatePaths ?? [])],
        },
        detail: {
          season: approved.proposal.season,
          outcome: 'approved',
          approvedEntityKey: approved.promotion.entityKey,
          sealedSeason,
          selfApproval,
        },
      };
    },
  );
}

/**
 * Revise an APPROVED proposal and the canonical winner it produced (`data.awards.edit`, V2-GAP-018):
 * ONE transaction that validates the new values, passes the season seal for the old and the new
 * season, changes `award_winners` through the production revision port (an in-place correction of the
 * non-identity fields, or a void plus a replacement when the award, season, player or player name
 * changes), supersedes the approved revision and records the new one as approved, with both ledger
 * rows. A decision note of 20..2000 characters is ALWAYS required. NOT reversible except by another
 * revision. The result carries `revalidatePaths` (V2-GAP-024) for the client to post to
 * /admin/awards/revalidate.
 */
export async function reviseApprovedCurated(
  admin: AdminUser,
  input: { proposalId: number; changes: Partial<ProposalInput>; decisionNote: string | null },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{
  proposal: ProposalRecord;
  entityKey: string;
  mode: 'correct' | 'replace';
  sealedSeason: boolean;
  revalidatePaths: string[];
}>> {
  const d = resolveDeps(deps);
  const viewer = viewerOf(admin);
  return runMutation(
    admin,
    { done: OPERATIONS_AUDIT_ACTIONS.curatedRevised, refused: OPERATIONS_AUDIT_ACTIONS.curatedRefused },
    { operation: 'revise_approved', proposalId: idOrNull(input.proposalId) },
    async () => {
      assertCanEditAwards(viewer);
      const sealed = d.loadSealed();
      const done = await d.withExecutor((executor) => reviseApprovedProposal(
        viewer, executor, input, { revision: d.revision, sealed }, { now: d.now },
      ));
      const sealedSeason = isSealedSeason(sealed, done.revision.season)
        || isSealedSeason(sealed, done.superseded.season);
      return {
        value: {
          proposal: done.revision,
          entityKey: done.revised.entityKey,
          mode: done.revised.mode,
          sealedSeason,
          revalidatePaths: [...done.revised.revalidatePaths],
        },
        detail: {
          season: done.revision.season,
          outcome: 'revised',
          mode: done.revised.mode,
          approvedEntityKey: done.revised.entityKey,
          previousEntityKey: done.superseded.approvedEntityKey,
          sealedSeason,
        },
      };
    },
  );
}

/**
 * Reject a pending proposal (`data.awards.edit`). The reason (>= 10 characters) is mandatory and is
 * kept in the ledger. Terminal: a rejected proposal cannot be reopened; a corrected one is a new
 * proposal.
 */
export async function rejectCurated(
  admin: AdminUser,
  input: { proposalId: number; decisionNote: string | null },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ proposal: ProposalRecord }>> {
  const d = resolveDeps(deps);
  const viewer = viewerOf(admin);
  return runMutation(
    admin,
    { done: OPERATIONS_AUDIT_ACTIONS.curatedRejected, refused: OPERATIONS_AUDIT_ACTIONS.curatedRefused },
    { operation: 'reject', proposalId: idOrNull(input.proposalId) },
    async () => {
      assertCanEditAwards(viewer);
      const proposal = await d.withExecutor((executor) => rejectProposal(viewer, executor, input));
      return { value: { proposal }, detail: { season: proposal.season, outcome: 'rejected' } };
    },
  );
}

/** The most proposal ids an audit row lists; the count is always exact. */
const AUDIT_ID_LIST_LIMIT = 100;

/**
 * Create proposals from a locally supplied offline file (`data.awards.edit`) — ALL or NOTHING, in
 * one transaction. Creates PROPOSALS ONLY: nothing is validated against the database and nothing
 * is approved, whatever the source (a Wikipedia-derived file included). Reversible in effect: each
 * proposal can be rejected (terminal) or left unapproved; nothing reaches `award_winners`.
 */
export async function createCuratedFromFile(
  admin: AdminUser,
  input: {
    text: string;
    format: AwardProposalFileFormat;
    defaults?: AwardProposalFileDefaults;
    decisionNote?: string | null;
  },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ proposals: ProposalRecord[]; count: number }>> {
  const d = resolveDeps(deps);
  const viewer = viewerOf(admin);
  return runMutation(
    admin,
    { done: OPERATIONS_AUDIT_ACTIONS.curatedCreated, refused: OPERATIONS_AUDIT_ACTIONS.curatedRefused },
    { operation: 'create', source: 'file', format: input.format },
    async () => {
      assertCanEditAwards(viewer);
      const proposals = await d.withExecutor((executor) => createProposalsFromFile(viewer, executor, input, { now: d.now }));
      return {
        value: { proposals, count: proposals.length },
        detail: {
          outcome: 'created',
          count: proposals.length,
          proposalIds: proposals.slice(0, AUDIT_ID_LIST_LIMIT).map((proposal) => proposal.id),
          proposalIdsTruncated: proposals.length > AUDIT_ID_LIST_LIMIT,
        },
      };
    },
  );
}

/* ------------------------------------------------------------------ *
 * Coleman
 * ------------------------------------------------------------------ */

/** The deterministic evidence reference of a Coleman publication: `coleman_derivation:<season>:<inputChecksum>`. */
export function colemanEvidenceRef(season: number, inputChecksum: string | null): string {
  return `coleman_derivation:${season}:${inputChecksum ?? 'unavailable'}`;
}

/** The leaderboard rows a comparison view carries (the full leaderboard is in the published record). */
export const COLEMAN_VIEW_LEADERBOARD_LIMIT = 20;

export type ColemanDerivationSummary =
  | {
    derivable: true;
    season: number;
    methodVersion: number;
    derivationVersion: string;
    derivedAt: string;
    inputChecksum: string;
    minimumGoals: number;
    maxGoals: number | null;
    tie: boolean;
    winners: ColemanWinner[];
    leaderboardTop: ColemanLeaderboardEntry[];
    leaderboardSize: number;
    counts: {
      homeAndAwayMatches: number;
      finalsMatches: number;
      homeAndAwayGoalRows: number;
      finalsRowsExcluded: number;
      players: number;
    };
  }
  | { derivable: false; refusal: ColemanRefusal };

export type ColemanPublicationView = Omit<ColemanPublicationRow, 'winners'>;

/**
 * The Coleman callers' dependencies: the shared {@link OperationsDeps} plus the projection port the
 * derived winners are published through (ADR 0015). Absent, the PRODUCTION port is used, always; a
 * test may inject its own (the PGlite stubs cannot host the production SQL).
 */
export type ColemanOperationsDeps = Partial<OperationsDeps> & {
  colemanProjection?: ColemanAwardWinnerProjectionPort;
};

export type ColemanComparisonView = {
  season: number;
  settled: boolean;
  generatedAt: string;
  /** The season is sealed in the registry (the only seasons that can be derived and published). */
  sealed: boolean;
  derivation: ColemanDerivationSummary;
  /** The derivation against the stored Coleman `award_winners` rows: agree / disagree / not_derivable. */
  report: ColemanComparisonReport;
  /** The current published derivation of the season, or null. */
  current: ColemanPublicationView | null;
  /** What publishing now would do; null when the season is not derivable. */
  plan: 'published' | 'unchanged' | 'superseded' | null;
  /**
   * What publishing now would do to the canonical `award_winners` rows (inserted / updated / voided
   * / retained counts), or the refusal publishing would hit. Computed by the same planner as the
   * write, read-only. Null when the season is not derivable or not sealed.
   */
  projection: ColemanProjectionPreview | null;
};

function summarise(outcome: ColemanDerivationOutcome): ColemanDerivationSummary {
  if (!outcome.ok) return { derivable: false, refusal: outcome.refusal };
  const result = outcome.result;
  return {
    derivable: true,
    season: result.season,
    methodVersion: result.methodVersion,
    derivationVersion: result.derivationVersion,
    derivedAt: result.derivedAt,
    inputChecksum: result.inputChecksum,
    minimumGoals: result.minimumGoals,
    maxGoals: result.maxGoals,
    tie: result.tie,
    winners: [...result.winners],
    leaderboardTop: result.leaderboard.slice(0, COLEMAN_VIEW_LEADERBOARD_LIMIT),
    leaderboardSize: result.leaderboard.length,
    counts: { ...result.counts },
  };
}

function viewOf(row: ColemanPublicationRow): ColemanPublicationView {
  return {
    id: row.id,
    season: row.season,
    methodVersion: row.methodVersion,
    derivationVersion: row.derivationVersion,
    inputChecksum: row.inputChecksum,
    derivedAt: row.derivedAt,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
    supersedesId: row.supersedesId,
    winnerKeys: row.winnerKeys,
  };
}

/**
 * Derive one season's Coleman result from the database and compare it with the stored Coleman
 * `award_winners` rows and the current publication (`data.awards.read`). READ-ONLY: nothing is
 * published, overwritten or audited. `settled` is the operator's attestation that every promotion
 * and settle for the season has concluded (plan R-022); `false` makes the derivation refuse
 * (`season_not_settled`), which the comparison reports as `not_derivable`.
 */
export async function compareColemanSeason(
  admin: AdminUser,
  input: { season: number; settled: boolean },
  deps?: ColemanOperationsDeps,
): Promise<OperationResult<{ comparison: ColemanComparisonView }>> {
  const d = resolveDeps(deps);
  const projection = deps?.colemanProjection ?? colemanAwardWinnerProjection;
  return runRead(async () => {
    if (!hasCapability(admin, 'data.awards.read')) {
      throw new OperationRefusal('forbidden', 'Comparing a derived Coleman result needs the data.awards.read capability.');
    }
    const season = requireSeason(input.season);
    const settled = input.settled === true;
    const registry = d.loadRegistry();
    const contract = d.loadContract();
    const generatedAt = d.now().toISOString();
    const sealed = isSealedSeason(sealedSeasonsFrom(registry), season);
    const loaded = await d.withExecutor(async (executor) => {
      const derivationInput = await loadColemanDerivationInput(executor, { season, settled, derivedAt: generatedAt, registry, contract });
      const derived = deriveColeman(derivationInput);
      return {
        derived,
        stored: await loadStoredColemanWinners(executor, season),
        publications: await listColemanPublications(executor, season),
        // Read-only: the same planner the write uses, so the preview and the publication cannot disagree.
        projection: derived.ok && sealed ? await projection.preview(executor, derived.result) : null,
      };
    });
    const outcome = loaded.derived;
    const report = buildColemanComparisonReport({ generatedAt, outcomes: [outcome], stored: loaded.stored });
    const current = loaded.publications[0] ?? null;
    const plan = outcome.ok && sealed
      ? planColemanPublication(
        current === null ? null : {
          id: current.id, inputChecksum: current.inputChecksum, derivationVersion: current.derivationVersion, winners: current.winners,
        },
        outcome.result,
      ).outcome
      : null;
    return {
      comparison: {
        season, settled, generatedAt, sealed,
        derivation: summarise(outcome),
        report,
        current: current === null ? null : viewOf(current),
        plan,
        projection: loaded.projection,
      },
    };
  });
}

/**
 * The CURRENT (not superseded) Coleman publications, newest season first, optionally for one season
 * (`data.awards.read`). READ-ONLY: writes and audits nothing. The stored `winners` document is not
 * returned (the view carries the durable winner keys); the full record stays in
 * `derived_award_results`. Added for the Stage 5 Coleman page (plan D9).
 */
export async function listColemanPublicationsForAdmin(
  admin: AdminUser,
  input: { season?: number } = {},
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ publications: ColemanPublicationView[] }>> {
  const d = resolveDeps(deps);
  return runRead(async () => {
    if (!hasCapability(admin, 'data.awards.read')) {
      throw new OperationRefusal('forbidden', 'Reading derived Coleman publications needs the data.awards.read capability.');
    }
    const season = input.season === undefined ? undefined : requireSeason(input.season);
    const rows = await d.withExecutor((executor) => listColemanPublications(executor, season));
    return { publications: rows.map(viewOf) };
  });
}

/** What publishing did to the canonical `award_winners` rows, as the operator is told (ADR 0015). */
export type ColemanProjectionSummary = {
  /** The `derived_award_projections` row written by this publication, or null (an idempotent rerun wrote none). */
  projectionId: number | null;
  counts: ColemanProjectionResult['counts'];
  /** inserted + updated + voided. */
  changedCount: number;
  /** Nothing in `award_winners` changed; only the provenance row was recorded. */
  provenanceOnly: boolean;
  /** Nothing changed and nothing was recorded: the projection was already recorded for this result. */
  alreadyProjected: boolean;
  actions: ColemanProjectionResult['actions'];
};

/** What a successful (or `unchanged`) Coleman publication reports. */
export type ColemanPublicationResult = {
  outcome: 'published' | 'unchanged' | 'superseded';
  /** The `derived_award_results` row: the new row, or the existing current row for `unchanged`. */
  id: number;
  /** The row this publication replaced (`superseded` only), else null. */
  supersededId: number | null;
  season: number;
  methodVersion: number;
  derivationVersion: string;
  inputChecksum: string;
  winnerKeys: readonly string[];
  evidenceRef: string;
  /** What publishing did to `award_winners`. */
  projection: ColemanProjectionSummary;
  /**
   * The public pages the changed rows can move, computed server-side. The CLIENT posts them to
   * `/admin/awards/revalidate` after the action succeeds (a Server Action never revalidates).
   */
  revalidatePaths: string[];
};

function summariseProjection(projection: ColemanProjectionResult): ColemanProjectionSummary {
  return {
    projectionId: projection.projectionId,
    counts: projection.counts,
    changedCount: projection.changedCount,
    provenanceOnly: projection.changedCount === 0 && projection.projectionId !== null,
    alreadyProjected: projection.changedCount === 0 && projection.projectionId === null,
    actions: projection.actions,
  };
}

/**
 * Publish one season's Coleman result (`data.awards.edit`). The publisher DERIVES INSIDE from the
 * database (a caller cannot hand in a result) and writes ONE `derived_award_results` row in ONE
 * transaction: `published` (first publication), `unchanged` (same inputs, version and winners: no
 * new ledger row) or `superseded` (a new row pointing at the previous one). The ledger is
 * append-only, so a publication is not undone — a recompute supersedes it.
 *
 * It then PROJECTS the derived winners into the canonical `award_winners` table, in the SAME
 * transaction, through the production port (`colemanAwardWinnerProjection`, ADR 0015) on every
 * publication including `unchanged`: inserts new winners, updates a row whose values moved, voids a
 * derived winner the facts no longer support, and leaves an equal row untouched (provenance only).
 * Any projection refusal rolls the ledger row back too. The result carries the public
 * `revalidatePaths` for the client to post.
 *
 * Every publication is an audited correction through the season seal: workflow
 * `derived_award_publication`, actor = the publishing admin, `note` = the operator's reason
 * (20..2000 characters), and the deterministic evidence reference
 * `coleman_derivation:<season>:<inputChecksum>` ({@link colemanEvidenceRef}). It is stored
 * verbatim in `derived_award_results.correction` — that row is the durable audit.
 *
 * Refused (nothing written) when: `settled` is not exactly `true` (`settled_required`); the note is
 * outside 20..2000 characters (`correction_invalid`); the season is not sealed or not derivable
 * (`derivation_refused`, with `derivationCode` — e.g. `season_not_complete`, `goals_not_recorded`);
 * the viewer lacks `data.awards.edit` (`forbidden`).
 */
export async function publishColemanSeason(
  admin: AdminUser,
  input: { season: number; settled: boolean; note: string },
  deps?: ColemanOperationsDeps,
): Promise<OperationResult<ColemanPublicationResult>> {
  const d = resolveDeps(deps);
  // ALWAYS a projection port: the production one unless a test injects another (a unit test pins this).
  const projection = deps?.colemanProjection ?? colemanAwardWinnerProjection;
  return runMutation(
    admin,
    { done: OPERATIONS_AUDIT_ACTIONS.colemanPublished, refused: OPERATIONS_AUDIT_ACTIONS.colemanRefused },
    { operation: 'publish', season: idOrNull(input.season), settled: input.settled === true },
    async () => {
      if (!hasCapability(admin, 'data.awards.edit')) {
        throw new OperationRefusal('forbidden', 'Publishing a derived Coleman result needs the data.awards.edit capability.');
      }
      const season = requireSeason(input.season);
      if (input.settled !== true) {
        throw new OperationRefusal(
          'settled_required',
          'Confirm that the season is settled (every promotion and settle for it has concluded) before publishing.',
        );
      }
      const note = typeof input.note === 'string' ? input.note.trim() : '';
      if (note.length < CORRECTION_NOTE_MIN_LENGTH || note.length > CORRECTION_NOTE_MAX_LENGTH) {
        throw new OperationRefusal(
          'correction_invalid',
          `A Coleman publication is an audited correction of sealed history and needs a note of ${CORRECTION_NOTE_MIN_LENGTH} to ${CORRECTION_NOTE_MAX_LENGTH} characters.`,
        );
      }
      const registry = d.loadRegistry();
      const contract = d.loadContract();

      const outcome: { publication: ColemanPublicationOutcome; evidenceRef: string } = await d.withExecutor(async (executor) => {
        const derivationInput = await loadColemanDerivationInput(executor, {
          season, settled: true, derivedAt: d.now().toISOString(), registry, contract,
        });
        const derived = deriveColeman(derivationInput);
        const evidenceRef = colemanEvidenceRef(season, derived.ok ? derived.result.inputChecksum : null);
        const publication = await publishColemanResult(executor, {
          derivation: derivationInput,
          correction: {
            workflow: COLEMAN_PUBLICATION_WORKFLOW,
            actorUserId: admin.id,
            note,
            evidenceRef,
          },
          publishedBy: admin.id,
          viewer: { role: admin.role, canManageAdmins: admin.canManageAdmins },
        }, { projection });
        return { publication, evidenceRef };
      });

      const publication = outcome.publication;
      if (!publication.ok) {
        const { refusal } = publication;
        const subjects = refusal.subjects === undefined || refusal.subjects.length === 0
          ? ''
          : ` Rows: ${refusal.subjects.join('; ')}.`;
        throw new OperationRefusal(
          refusal.code === 'capability_denied' ? 'forbidden' : refusal.code,
          `${refusal.message}${subjects}`,
          refusal.derivation?.code,
        );
      }
      if (publication.projection === null) {
        // Unreachable: a port was passed. Fail closed rather than report an unprojected success.
        throw new Error('The Coleman publication returned no projection although a projection port was supplied.');
      }
      const projected = summariseProjection(publication.projection);
      return {
        value: {
          outcome: publication.outcome,
          id: publication.id,
          supersededId: publication.supersededId,
          season: publication.season,
          methodVersion: publication.methodVersion,
          derivationVersion: publication.derivationVersion,
          inputChecksum: publication.inputChecksum,
          winnerKeys: publication.winnerKeys,
          evidenceRef: outcome.evidenceRef,
          projection: projected,
          revalidatePaths: [...publication.projection.revalidatePaths],
        },
        detail: {
          outcome: publication.outcome,
          resultId: publication.id,
          supersededId: publication.supersededId,
          derivationVersion: publication.derivationVersion,
          inputChecksum: publication.inputChecksum,
          winnerCount: publication.winnerKeys.length,
          evidenceRef: outcome.evidenceRef,
          projected: projected.counts,
          projectionId: projected.projectionId,
          provenanceOnly: projected.provenanceOnly,
        },
      };
    },
  );
}

/* ------------------------------------------------------------------ *
 * Brownlow
 * ------------------------------------------------------------------ */

/**
 * Reconcile one season's Brownlow evidence (`data.brownlow.read`) and return the report. READ-ONLY:
 * it reads the staged AFL API votes, the stored authoritative totals and the match context, and
 * writes and audits nothing. No winner is stated; see `awardResultPresentation` on the report.
 * `eligibilityRule` defaults to `unrecorded` (plan R-023, V2-GAP-016).
 */
export async function reconcileBrownlowSeasonForAdmin(
  admin: AdminUser,
  input: { season: number; eligibilityRule?: BrownlowEligibilityRule },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ report: BrownlowReconciliationReport; staging: BrownlowStagingEvidence }>> {
  const d = resolveDeps(deps);
  return runRead(async () => {
    if (!hasCapability(admin, 'data.brownlow.read')) {
      throw new OperationRefusal('forbidden', 'Reconciling Brownlow evidence needs the data.brownlow.read capability.');
    }
    const season = requireSeason(input.season);
    if (input.eligibilityRule !== undefined
      && !(BROWNLOW_ELIGIBILITY_RULES as readonly string[]).includes(input.eligibilityRule)) {
      throw new OperationRefusal('invalid_input', `The eligibility rule must be one of ${BROWNLOW_ELIGIBILITY_RULES.join(', ')}.`);
    }
    const registry = d.loadRegistry();
    const generatedAt = d.now().toISOString();
    const identities = readProviderTeamIdentities(d);
    const { input: reconciliationInput, staging } = await d.withExecutor((executor) => loadBrownlowReconciliationInputWithEvidence(executor, {
      season, registry, generatedAt, eligibilityRule: input.eligibilityRule,
      providerTeamIdentities: identities.identities,
    }));
    return {
      report: reconcileBrownlowSeason(reconciliationInput),
      staging: identities.error === null
        ? staging
        : { ...staging, teamMapping: { state: 'not_attempted', reason: 'identities_unavailable', error: identities.error } },
    };
  });
}

/* ------------------------------------------------------------------ *
 * AFL API settle refusals (V2-GAP-025)
 * ------------------------------------------------------------------ */

/**
 * One page of the open AFL API settle refusals or settle findings (`operations.centre.read`).
 * READ-ONLY: one repeatable-read READ ONLY transaction, no audit row, no retry and no control that
 * resolves anything (a finding is closed only by the settle that owns it). See
 * `src/db/queries/afl-api-settle-findings.ts` for the scope and what is never returned.
 */
export async function listAflApiSettleFindingsForAdmin(
  admin: AdminUser,
  input: { section: AflApiFindingSection; before: string | null },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ page: AflApiFindingsPage }>> {
  const d = resolveDeps(deps);
  return runRead(async () => {
    if (!hasCapability(admin, 'operations.centre.read')) {
      throw new OperationRefusal('forbidden', 'Reading AFL API settle refusals needs the operations.centre.read capability.');
    }
    if (!(AFL_API_FINDING_SECTIONS as readonly string[]).includes(input.section)) {
      throw new OperationRefusal('invalid_input', `The section must be one of ${AFL_API_FINDING_SECTIONS.join(', ')}.`);
    }
    if (input.before !== null && !isAflApiFindingCursor(input.before)) {
      throw new OperationRefusal('invalid_input', 'The page cursor must be a positive whole number.');
    }
    const page = await d.withExecutor((executor) => readAflApiSettleFindings(executor, {
      section: input.section, before: input.before,
    }));
    return { page };
  });
}

/**
 * The committed provider team identities, or the reason they are unavailable. An unreadable file
 * never fails the reconciliation: the mapping is then reported as not attempted and the club check
 * stays `club_unverifiable`, with the reason shown.
 */
function readProviderTeamIdentities(
  d: OperationsDeps,
): { identities: readonly ProviderTeamIdentity[] | undefined; error: string | null } {
  try {
    return { identities: d.loadProviderTeamIdentities(), error: null };
  } catch (error) {
    return { identities: undefined, error: error instanceof Error ? error.message.split('\n')[0] : 'unknown error' };
  }
}

/* Brownlow eligibility (Launch F F-D stream A) */

/*
 * The eligibility-aware Brownlow Medal determination (docs/v2/adr/0014-brownlow-eligibility.md).
 *
 * `determineBrownlowSeasonForAdmin` is a READ (`data.brownlow.read`): it reconciles the season with
 * the default rule, loads the raw eligibility evidence (current decisions, stored rows, staged
 * flags), and runs the pure `determineBrownlowMedal`. `recordBrownlowEligibilityForAdmin` is the
 * MUTATION (`data.brownlow.finalise`, Super Admin only): one append-only decision row through
 * `recordBrownlowEligibilityDecision`, then the determination is RECOMPUTED. Neither writes
 * `brownlow_season_votes`, `brownlow_round_votes` or a staging table: raw votes are never altered
 * and the published table is changed only by the existing /admin/brownlow publish workflow.
 */

/** Whether the stored `is_winner` flags agree with the determination (informational; nothing is changed). */
export type BrownlowStoredFlagCheck = {
  /** `not_applicable` unless the determination is `determined` and the season has stored rows. */
  state: 'agrees' | 'disagrees' | 'not_applicable';
  /** The players the stored table flags `is_winner`; null when the season has no stored rows. */
  storedWinners: number[] | null;
  determinedWinners: number[];
};

export type BrownlowDeterminationView = {
  season: number;
  generatedAt: string;
  /** The season is sealed in the registry (a decision is then an audited correction). */
  sealed: boolean;
  seasonAdminPublished: boolean;
  report: {
    outcome: BrownlowOutcome;
    seasonState: BrownlowSeasonState;
    basis: BrownlowEvidenceBasis | null;
    findingCounts: Record<string, number>;
    voteGetters: number;
  };
  determination: BrownlowMedalDetermination;
  identities: BrownlowPlayerIdentityView[];
  /** Every decision of the season, oldest first, each marked `current`. */
  decisions: BrownlowEligibilityDecisionView[];
  storedFlagCheck: BrownlowStoredFlagCheck;
};

async function computeBrownlowDetermination(
  executor: TransactionalSqlExecutor,
  season: number,
  registry: SeasonRegistry,
  generatedAt: string,
): Promise<BrownlowDeterminationView> {
  const { input: reconciliationInput } = await loadBrownlowReconciliationInputWithEvidence(
    executor, { season, registry, generatedAt, storedOnlyFallback: true },
  );
  let report = reconcileBrownlowSeason(reconciliationInput);
  const evidence = await loadBrownlowEligibilityEvidence(executor, {
    season,
    playerIds: report.rawVotes.playerTotals.map((total) => total.playerId),
  });
  if (evidence.seasonAdminPublished && reconciliationInput.seasonState !== 'complete') {
    report = reconcileBrownlowSeason({ ...reconciliationInput, seasonState: 'complete' });
  }
  const determination = determineBrownlowMedal({
    report,
    seasonAdminPublished: evidence.seasonAdminPublished,
    players: evidence.players,
  });
  const storedWinners = report.awardResultPresentation.providerClaims.storedWinners;
  const determinedWinners = determination.winners.map((winner) => winner.playerId);
  const comparable = determination.status === 'determined' && storedWinners !== null;
  const same = comparable
    && storedWinners.length === determinedWinners.length
    && storedWinners.every((id, index) => id === determinedWinners[index]);
  return {
    season,
    generatedAt,
    sealed: isSealedSeason(sealedSeasonsFrom(registry), season),
    seasonAdminPublished: evidence.seasonAdminPublished,
    report: {
      outcome: report.outcome,
      seasonState: report.source.seasonState,
      basis: report.rawVotes.basis,
      findingCounts: { ...report.findingCounts },
      voteGetters: report.rawVotes.playerTotals.length,
    },
    determination,
    identities: evidence.identities,
    decisions: evidence.decisions,
    storedFlagCheck: { state: !comparable ? 'not_applicable' : same ? 'agrees' : 'disagrees', storedWinners, determinedWinners },
  };
}

/**
 * Determine one season's Brownlow Medal winner(s) under the owner's eligibility-aware model
 * (`data.brownlow.read`). READ-ONLY: writes and audits nothing. The raw leaderboard is returned for
 * every vote-getter; a winner is stated only when the status is `determined`, and a missing or
 * ambiguous leader gives `requires_review` (never an invented winner).
 */
export async function determineBrownlowSeasonForAdmin(
  admin: AdminUser,
  input: { season: number },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<{ view: BrownlowDeterminationView }>> {
  const d = resolveDeps(deps);
  return runRead(async () => {
    if (!hasCapability(admin, 'data.brownlow.read')) {
      throw new OperationRefusal('forbidden', 'Determining the Brownlow Medal needs the data.brownlow.read capability.');
    }
    const season = requireSeason(input.season);
    const registry = d.loadRegistry();
    const generatedAt = d.now().toISOString();
    const view = await d.withExecutor((executor) => computeBrownlowDetermination(executor, season, registry, generatedAt));
    return { view };
  });
}

/** What a recorded eligibility decision reports. */
export type BrownlowEligibilityRecorded = {
  decision: BrownlowEligibilityDecisionView;
  /** The decision this one superseded, or null. */
  supersededId: number | null;
  /** The determination RECOMPUTED after the decision; null when it could not be recomputed (the decision stands). */
  determination: BrownlowDeterminationView | null;
  /** Why `determination` is null; the decision is committed regardless. */
  recomputeError?: string;
};

/**
 * Record one Brownlow eligibility decision (`data.brownlow.finalise`, Super Admin only): ONE
 * append-only row in `brownlow_eligibility_decisions` carrying the verdict, a citation (1..2000
 * characters) and a note (20..2000), in ONE transaction under a per-season advisory lock. A later
 * decision for the same player supersedes it and nothing is ever updated or deleted, so a decision
 * is not undone - it is superseded. A decision into a SEALED season is an audited correction
 * (workflow `brownlow_eligibility_decision`) stored verbatim on the row. Medal/eligibility metadata
 * and its required audit are published in that transaction; raw votes and staging are preserved.
 *
 * `expectedCurrentDecisionId` is the id of the decision the administrator SAW as current (null for
 * none): if it changed meanwhile the decision is refused `stale_decision`. After the commit the
 * determination is recomputed and returned, deterministically.
 *
 * Refused with nothing written: `forbidden` (no `data.brownlow.finalise`), `invalid_input`,
 * `citation_required`, `note_invalid`, `unknown_player`, `identity_missing`, `identity_ambiguous`,
 * `player_not_vote_getter`, `stale_decision`, `season_sealed` / `correction_invalid` (the seal),
 * `season_registry_unavailable` (the registry fails closed).
 */
export async function recordBrownlowEligibilityForAdmin(
  admin: AdminUser,
  input: {
    season: number;
    playerId: number;
    verdict: BrownlowEligibilityVerdict;
    citation: string;
    note: string;
    expectedCurrentDecisionId: number | null;
  },
  deps?: Partial<OperationsDeps>,
): Promise<OperationResult<BrownlowEligibilityRecorded>> {
  const d = resolveDeps(deps);
  return runMutation(
    admin,
    {
      done: OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityDecided,
      refused: OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityRefused,
    },
    {
      operation: 'decide_eligibility',
      season: idOrNull(input.season),
      playerId: idOrNull(input.playerId),
      verdict: (BROWNLOW_ELIGIBILITY_VERDICTS as readonly unknown[]).includes(input.verdict) ? input.verdict : null,
      expectedCurrentDecisionId: idOrNull(input.expectedCurrentDecisionId),
    },
    async () => {
      // Capability first: a refused viewer must not even cause the registry to be read.
      if (!hasCapability(admin, 'data.brownlow.finalise')) {
        throw new OperationRefusal('forbidden', 'Recording a Brownlow eligibility decision needs the data.brownlow.finalise capability.');
      }
      const season = requireSeason(input.season);
      const registry = d.loadRegistry();
      const generatedAt = d.now().toISOString();

      const recorded = await d.withExecutor(async (executor) => {
        const outcome = await recordBrownlowEligibilityDecision(executor, {
          season,
          playerId: input.playerId,
          verdict: input.verdict,
          citation: input.citation,
          note: input.note,
          expectedCurrentDecisionId: input.expectedCurrentDecisionId,
          decidedBy: admin.id,
          viewer: { role: admin.role, canManageAdmins: admin.canManageAdmins },
          sealed: sealedSeasonsFrom(registry),
          publicationRegistry: registry,
        });
        if (!outcome.ok) return { outcome, determination: null, recomputeError: undefined };
        // The decision is committed. A failure to RECOMPUTE must not turn it into a refusal.
        try {
          return { outcome, determination: await computeBrownlowDetermination(executor, season, registry, generatedAt), recomputeError: undefined };
        } catch (error) {
          console.error('Operations centre: recomputing the Brownlow determination after a decision failed', error);
          return {
            outcome,
            determination: null,
            recomputeError: 'The decision was recorded, but the determination could not be recomputed. Reload the page to see it.',
          };
        }
      });

      if (!recorded.outcome.ok) {
        const { refusal } = recorded.outcome;
        throw new OperationRefusal(refusal.code === 'capability_denied' ? 'forbidden' : refusal.code, refusal.message);
      }
      const { decision, supersededId } = recorded.outcome;
      return {
        value: {
          decision,
          supersededId,
          determination: recorded.determination,
          ...(recorded.recomputeError === undefined ? {} : { recomputeError: recorded.recomputeError }),
        },
        detail: {
          outcome: 'decided',
          decisionId: decision.id,
          supersededId,
          verdict: decision.verdict,
          basis: decision.basis,
          determinationStatus: recorded.determination === null ? null : recorded.determination.determination.status,
          inputChecksum: recorded.determination === null ? null : recorded.determination.determination.inputChecksum,
        },
      };
    },
  );
}
