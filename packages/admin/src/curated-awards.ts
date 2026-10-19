/**
 * @afldb/admin — curated award services (AFLDB V2 Stage 4, docs/v2/adr/0008-curated-awards.md).
 *
 * The audited proposal -> validation -> review -> approval workflow over migration 111's
 * `award_proposals` and `award_proposal_decisions`. Every mutating service takes
 * `(viewer, executor, input)`, checks the `data.awards.edit` capability, and runs in ONE
 * transaction:
 *
 *   - exactly one ledger row per status transition, written in the same transaction as the
 *     change (a `revise` is two transitions on two rows, so two ledger rows);
 *   - `approveProposal` re-validates inside its transaction, refuses a stale proposal, promotes
 *     through an INJECTED port (production: the existing `insertAwardWinner`, see
 *     src/db/queries/award-proposals.ts) and records the canonical row's durable key; any failure
 *     rolls the whole thing back, so a partial promotion is impossible;
 *   - `approveProposal` writes award_winners, a historical table, so it consults the season seal
 *     (`evaluateSeasonWrite`, workflow `curated_award_approval`) before promoting: a sealed season
 *     needs a decision note of 20..2000 characters (the ledger row is the audit), else it is refused
 *     with `season_sealed_correction_invalid` and nothing is written;
 *   - a correction is a new revision (`reviseProposal`); the earlier revision becomes
 *     `superseded` and is never otherwise edited.
 *
 * This module is pure apart from the SQL it sends through the injected executor. It performs no
 * network access and imports no HTTP client: Wikipedia-derived input arrives only as a locally
 * supplied file (`curated-awards-file.ts`) and only ever becomes a proposal.
 *
 * Parameterised SQL only. Every identifier in the SQL below is a literal; every value is a
 * positional parameter.
 */
import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';
import { evaluateSeasonWrite, type SealedSeasons } from '@afldb/domain';

import {
  CuratedAwardError,
  PENDING_STATUSES,
  PROPOSAL_STATUSES,
  assertCanEditAwards,
  assertCanReadAwards,
  assertTransition,
  checkDecisionNote,
  normaliseProposalInput,
  splitPlayerIdentity,
  utcDate,
  validateAwardProposal,
  valuesToJson,
  type CuratedAwardsViewer,
  type ProposalAction,
  type ProposalInput,
  type ProposalStatus,
  type ProposalValues,
  type TransitionFrom,
  type ValidationFacts,
  type ValidationResult,
} from './curated-awards-model';
import {
  parseAwardProposalFile,
  type AwardProposalFileDefaults,
  type AwardProposalFileFormat,
} from './curated-awards-file';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ServiceOptions = {
  /** Injected for deterministic tests; defaults to the system clock. */
  now?: () => Date;
};

/** One stored revision of a proposal. */
export type ProposalRecord = ProposalValues & {
  id: number;
  proposalKey: string;
  revision: number;
  revisionOfId: number | null;
  status: ProposalStatus;
  validationResult: ValidationResult | null;
  validatedAt: string | null;
  approvedEntityKey: string | null;
  approvedAt: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
};

/** One row of the append-only decision ledger. */
export type DecisionRecord = {
  id: number;
  proposalId: number;
  action: ProposalAction;
  fromStatus: ProposalStatus | null;
  toStatus: ProposalStatus;
  adminUserId: number;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  note: string | null;
  decidedAt: string;
};

export type ProposalHistory = {
  revisions: ProposalRecord[];
  decisions: DecisionRecord[];
};

/** What the promotion port needs: everything resolved, nothing left to guess. */
export type AwardPromotionRequest = {
  proposalId: number;
  proposalKey: string;
  revision: number;
  awardId: number;
  season: number;
  playerId: number;
  playerNameRaw: string;
  clubId: number | null;
  votes: string | null;
  position: string | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  note: string | null;
  /** The proposal's own confirmed-duplicate flag, passed through unchanged. */
  confirmDuplicate: boolean;
  adminUserId: number;
  /** The approval's decision note: becomes the canonical audit row's administrator note. */
  adminNote: string | null;
  evidence: {
    sourceKind: ProposalValues['sourceKind'];
    sourceUrl: string | null;
    citation: string | null;
    acquiredOn: string;
  };
};

