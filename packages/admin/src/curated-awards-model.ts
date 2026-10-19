/**
 * @afldb/admin — curated awards: the pure model (AFLDB V2 Stage 4, docs/v2/adr/0008-curated-awards.md).
 *
 * Everything here is pure: the proposal types, the workflow state machine, input normalisation,
 * the validation rules and the capability gate. No SQL, no clock and no I/O — the services in
 * `curated-awards.ts` gather the database facts and call these functions.
 *
 * The state machine below is mirrored by `award_proposal_decisions_transition_ck` in
 * src/db/migrations/111_curated_award_proposals.sql; tests/v2-curated-awards-pglite.test.ts
 * proves the two agree by trying every (action, from, to) triple against the real table.
 */
import { hasCapability, type CapabilityViewer } from '@/lib/auth/capabilities';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  'proposed', 'validated', 'validation_failed', 'approved', 'rejected', 'superseded',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_ACTIONS = [
  'create', 'validate', 'approve', 'reject', 'revise', 'supersede',
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

/** `manual_entry` is the admin data editor; the other two are locally supplied files. */
export const PROPOSAL_SOURCE_KINDS = ['manual_entry', 'offline_file', 'wikipedia_offline_file'] as const;
export type ProposalSourceKind = (typeof PROPOSAL_SOURCE_KINDS)[number];

/** Statuses that are still awaiting a decision (a pending proposal may be edited only by revising). */
export const PENDING_STATUSES: readonly ProposalStatus[] = ['proposed', 'validated', 'validation_failed'];
/** Statuses with no outgoing transition. */
export const TERMINAL_STATUSES: readonly ProposalStatus[] = ['approved', 'rejected', 'superseded'];

/** Brownlow results live in authoritative brownlow_season_votes, never in award_winners. */
export const BROWNLOW_AWARD_SLUG = 'brownlow-medal';

export const MIN_SEASON = 1897;
export const MAX_SEASON = 2100;
export const MAX_VOTES = 999_999.99;
export const MAX_NOTE_LENGTH = 2000;
export const REJECT_NOTE_MIN_LENGTH = 10;
export const WIKIPEDIA_APPROVAL_NOTE_MIN_LENGTH = 20;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export type CuratedAwardErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'illegal_transition'
  | 'invalid_input'
  | 'invalid_file'
  | 'note_required'
  | 'no_change'
  | 'stale_validation'
  | 'concurrent_modification'
  | 'approved_revision_unsupported'
  | 'season_sealed_correction_invalid'
  | 'promotion_refused';

/** Every refusal the services raise. `code` is the contract; `message` is for people. */
export class CuratedAwardError extends Error {
  readonly code: CuratedAwardErrorCode;
  readonly issues: readonly ValidationIssue[];

  constructor(code: CuratedAwardErrorCode, message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.name = 'CuratedAwardError';
    this.code = code;
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export type TransitionFrom = ProposalStatus | null;
export type TransitionEdge = { readonly from: TransitionFrom; readonly to: ProposalStatus };

const PENDING_TO_PENDING_RESULT: readonly ProposalStatus[] = ['validated', 'validation_failed'];

function edges(from: readonly TransitionFrom[], to: readonly ProposalStatus[]): TransitionEdge[] {
  return from.flatMap((f) => to.map((t) => ({ from: f, to: t })));
}

/**
 * Every legal transition, by action. `from: null` means "no row yet": `create` and `revise` each
 * bring a NEW row into existence in `proposed`. `revise` is always accompanied by a `supersede`
 * of the revision it replaces, so one revision is two ledger rows on two proposal rows.
 *
 * `approved`, `rejected` and `superseded` have no outgoing edge. Revising an APPROVED proposal is
 * not in the machine at all: it must go through the existing replace/correct path for
 * award_winners (see `reviseProposal`, which refuses it with `approved_revision_unsupported`).
 */
export const CURATED_AWARD_TRANSITIONS: Readonly<Record<ProposalAction, readonly TransitionEdge[]>> = {
  create: edges([null], ['proposed']),
  revise: edges([null], ['proposed']),
  validate: edges(PENDING_STATUSES, PENDING_TO_PENDING_RESULT),
  approve: edges(['validated'], ['approved']),
  reject: edges(PENDING_STATUSES, ['rejected']),
  supersede: edges(PENDING_STATUSES, ['superseded']),
};

export function isLegalTransition(action: ProposalAction, from: TransitionFrom, to: ProposalStatus): boolean {
  return CURATED_AWARD_TRANSITIONS[action].some((edge) => edge.from === from && edge.to === to);
}

/** Throw `illegal_transition` unless `action` may move a proposal from `from` to `to`. */
export function assertTransition(action: ProposalAction, from: TransitionFrom, to: ProposalStatus): void {
  if (!isLegalTransition(action, from, to)) {
    throw new CuratedAwardError(
      'illegal_transition',
      `A proposal cannot ${action} from ${from ?? 'no state'} to ${to}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Capability gate
// ---------------------------------------------------------------------------

/** The acting administrator: the capability inputs plus the stable `auth_users.id` the ledger records. */
export type CuratedAwardsViewer = CapabilityViewer & { userId: number };

function assertViewerIdentity(viewer: CuratedAwardsViewer): void {
  if (!Number.isInteger(viewer.userId) || viewer.userId <= 0) {
    throw new CuratedAwardError('forbidden', 'The acting administrator has no valid user id.');
  }
}

/** Mutations need `data.awards.edit` (super_admin). Not a four-eyes rule: see ADR 0008. */
export function assertCanEditAwards(viewer: CuratedAwardsViewer): void {
  assertViewerIdentity(viewer);
  if (!hasCapability(viewer, 'data.awards.edit')) {
    throw new CuratedAwardError('forbidden', 'Curating award proposals needs the data.awards.edit capability.');
  }
}

/** Reads need `data.awards.read` (admin and super_admin). */
export function assertCanReadAwards(viewer: CuratedAwardsViewer): void {
  assertViewerIdentity(viewer);
  if (!hasCapability(viewer, 'data.awards.read')) {
    throw new CuratedAwardError('forbidden', 'Reading award proposals needs the data.awards.read capability.');
  }
}

// ---------------------------------------------------------------------------
// Proposal values
// ---------------------------------------------------------------------------

/** The stored, normalised value of one proposal revision (mirrors the award_proposals columns). */
export type ProposalValues = {
  awardSlug: string;
  season: number;
  /** `afltables:<profile path>` or `manual_admin_edit:<token>`; null while unresolved. */
  playerIdentity: string | null;
  playerNameRaw: string;
  clubSlug: string | null;
  /** numeric(8,2) carried as text; null = not recorded (never coerced to 0). */
  votes: string | null;
  position: string | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  note: string | null;
  duplicateConfirmed: boolean;
  sourceKind: ProposalSourceKind;
  sourceUrl: string | null;
  citation: string | null;
  /** YYYY-MM-DD. */
  acquiredOn: string;
};

/** What a caller (the admin editor or a file parser) supplies; `normaliseProposalInput` tidies it. */
export type ProposalInput = {
  awardSlug: string;
  season: number;
  playerIdentity?: string | null;
  playerNameRaw: string;
  clubSlug?: string | null;
  votes?: string | number | null;
  position?: string | null;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  note?: string | null;
  duplicateConfirmed?: boolean;
  sourceKind: ProposalSourceKind;
  sourceUrl?: string | null;
  citation?: string | null;
  acquiredOn: string;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** Trim, turn blanks into null, and carry votes as text. Never invents a value. */
export function normaliseProposalInput(input: ProposalInput): ProposalValues {
  const votes = input.votes === undefined || input.votes === null ? null : trimmedOrNull(String(input.votes));
  return {
    awardSlug: String(input.awardSlug ?? '').trim(),
    season: input.season,
    playerIdentity: trimmedOrNull(input.playerIdentity),
    playerNameRaw: String(input.playerNameRaw ?? '').trim(),
    clubSlug: trimmedOrNull(input.clubSlug),
    votes,
    position: trimmedOrNull(input.position),
    isCaptain: input.isCaptain === true,
    isViceCaptain: input.isViceCaptain === true,
    note: trimmedOrNull(input.note),
    duplicateConfirmed: input.duplicateConfirmed === true,
    sourceKind: input.sourceKind,
    sourceUrl: trimmedOrNull(input.sourceUrl),
    citation: trimmedOrNull(input.citation),
    acquiredOn: String(input.acquiredOn ?? '').trim(),
  };
}

/** The reduced snake_case form recorded in the ledger (never a raw payload, never an id). */
export function valuesToJson(values: ProposalValues): Record<string, unknown> {
  return {
    award_slug: values.awardSlug,
    season: values.season,
    player_identity: values.playerIdentity,
    player_name_raw: values.playerNameRaw,
    club_slug: values.clubSlug,
    votes: values.votes,
    position: values.position,
    is_captain: values.isCaptain,
    is_vice_captain: values.isViceCaptain,
    note: values.note,
    duplicate_confirmed: values.duplicateConfirmed,
    source_kind: values.sourceKind,
    source_url: values.sourceUrl,
    citation: values.citation,
    acquired_on: values.acquiredOn,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationCode =
  | 'award_slug_required'
  | 'award_not_found'
  | 'award_not_supported'
  | 'season_out_of_range'
  | 'season_not_in_register'
  | 'player_name_required'
  | 'player_identity_malformed'
  | 'player_unresolved'
  | 'player_identity_unresolved'
  | 'player_identity_ambiguous'
  | 'club_not_found'
  | 'votes_out_of_range'
  | 'field_too_long'
  | 'source_kind_invalid'
  | 'evidence_missing'
  | 'source_url_invalid'
  | 'wikipedia_url_required'
  | 'acquired_on_invalid'
  | 'duplicate_active_winner'
  | 'duplicate_live_proposal';

export type ValidationIssue = {
  code: ValidationCode;
  /** An 'error' blocks approval; a 'warning' is a confirmed conflict kept on the record. */
  severity: 'error' | 'warning';
  message: string;
  field?: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
  /** ISO-8601 UTC instant the check ran. */
  checkedAt: string;
};

/**
 * The database facts validation needs, read by the service inside its transaction. `null` for the
 * whole object means "shape check only" (used when a proposal is first created or parsed from a
 * file, before any database lookup).
 */
export type ValidationFacts = {
  award: { id: number; slug: string; category: string } | null;
  seasonInRegister: boolean;
  /** null = the proposal carries no identity (nothing was looked up); [] unresolved; >1 ambiguous. */
  playerIds: readonly number[] | null;
  /** undefined = the proposal names no club; null = a slug that matches no club. */
  club: { id: number } | null | undefined;
  /** Active award_winners rows for the same award, season and player. */
  activeWinnerIds: readonly number[];
  /** Other live, undecided proposals for the same award, season and player. */
  pendingProposalIds: readonly number[];
};

const PLAYER_IDENTITY_PATTERN = /^(afltables|manual_admin_edit):.+$/;
const VOTES_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WIKIPEDIA_URL_PATTERN = /^https:\/\/([a-z0-9-]+\.)*wikipedia\.org\//i;

function isRealDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpUrl(value: string): boolean {
  if (value.length > 2000 || /\s/.test(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).hostname !== '';
  } catch {
    return false;
  }
}

/** Split a durable player identity into the `sources.key` and `external_id` it was computed from. */
export function splitPlayerIdentity(identity: string): { sourceKey: string; externalId: string } | null {
  if (!PLAYER_IDENTITY_PATTERN.test(identity)) return null;
  const at = identity.indexOf(':');
  return { sourceKey: identity.slice(0, at), externalId: identity.slice(at + 1) };
}

/**
 * Validate one proposal's values. `facts` null checks the shape only (the rules the database CHECK
 * constraints also enforce, so an unstorable proposal is refused before any SQL). With `facts` it
 * also checks identity resolution, the award and season, the club and duplicates.
 *
 * `today` is the current date (YYYY-MM-DD) in UTC, supplied by the caller so this stays pure.
 */
export function validateAwardProposal(
  values: ProposalValues,
  facts: ValidationFacts | null,
  context: { today: string; checkedAt: string },
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const error = (code: ValidationCode, field: string, message: string): void => {
    issues.push({ code, severity: 'error', field, message });
  };

  // --- award / season (shape) ---
  if (values.awardSlug === '') error('award_slug_required', 'awardSlug', 'An award is required.');
  else if (values.awardSlug.length > 200) error('field_too_long', 'awardSlug', 'The award slug is longer than 200 characters.');
  if (values.awardSlug === BROWNLOW_AWARD_SLUG) {
    error('award_not_supported', 'awardSlug',
      'Brownlow Medal results are recorded in authoritative brownlow_season_votes, not award_winners.');
  }
  if (!Number.isInteger(values.season) || values.season < MIN_SEASON || values.season > MAX_SEASON) {
    error('season_out_of_range', 'season', `The season must be a whole year from ${MIN_SEASON} to ${MAX_SEASON}.`);
  }

  // --- who ---
  if (values.playerNameRaw === '') error('player_name_required', 'playerNameRaw', 'The source\'s player name is required.');
  else if (values.playerNameRaw.length > 200) error('field_too_long', 'playerNameRaw', 'The player name is longer than 200 characters.');
  if (values.playerIdentity !== null && !PLAYER_IDENTITY_PATTERN.test(values.playerIdentity)) {
    error('player_identity_malformed', 'playerIdentity',
      'A player identity is "afltables:<profile path>" or "manual_admin_edit:<token>".');
  }

  // --- value ---
  if (values.votes !== null) {
    const parsed = VOTES_PATTERN.test(values.votes) ? Number(values.votes) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_VOTES) {
      error('votes_out_of_range', 'votes', `Votes or statistic must be from 0 to ${MAX_VOTES} with at most two decimals.`);
    }
  }
  if (values.position !== null && values.position.length > 200) error('field_too_long', 'position', 'The position is longer than 200 characters.');
  if (values.note !== null && values.note.length > MAX_NOTE_LENGTH) error('field_too_long', 'note', `The note is longer than ${MAX_NOTE_LENGTH} characters.`);

  // --- evidence ---
  if (!(PROPOSAL_SOURCE_KINDS as readonly string[]).includes(values.sourceKind)) {
    error('source_kind_invalid', 'sourceKind', `The source kind must be one of ${PROPOSAL_SOURCE_KINDS.join(', ')}.`);
  }
  if (values.sourceUrl === null && values.citation === null) {
    error('evidence_missing', 'sourceUrl', 'A source URL or a citation is required.');
  }
  if (values.sourceUrl !== null && !isHttpUrl(values.sourceUrl)) {
    error('source_url_invalid', 'sourceUrl', 'The source URL must be an http(s) URL of at most 2000 characters with no spaces.');
  }
  if (values.citation !== null && values.citation.length > MAX_NOTE_LENGTH) {
    error('field_too_long', 'citation', `The citation is longer than ${MAX_NOTE_LENGTH} characters.`);
  }
  if (values.sourceKind === 'wikipedia_offline_file'
    && (values.sourceUrl === null || !WIKIPEDIA_URL_PATTERN.test(values.sourceUrl))) {
    error('wikipedia_url_required', 'sourceUrl',
      'Wikipedia-derived input must name the https wikipedia.org page it was prepared from.');
  }
  if (!isRealDate(values.acquiredOn)) {
    error('acquired_on_invalid', 'acquiredOn', 'The acquisition date must be a real date written YYYY-MM-DD.');
  } else if (values.acquiredOn > context.today) {
    error('acquired_on_invalid', 'acquiredOn', 'The acquisition date cannot be in the future.');
  }

  // --- database facts ---
  if (facts !== null) {
    if (facts.award === null && values.awardSlug !== '') {
      error('award_not_found', 'awardSlug', `No award has the slug '${values.awardSlug}'.`);
    }
    if (!facts.seasonInRegister && Number.isInteger(values.season)) {
      error('season_not_in_register', 'season', `Season ${values.season} is not in the seasons register.`);
    }
    if (values.playerIdentity === null) {
      error('player_unresolved', 'playerIdentity',
        'The player is not resolved to a stable identity. Link the player first (/admin/player-links), then revise.');
    } else if (facts.playerIds !== null) {
      if (facts.playerIds.length === 0) {
        error('player_identity_unresolved', 'playerIdentity', 'That player identity matches no player.');
      } else if (facts.playerIds.length > 1) {
        error('player_identity_ambiguous', 'playerIdentity',
          `That player identity matches ${facts.playerIds.length} players; refusing to choose one.`);
      }
    }
    if (values.clubSlug !== null && facts.club === null) {
      error('club_not_found', 'clubSlug', `No club has the slug '${values.clubSlug}'.`);
    }
    // A repeat is a conflict to confirm, never silently allowed and never silently refused: some
    // awards legitimately record one player twice in a season (admin-awards.ts R-5).
    const conflictSeverity = values.duplicateConfirmed ? 'warning' : 'error';
    if (facts.activeWinnerIds.length > 0) {
      issues.push({
        code: 'duplicate_active_winner',
        severity: conflictSeverity,
        field: 'playerIdentity',
        message: `${values.playerNameRaw} is already an active ${values.awardSlug} winner for ${values.season}`
          + ` (entry ${facts.activeWinnerIds.map((id) => `#${id}`).join(', ')}).`
          + (values.duplicateConfirmed ? ' Confirmed as a legitimate repeat.' : ' Confirm the duplicate if it is legitimate.'),
      });
    }
    if (facts.pendingProposalIds.length > 0) {
      issues.push({
        code: 'duplicate_live_proposal',
        severity: conflictSeverity,
        field: 'playerIdentity',
        message: `Another undecided proposal already covers this award, season and player`
          + ` (proposal ${facts.pendingProposalIds.map((id) => `#${id}`).join(', ')}).`
          + (values.duplicateConfirmed ? ' Confirmed as a legitimate repeat.' : ' Confirm the duplicate if it is legitimate.'),
      });
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    checkedAt: context.checkedAt,
  };
}

// ---------------------------------------------------------------------------
// Decision notes
// ---------------------------------------------------------------------------

/**
 * The ledger note rules. A rejection always keeps its reason; approving Wikipedia-derived input
 * needs a note recording the independent verification (Wikipedia is never auto-approved and never
 * a self-certifying source). Returns the trimmed note, or null for an optional blank one.
 */
export function checkDecisionNote(
  action: ProposalAction,
  note: string | null | undefined,
  sourceKind: ProposalSourceKind | null,
): string | null {
  const trimmed = trimmedOrNull(note);
  if (trimmed !== null && trimmed.length > MAX_NOTE_LENGTH) {
    throw new CuratedAwardError('invalid_input', `The note is longer than ${MAX_NOTE_LENGTH} characters.`);
  }
  if (action === 'reject' && (trimmed === null || trimmed.length < REJECT_NOTE_MIN_LENGTH)) {
    throw new CuratedAwardError('note_required',
      `A rejection needs a reason of at least ${REJECT_NOTE_MIN_LENGTH} characters.`);
  }
  if (action === 'approve' && sourceKind === 'wikipedia_offline_file'
    && (trimmed === null || trimmed.length < WIKIPEDIA_APPROVAL_NOTE_MIN_LENGTH)) {
    throw new CuratedAwardError('note_required',
      `Approving Wikipedia-derived input needs a note of at least ${WIKIPEDIA_APPROVAL_NOTE_MIN_LENGTH} characters `
      + 'recording the independent source that verified it.');
  }
  return trimmed;
}

/** The UTC calendar date (YYYY-MM-DD) of an instant. */
export function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