export type AwardPromotionResult = {
  /** The durable data_overrides entity key of the award_winners row created. Never an id. */
  entityKey: string;
};

/**
 * Promotes one validated proposal into the canonical award_winners table ON THE GIVEN
 * TRANSACTION. Production wires the existing `insertAwardWinner` (src/db/queries/award-proposals.ts);
 * tests inject a stub. It must throw to refuse; it must not commit or open a transaction.
 */
export interface AwardPromotionPort {
  promote(tx: SqlExecutor, request: AwardPromotionRequest): Promise<AwardPromotionResult>;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const utcText = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** int8 comes back as a string from postgres.js: every id is cast ::int, every timestamp rendered as text. */
const PROPOSAL_COLUMNS = `
  p.id::int AS id, p.proposal_key::text AS "proposalKey", p.revision::int AS revision,
  p.revision_of_id::int AS "revisionOfId",
  p.award_slug AS "awardSlug", p.season::int AS season,
  p.player_identity AS "playerIdentity", p.player_name_raw AS "playerNameRaw", p.club_slug AS "clubSlug",
  p.votes::text AS votes, p.position AS position,
  p.is_captain AS "isCaptain", p.is_vice_captain AS "isViceCaptain", p.note AS note,
  p.duplicate_confirmed AS "duplicateConfirmed",
  p.source_kind AS "sourceKind", p.source_url AS "sourceUrl", p.citation AS citation,
  to_char(p.acquired_on, 'YYYY-MM-DD') AS "acquiredOn",
  p.status AS status, p.validation_result AS "validationResult",
  ${utcText('p.validated_at')} AS "validatedAt",
  p.approved_entity_key AS "approvedEntityKey", ${utcText('p.approved_at')} AS "approvedAt",
  p.created_by::int AS "createdBy",
  ${utcText('p.created_at')} AS "createdAt", ${utcText('p.updated_at')} AS "updatedAt"`;

const DECISION_COLUMNS = `
  d.id::int AS id, d.proposal_id::int AS "proposalId", d.action AS action,
  d.from_status AS "fromStatus", d.to_status AS "toStatus", d.admin_user_id::int AS "adminUserId",
  d.previous_values AS "previousValues", d.new_values AS "newValues", d.note AS note,
  ${utcText('d.decided_at')} AS "decidedAt"`;

const PROPOSAL_STATUS_SET = new Set<string>(PROPOSAL_STATUSES);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** jsonb arrives parsed from both drivers; tolerate a JSON string as site-settings' fromStore does. */
function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * A jsonb parameter is passed as the VALUE itself, never as a pre-stringified string: postgres.js
 * serialises by the server-described parameter type (jsonb -> JSON.stringify), so a string would be
 * stored double-encoded; PGlite accepts either form. The `$n::jsonb` cast stays explicit in the SQL.
 */
function jsonParam(value: object | null | undefined): object | null {
  return value ?? null;
}

function toProposalRecord(row: ProposalRecord): ProposalRecord {
  return {
    ...row,
    votes: row.votes === null ? null : String(row.votes),
    validationResult: asJsonObject(row.validationResult) as ValidationResult | null,
  };
}

function toDecisionRecord(row: DecisionRecord): DecisionRecord {
  return {
    ...row,
    previousValues: asJsonObject(row.previousValues),
    newValues: asJsonObject(row.newValues),
  };
}

function clockOf(options: ServiceOptions | undefined): { now: Date; today: string; iso: string } {
  const now = (options?.now ?? (() => new Date()))();
  return { now, today: utcDate(now), iso: now.toISOString() };
}

function requireProposalId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new CuratedAwardError('invalid_input', 'proposalId must be a positive integer.');
  }
  return value;
}

/** Read one proposal revision, optionally taking the row lock. Null when absent. */
async function readProposal(
  executor: SqlExecutor,
  id: number,
  forUpdate: boolean,
): Promise<ProposalRecord | null> {
  const rows = await executor.query<ProposalRecord>(
    `SELECT ${PROPOSAL_COLUMNS} FROM award_proposals p WHERE p.id = $1::bigint${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toProposalRecord(rows[0]) : null;
}

async function lockProposal(tx: SqlExecutor, id: number): Promise<ProposalRecord> {
  const proposal = await readProposal(tx, id, true);
  if (!proposal) throw new CuratedAwardError('not_found', `Proposal ${id} does not exist.`);
  return proposal;
}

type LedgerEntry = {
  proposalId: number;
  action: ProposalAction;
  from: TransitionFrom;
  to: ProposalStatus;
  adminUserId: number;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  note: string | null;
};

/** The ONLY writer of award_proposal_decisions: one call per transition, inside the transition's transaction. */
async function writeLedger(tx: SqlExecutor, entry: LedgerEntry): Promise<void> {
  assertTransition(entry.action, entry.from, entry.to);
  await tx.query(
    `INSERT INTO award_proposal_decisions
       (proposal_id, action, from_status, to_status, admin_user_id, previous_values, new_values, note)
     VALUES ($1::bigint, $2, $3, $4, $5::int, $6::jsonb, $7::jsonb, $8)`,
    [
      entry.proposalId, entry.action, entry.from, entry.to, entry.adminUserId,
      jsonParam(entry.previous), jsonParam(entry.next), entry.note,
    ],
  );
}

/** Read the database facts validation needs (inside the caller's transaction). */
async function gatherValidationFacts(
  executor: SqlExecutor,
  values: ProposalValues,
  ownProposalKey: string | null,
): Promise<ValidationFacts> {
  const [award] = await executor.query<{ id: number; slug: string; category: string }>(
    'SELECT id::int AS id, slug, category FROM awards WHERE slug = $1',
    [values.awardSlug],
  );
  const seasonRows = Number.isInteger(values.season)
    ? await executor.query<{ year: number }>('SELECT year::int AS year FROM seasons WHERE year = $1::smallint', [values.season])
    : [];

  let playerIds: number[] | null = null;
  const identity = values.playerIdentity === null ? null : splitPlayerIdentity(values.playerIdentity);
  if (identity !== null) {
    // The inverse of resolvePlayerIdentity (src/db/queries/player-identity.ts): an AFL Tables
    // identity is an afltables_profile_url row; a manual identity is a manual_admin_edit row.
    const rows = await executor.query<{ id: number }>(
      `SELECT DISTINCT e.player_id::int AS id
         FROM external_identities e
         JOIN sources s ON s.id = e.source_id
        WHERE s.key = $1 AND e.external_id = $2
          AND e.status IN ('unique', 'resolved')
          AND e.player_id IS NOT NULL
          AND ($3::text IS NULL OR e.match_method = $3)
        ORDER BY 1`,
      [identity.sourceKey, identity.externalId, identity.sourceKey === 'afltables' ? 'afltables_profile_url' : null],
    );
    playerIds = rows.map((row) => Number(row.id));
  }

  let club: ValidationFacts['club'];
  if (values.clubSlug !== null) {
    const [row] = await executor.query<{ id: number }>('SELECT id::int AS id FROM clubs WHERE slug = $1', [values.clubSlug]);
    club = row ? { id: Number(row.id) } : null;
  }

  let activeWinnerIds: number[] = [];
  if (award && playerIds !== null && playerIds.length === 1) {
    const rows = await executor.query<{ id: number }>(
      `SELECT id::int AS id FROM award_winners
        WHERE award_id = $1::int AND season = $2::smallint AND player_id = $3::int AND status = 'active'
        ORDER BY id`,
      [award.id, values.season, playerIds[0]],
    );
    activeWinnerIds = rows.map((row) => Number(row.id));
  }

  let pendingProposalIds: number[] = [];
  if (values.playerIdentity !== null && Number.isInteger(values.season)) {
    const rows = await executor.query<{ id: number }>(
      `SELECT id::int AS id FROM award_proposals
        WHERE award_slug = $1 AND season = $2::smallint AND player_identity = $3
          AND status IN ('proposed', 'validated', 'validation_failed')
          AND ($4::uuid IS NULL OR proposal_key <> $4::uuid)
        ORDER BY id`,
      [values.awardSlug, values.season, values.playerIdentity, ownProposalKey],
    );
    pendingProposalIds = rows.map((row) => Number(row.id));
  }

  return {
    award: award ? { id: Number(award.id), slug: award.slug, category: award.category } : null,
    seasonInRegister: seasonRows.length > 0,
    playerIds,
    club,
    activeWinnerIds,
    pendingProposalIds,
  };
}

function refuseInvalid(result: ValidationResult): never {
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  throw new CuratedAwardError(
    'invalid_input',
    `The proposal is not valid: ${errors.map((issue) => issue.message).join(' ')}`,
    errors,
  );
}

/** Insert one row + its `create` ledger row. The caller supplies the transaction. */
async function insertProposalWithLedger(
  tx: SqlExecutor,
  viewer: CuratedAwardsViewer,
  values: ProposalValues,
  action: 'create' | 'revise',
  context: { today: string; iso: string },
  extra: { proposalKey?: string; revision?: number; revisionOfId?: number; note: string | null; ledgerPrevious?: Record<string, unknown> | null; ledgerExtra?: Record<string, unknown> },
): Promise<ProposalRecord> {
  const shape = validateAwardProposal(values, null, { today: context.today, checkedAt: context.iso });
  if (!shape.ok) refuseInvalid(shape);

  const inserted = await tx.query<{ id: number }>(
    `INSERT INTO award_proposals
       (proposal_key, revision, revision_of_id, award_slug, season, player_identity, player_name_raw,
        club_slug, votes, position, is_captain, is_vice_captain, note, duplicate_confirmed,
        source_kind, source_url, citation, acquired_on, created_by)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2::smallint, $3::bigint, $4, $5::smallint, $6, $7,
             $8, $9::numeric, $10, $11, $12, $13, $14,
             $15, $16, $17, $18::date, $19::int)
     RETURNING id::int AS id`,
    [
      extra.proposalKey ?? null, extra.revision ?? 1, extra.revisionOfId ?? null,
      values.awardSlug, values.season, values.playerIdentity, values.playerNameRaw,
      values.clubSlug, values.votes, values.position, values.isCaptain, values.isViceCaptain,
      values.note, values.duplicateConfirmed,
      values.sourceKind, values.sourceUrl, values.citation, values.acquiredOn, viewer.userId,
    ],
  );
  const id = Number(inserted[0]?.id);
  if (!Number.isInteger(id)) throw new CuratedAwardError('concurrent_modification', 'The proposal row was not written.');

  await writeLedger(tx, {
    proposalId: id,
    action,
    from: null,
    to: 'proposed',
    adminUserId: viewer.userId,
    previous: extra.ledgerPrevious ?? null,
    next: { ...valuesToJson(values), ...(extra.ledgerExtra ?? {}) },
    note: extra.note,
  });
  const record = await readProposal(tx, id, false);
  if (!record) throw new CuratedAwardError('concurrent_modification', 'The proposal row could not be read back.');
  return record;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export type CreateProposalInput = ProposalInput & { decisionNote?: string | null };

/**
 * Create a proposal (status `proposed`). The input must be storable — evidence present, season in
 * range, and so on — or it is refused with `invalid_input`; identity, award, duplicate and register
 * checks need the database and run in `validateProposal`.
 */
export async function createProposal(
  viewer: CuratedAwardsViewer,
  executor: TransactionalSqlExecutor,
  input: CreateProposalInput,
  options?: ServiceOptions,
): Promise<ProposalRecord> {
  assertCanEditAwards(viewer);
  const clock = clockOf(options);
  const values = normaliseProposalInput(input);
  const note = checkDecisionNote('create', input.decisionNote, values.sourceKind);
  return executor.transaction((tx) => insertProposalWithLedger(tx, viewer, values, 'create', clock, { note }));
}

/**
 * Create proposals from a locally supplied file — ALL or NOTHING. The pure parser refuses the whole
 * file on any invalid row; the proposals are then created in one transaction. Creates proposals
 * only: it validates nothing against the database and approves nothing, whatever the source.
 */
export async function createProposalsFromFile(
  viewer: CuratedAwardsViewer,
  executor: TransactionalSqlExecutor,
  input: {
    text: string;
    format: AwardProposalFileFormat;
    defaults?: AwardProposalFileDefaults;
    decisionNote?: string | null;
  },
  options?: ServiceOptions,
): Promise<ProposalRecord[]> {
  assertCanEditAwards(viewer);
  const clock = clockOf(options);
  const parsed = parseAwardProposalFile(input.text, input.format, input.defaults ?? {}, clock.today);
  if (!parsed.ok) {
    throw new CuratedAwardError(
      'invalid_file',
      `The file was refused whole: ${parsed.errors.length} problem(s), first: ${parsed.errors[0]?.message ?? 'unknown'}`,
      parsed.errors.flatMap((error) => error.issues),
    );
  }
  const note = checkDecisionNote('create', input.decisionNote, null);
  return executor.transaction(async (tx) => {
    const created: ProposalRecord[] = [];
    for (const [index, proposal] of parsed.proposals.entries()) {
      created.push(await insertProposalWithLedger(
        tx, viewer, normaliseProposalInput(proposal), 'create', clock,
        { note, ledgerExtra: { file_row: index + 1, file_format: input.format } },
      ));
    }
    return created;
  });
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

export type DecisionInput = { proposalId: number; decisionNote?: string | null };

/** Validate against the database; moves the proposal to `validated` or `validation_failed`. */
export async function validateProposal(
  viewer: CuratedAwardsViewer,
  executor: TransactionalSqlExecutor,
  input: DecisionInput,
  options?: ServiceOptions,
): Promise<ProposalRecord> {
  assertCanEditAwards(viewer);
  const proposalId = requireProposalId(input.proposalId);
  const clock = clockOf(options);
  return executor.transaction(async (tx) => {
    const proposal = await lockProposal(tx, proposalId);
    // Early: only a pending proposal can be (re)validated; refuse before any lookup.
    assertTransition('validate', proposal.status, 'validated');
    const note = checkDecisionNote('validate', input.decisionNote, proposal.sourceKind);
    const facts = await gatherValidationFacts(tx, proposal, proposal.proposalKey);
    const result = validateAwardProposal(proposal, facts, { today: clock.today, checkedAt: clock.iso });
    const to: ProposalStatus = result.ok ? 'validated' : 'validation_failed';
    assertTransition('validate', proposal.status, to);

    const updated = await tx.query<{ id: number }>(
      `UPDATE award_proposals
          SET status = $2, validation_result = $3::jsonb, validated_at = now(), updated_at = now()
        WHERE id = $1::bigint AND status = $4
        RETURNING id::int AS id`,
      [proposalId, to, jsonParam(result), proposal.status],
    );
    if (updated.length !== 1) throw new CuratedAwardError('concurrent_modification', `Proposal ${proposalId} changed while it was being validated.`);

    await writeLedger(tx, {
      proposalId,
      action: 'validate',
      from: proposal.status,
      to,
      adminUserId: viewer.userId,
      previous: { status: proposal.status, validation_result: proposal.validationResult },
      next: { status: to, validation_result: result },
      note,
    });
    return (await readProposal(tx, proposalId, false)) as ProposalRecord;
  });
}

// ---------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------

export type ApproveDependencies = {
  promotion: AwardPromotionPort;
  /**
   * REQUIRED: the sealed-season range, built by the caller from data/reference/seasons.json
   * (`sealedSeasonsFrom`). The package does no file I/O. An approval into a sealed season is an
   * audited correction (workflow `curated_award_approval`) and needs a valid decision note.
   */
  sealed: SealedSeasons;
};

/**
 * Approve a `validated` proposal: ONE transaction that re-validates, promotes through the injected
 * port, records the canonical row's durable key and writes the ledger row. Any failure — a stale
 * validation, a refusal by the port, a concurrent change — rolls all of it back.
 *
 * `deps.sealed` is the season seal (V2 historical-baseline.md §2): after the re-validation and BEFORE
 * the port is called, `evaluateSeasonWrite` decides whether the proposal's season may be written.
 * An open season proceeds as before; a sealed season proceeds only as an audited correction
 * (workflow `curated_award_approval`, the approver as actor, the decision note as the reason, the
 * proposal as evidence), which needs a note of 20..2000 characters. Otherwise it is refused with
 * `season_sealed_correction_invalid`, and nothing is written.
 */
export async function approveProposal(
  viewer: CuratedAwardsViewer,
  executor: TransactionalSqlExecutor,
  input: DecisionInput,
  deps: ApproveDependencies,
  options?: ServiceOptions,
): Promise<{ proposal: ProposalRecord; promotion: AwardPromotionResult }> {
  assertCanEditAwards(viewer);
  const proposalId = requireProposalId(input.proposalId);
  const clock = clockOf(options);
  return executor.transaction(async (tx) => {
    const proposal = await lockProposal(tx, proposalId);
    assertTransition('approve', proposal.status, 'approved');
    const note = checkDecisionNote('approve', input.decisionNote, proposal.sourceKind);

    // Serialise approvals of the same award and season; the row lock above already serialises
    // everything that touches this proposal.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`award_proposal:${proposal.awardSlug}:${proposal.season}`]);

    const facts = await gatherValidationFacts(tx, proposal, proposal.proposalKey);
    const result = validateAwardProposal(proposal, facts, { today: clock.today, checkedAt: clock.iso });
    if (!result.ok) {
      throw new CuratedAwardError(
        'stale_validation',
        'The proposal no longer validates; revalidate it before approving.',
        result.issues.filter((issue) => issue.severity === 'error'),
      );
    }
    const awardId = facts.award?.id;
    const playerId = facts.playerIds?.[0];
    if (awardId === undefined || playerId === undefined) {
      throw new CuratedAwardError('stale_validation', 'The proposal no longer resolves to an award and a player.');
    }

    // The seal: award_winners is historical. Decided before the port is called, inside the
    // transaction, so a refusal rolls back with no status change, no ledger row and no winner.
    const sealDecision = evaluateSeasonWrite({
      season: proposal.season,
      sealed: deps.sealed,
      correction: {
        workflow: 'curated_award_approval',
        actorUserId: viewer.userId,
        note: note ?? '',
        evidenceRef: `award_proposals:${proposalId}`,
      },
    });
    if (!sealDecision.allowed) {
      throw new CuratedAwardError('season_sealed_correction_invalid', sealDecision.message);
    }

    const promotion = await deps.promotion.promote(tx, {
      proposalId,
      proposalKey: proposal.proposalKey,
      revision: proposal.revision,
      awardId,
      season: proposal.season,
      playerId,
      playerNameRaw: proposal.playerNameRaw,
      clubId: facts.club ? facts.club.id : null,
      votes: proposal.votes,
      position: proposal.position,
      isCaptain: proposal.isCaptain,
      isViceCaptain: proposal.isViceCaptain,
      note: proposal.note,
      confirmDuplicate: proposal.duplicateConfirmed,
      adminUserId: viewer.userId,
      adminNote: note,
      evidence: {
        sourceKind: proposal.sourceKind,
        sourceUrl: proposal.sourceUrl,
        citation: proposal.citation,
        acquiredOn: proposal.acquiredOn,
      },
    });

    const updated = await tx.query<{ id: number }>(
      `UPDATE award_proposals
          SET status = 'approved', validation_result = $2::jsonb, validated_at = now(),
              approved_entity_key = $3, approved_at = now(), updated_at = now()
        WHERE id = $1::bigint AND status = 'validated'
        RETURNING id::int AS id`,
      [proposalId, jsonParam(result), promotion.entityKey],
    );
    if (updated.length !== 1) throw new CuratedAwardError('concurrent_modification', `Proposal ${proposalId} changed while it was being approved.`);

    await writeLedger(tx, {
      proposalId,
      action: 'approve',
      from: 'validated',
      to: 'approved',
      adminUserId: viewer.userId,
      previous: { status: 'validated', approved_entity_key: null },
      next: { status: 'approved', approved_entity_key: promotion.entityKey, validation_result: result },
      note,
    });
    return { proposal: (await readProposal(tx, proposalId, false)) as ProposalRecord, promotion };
  });
}

// ---------------------------------------------------------------------------
// reject
// ---------------------------------------------------------------------------

/** Reject a pending proposal. The reason is mandatory and kept in the ledger. */
export async function rejectProposal(
  viewer: CuratedAwardsViewer,
  executor: TransactionalSqlExecutor,
  input: DecisionInput,
): Promise<ProposalRecord> {
  assertCanEditAwards(viewer);
  const proposalId = requireProposalId(input.proposalId);
  return executor.transaction(async (tx) => {
    const proposal = await lockProposal(tx, proposalId);
    assertTransition('reject', proposal.status, 'rejected');
    const note = checkDecisionNote('reject', input.decisionNote, proposal.sourceKind);

    const updated = await tx.query<{ id: number }>(
      `UPDATE award_proposals SET status = 'rejected', updated_at = now()
        WHERE id = $1::bigint AND status = $2
        RETURNING id::int AS id`,
      [proposalId, proposal.status],
    );
    if (updated.length !== 1) throw new CuratedAwardError('concurrent_modification', `Proposal ${proposalId} changed while it was being rejected.`);

    await writeLedger(tx, {
      proposalId,
      action: 'reject',
      from: proposal.status,
      to: 'rejected',
      adminUserId: viewer.userId,
      previous: { status: proposal.status },
      next: { status: 'rejected' },
      note,
    });
    return (await readProposal(tx, proposalId, false)) as ProposalRecord;
  });
}

// ---------------------------------------------------------------------------
// revise
// ---------------------------------------------------------------------------

export type ReviseInput = {
  proposalId: number;
  changes: Partial<ProposalInput>;
  decisionNote?: string | null;
};

/**
 * Correct a pending proposal by creating revision n+1. The earlier revision becomes `superseded`
 * (its own ledger row) and is never edited again; the new revision starts at `proposed` and must be
 * validated afresh.
 *
 * An APPROVED proposal cannot be revised here: its winner already exists in award_winners, and a
 * correction of a canonical row is the existing replace/correct lifecycle in
 * src/db/queries/admin-awards.ts (`replaceAwardWinner` / `correctAwardWinner`). Refused with the typed
 * code `approved_revision_unsupported` (tracked as a follow-up gap, not built as a partial path).
 */
export async function reviseProposal(
  viewer: CuratedAwardsViewer,
  executor: TransactionalSqlExecutor,
  input: ReviseInput,
  options?: ServiceOptions,
): Promise<{ superseded: ProposalRecord; revision: ProposalRecord }> {
  assertCanEditAwards(viewer);
  const proposalId = requireProposalId(input.proposalId);
  const clock = clockOf(options);
  return executor.transaction(async (tx) => {
    const current = await lockProposal(tx, proposalId);
    if (current.status === 'approved') {
      throw new CuratedAwardError(
        'approved_revision_unsupported',
        'An approved proposal already produced an award_winners row. Correct that row through the awards '
        + 'admin replace/correct path; revising the proposal would not change it.',
      );
    }
    if (!PENDING_STATUSES.includes(current.status)) {
      throw new CuratedAwardError('illegal_transition', `A ${current.status} proposal cannot be revised.`);
    }
    assertTransition('supersede', current.status, 'superseded');
    const note = checkDecisionNote('revise', input.decisionNote, current.sourceKind);

    const changes = Object.fromEntries(
      Object.entries(input.changes ?? {}).filter(([, value]) => value !== undefined),
    ) as Partial<ProposalInput>;
    const next = normaliseProposalInput({ ...current, ...changes });
    if (JSON.stringify(valuesToJson(next)) === JSON.stringify(valuesToJson(current))) {
      throw new CuratedAwardError('no_change', 'The revision changes nothing.');
    }
    const shape = validateAwardProposal(next, null, { today: clock.today, checkedAt: clock.iso });
    if (!shape.ok) refuseInvalid(shape);

    // Supersede first: the unique "one live revision per proposal" index forbids two live rows.
    const superseded = await tx.query<{ id: number }>(
      `UPDATE award_proposals SET status = 'superseded', updated_at = now()
        WHERE id = $1::bigint AND status = $2
        RETURNING id::int AS id`,
      [proposalId, current.status],
    );
    if (superseded.length !== 1) throw new CuratedAwardError('concurrent_modification', `Proposal ${proposalId} changed while it was being revised.`);
    await writeLedger(tx, {
      proposalId,
      action: 'supersede',
      from: current.status,
      to: 'superseded',
      adminUserId: viewer.userId,
      previous: { status: current.status },
      next: { status: 'superseded', superseded_by_revision: current.revision + 1 },
      note,
    });

    const revision = await insertProposalWithLedger(tx, viewer, next, 'revise', clock, {
      proposalKey: current.proposalKey,
      revision: current.revision + 1,
      revisionOfId: current.id,
      note,
      ledgerPrevious: valuesToJson(current),
      ledgerExtra: { revision: current.revision + 1, revision_of_id: current.id },
    });
    return { superseded: (await readProposal(tx, proposalId, false)) as ProposalRecord, revision };
  });
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export type ProposalFilter = {
  status?: ProposalStatus;
  awardSlug?: string;
  season?: number;
  /** Superseded revisions are history; they are listed only on request. */
  includeSuperseded?: boolean;
  limit?: number;
};

/** List proposals, newest first. Needs `data.awards.read`. */
export async function listProposals(
  viewer: CuratedAwardsViewer,
  executor: SqlExecutor,
  filter: ProposalFilter = {},
): Promise<ProposalRecord[]> {
  assertCanReadAwards(viewer);
  if (filter.status !== undefined && !PROPOSAL_STATUS_SET.has(filter.status)) {
    throw new CuratedAwardError('invalid_input', `Unknown status '${String(filter.status)}'.`);
  }
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 200), 1), 500);
  const rows = await executor.query<ProposalRecord>(
    `SELECT ${PROPOSAL_COLUMNS}
       FROM award_proposals p
      WHERE ($1::text IS NULL OR p.status = $1)
        AND ($2::text IS NULL OR p.award_slug = $2)
        AND ($3::int IS NULL OR p.season = $3::smallint)
        AND ($4::boolean OR p.status <> 'superseded')
      ORDER BY p.id DESC
      LIMIT $5::int`,
    [filter.status ?? null, filter.awardSlug ?? null, filter.season ?? null, filter.includeSuperseded === true, limit],
  );
  return rows.map(toProposalRecord);
}

/** Every revision of one proposal and every ledger row on any of them, oldest first. Needs `data.awards.read`. */
export async function readProposalHistory(
  viewer: CuratedAwardsViewer,
  executor: SqlExecutor,
  input: { proposalId: number },
): Promise<ProposalHistory> {
  assertCanReadAwards(viewer);
  const proposalId = requireProposalId(input.proposalId);
  const anchor = await readProposal(executor, proposalId, false);
  if (!anchor) throw new CuratedAwardError('not_found', `Proposal ${proposalId} does not exist.`);

  const revisions = await executor.query<ProposalRecord>(
    `SELECT ${PROPOSAL_COLUMNS} FROM award_proposals p
      WHERE p.proposal_key = $1::uuid ORDER BY p.revision`,
    [anchor.proposalKey],
  );
  const decisions = await executor.query<DecisionRecord>(
    `SELECT ${DECISION_COLUMNS} FROM award_proposal_decisions d
      WHERE d.proposal_id IN (SELECT id FROM award_proposals WHERE proposal_key = $1::uuid)
      ORDER BY d.id`,
    [anchor.proposalKey],
  );
  return { revisions: revisions.map(toProposalRecord), decisions: decisions.map(toDecisionRecord) };
}

/** The statuses still awaiting a decision, re-exported for the Stage 5 queue. */
export { PENDING_STATUSES };
