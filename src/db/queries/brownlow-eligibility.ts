import 'server-only';

import {
  nativeTransactionOf,
  type SqlExecutor,
  type TransactionalSqlExecutor,
} from '@afldb/db';
import {
  BROWNLOW_ELIGIBILITY_VERDICTS,
  determineBrownlowMedal,
  isEligibilityEvidenceFinding,
  reconcileBrownlowSeason,
  type BrownlowEligibilityVerdict,
  type BrownlowMedalDetermination,
  type BrownlowPlayerEligibilityEvidence,
  type BrownlowProviderProvenance,
  type BrownlowReviewPlayer,
} from '@afldb/derived';
import { evaluateSeasonWrite, type AuditedCorrection, type SealedSeasons, type SeasonRegistry } from '@afldb/domain';

import { BROWNLOW_VOTE_SOURCE_KEY, loadBrownlowReconciliationInput, loadStagedLeaderboard } from '@/db/queries/brownlow-reconciliation-inputs';
import { recordDataEdit } from '@/db/queries/audit-log';
import { recomputeBrownlowCareerTotals } from '@/db/queries/player-derived';
import { resolvePlayerIdentity } from '@/db/queries/player-identity';
import { hasCapability, type CapabilityViewer } from '@/lib/auth/capabilities';

/**
 * Brownlow eligibility evidence and the audited eligibility DECISION (AFLDB V2 Launch F, stream F-D;
 * docs/v2/adr/0014-brownlow-eligibility.md; migration 113 `brownlow_eligibility_decisions`).
 *
 * TWO JOBS, over the {@link SqlExecutor} port (parameterised SQL only; ids cast `::int` and coerced
 * with `Number()`, because postgres.js returns int8 as a STRING):
 *
 *  1. {@link loadBrownlowEligibilityEvidence} - READ-ONLY. For every requested vote-getter it
 *     gathers the RAW facts the pure determination (`determineBrownlowMedal`) needs: the player's
 *     CURRENT administrator decision, the facts of the player's `brownlow_season_votes` row, the AFL
 *     API staged `eligible` flags, and whether the season is administrator-published
 *     (`brownlow_season_authority.published_revision IS NOT NULL`). It does not interpret them.
 *  2. {@link recordBrownlowEligibilityDecision} - the ONE writer of the ledger: ONE transaction, a
 *     per-season advisory lock, every refusal decided before anything is inserted, and at most one
 *     INSERT into `brownlow_eligibility_decisions`. The application caller also projects medal and
 *     eligibility metadata atomically; raw votes and staging are never changed by this decision.
 *
 * DURABLE IDENTITY. A decision names its player by the durable identity string
 * (`afltables:<profile path>` or `manual_admin_edit:<token>`), never by `players.id` (a rebuild or a
 * promotion renumbers it). The identity is resolved by the repository's one identity function,
 * `resolvePlayerIdentity` (src/db/queries/player-identity.ts), REUSED, not copied: it wants the
 * postgres.js `TransactionSql`, which an executor made by `@afldb/db` hands over through
 * `nativeTransactionOf`. Consequently both functions need the postgres.js adapter (production, or
 * an integration test); over any other executor (PGlite) they throw
 * {@link BrownlowEligibilityInfrastructureError} rather than guess an identity. The loader resolves
 * one player at a time (two cheap statements each) inside its single transaction.
 *
 * JSONB PARAMETERS. The seal's audit record is passed as `JSON.stringify(x)` with the cast
 * `$n::text::jsonb`, NOT `$n::jsonb`: over the real postgres.js adapter a string bound straight to a
 * `jsonb` parameter is serialised AGAIN and stored as a jsonb STRING (the migration's
 * `correction ->> 'workflow'` check then fails). Going through `text` is single-encoded by both
 * postgres.js and PGlite. Proved against PostgreSQL by tests/integration/v2-brownlow-eligibility.test.ts.
 *
 * LOCKING. `afldb_import` has no UPDATE privilege on the ledger, so `SELECT ... FOR UPDATE` is
 * unavailable by design; writers serialise with `pg_advisory_xact_lock(hashtext(namespace), season)`
 * and the two partial unique indexes of migration 113 are the backstop.
 */

/** The capability that gates a decision: Super Admin only. Checked FIRST, before any SQL. */
export const BROWNLOW_ELIGIBILITY_CAPABILITY = 'data.brownlow.finalise' as const;

/** The audited-correction workflow a decision into a sealed season must carry (season-seal.ts). */
export const BROWNLOW_ELIGIBILITY_WORKFLOW = 'brownlow_eligibility_decision' as const;

/** The advisory-lock namespace (first key); the second key is the season. */
const LOCK_NAMESPACE = 'brownlow_eligibility_decisions';

export const BROWNLOW_CITATION_MAX_LENGTH = 2000;
export const BROWNLOW_DECISION_NOTE_MIN_LENGTH = 20;
export const BROWNLOW_DECISION_NOTE_MAX_LENGTH = 2000;

/** Raised when the executor is not the postgres.js adapter, so the durable identity cannot be resolved. */
export class BrownlowEligibilityInfrastructureError extends Error {
  readonly code = 'executor_unsupported' as const;

  constructor() {
    super(
      'Brownlow eligibility needs the postgres.js transaction executor made by @afldb/db '
      + '(player identity is resolved by resolvePlayerIdentity, which wants the native transaction).',
    );
    this.name = 'BrownlowEligibilityInfrastructureError';
  }
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

/** One row of the ledger. JSON-safe (the timestamp is an ISO string). */
export interface BrownlowEligibilityDecisionView {
  id: number;
  season: number;
  playerIdentity: string;
  /** A snapshot of players.id when the decision was made; NOT a durable reference. */
  playerIdAtDecision: number;
  verdict: BrownlowEligibilityVerdict;
  citation: string;
  note: string;
  decidedBy: number;
  decidedAt: string;
  basis: 'open_season' | 'audited_correction';
  /** The season seal's audit record; null for an open season. */
  correction: Record<string, unknown> | null;
  supersedesId: number | null;
  /** No later decision supersedes it: the one the determination uses. */
  current: boolean;
}

export interface BrownlowPlayerIdentityView {
  playerId: number;
  /** `resolved` has an identity; `missing` holds neither identity; `ambiguous` holds several (refused, never chosen). */
  state: 'resolved' | 'missing' | 'ambiguous';
  identity: string | null;
}

export interface BrownlowEligibilityEvidence {
  season: number;
  seasonAdminPublished: boolean;
  /** One entry per requested player id (sorted), in the shape `determineBrownlowMedal` takes. */
  players: BrownlowPlayerEligibilityEvidence[];
  identities: BrownlowPlayerIdentityView[];
  /** Every decision of the season, oldest first (the superseding chains), each marked `current`. */
  decisions: BrownlowEligibilityDecisionView[];
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

interface DecisionRow {
  id: number | string;
  season: number | string;
  playerIdentity: string;
  playerIdAtDecision: number | string;
  verdict: string;
  citation: string;
  note: string;
  decidedBy: number | string;
  decidedAt: string;
  basis: string;
  correction: unknown;
  supersedesId: number | string | null;
  current: boolean;
}

const DECISION_COLUMNS = `d.id::int AS id, d.season::int AS season, d.player_identity AS "playerIdentity",
            d.player_id_at_decision::int AS "playerIdAtDecision", d.verdict, d.citation, d.note,
            d.decided_by::int AS "decidedBy",
            to_char(d.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "decidedAt",
            d.basis, d.correction, d.supersedes_id::int AS "supersedesId",
            NOT EXISTS (SELECT 1 FROM brownlow_eligibility_decisions s WHERE s.supersedes_id = d.id) AS current`;

/** A jsonb value as a driver may hand it back: parsed already, or (defensively) as JSON text. */
function jsonObjectOrNull(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

function decisionViewOf(row: DecisionRow): BrownlowEligibilityDecisionView {
  return {
    id: Number(row.id),
    season: Number(row.season),
    playerIdentity: row.playerIdentity,
    playerIdAtDecision: Number(row.playerIdAtDecision),
    verdict: row.verdict as BrownlowEligibilityVerdict,
    citation: row.citation,
    note: row.note,
    decidedBy: Number(row.decidedBy),
    decidedAt: row.decidedAt,
    basis: row.basis as BrownlowEligibilityDecisionView['basis'],
    correction: jsonObjectOrNull(row.correction),
    supersedesId: row.supersedesId === null ? null : Number(row.supersedesId),
    current: row.current,
  };
}

export interface BrownlowEligibilityEvidenceRequest {
  readonly season: number;
  /** The vote-getters of the season (from the reconciliation basis); duplicates are folded. */
  readonly playerIds: readonly number[];
}

/**
 * The raw eligibility evidence of one season's vote-getters. READ-ONLY (the transaction is declared
 * read-only). Needs the postgres.js adapter (see the header).
 */
export async function loadBrownlowEligibilityEvidence(
  executor: TransactionalSqlExecutor,
  request: BrownlowEligibilityEvidenceRequest,
): Promise<BrownlowEligibilityEvidence> {
  return executor.transaction(async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY');
    return loadEligibilityInTransaction(tx, request);
  });
}

async function loadEligibilityInTransaction(
  tx: SqlExecutor,
  request: BrownlowEligibilityEvidenceRequest,
): Promise<BrownlowEligibilityEvidence> {
  const { season } = request;
  const playerIds = [...new Set(request.playerIds)].sort((a, b) => a - b);

    const native = nativeTransactionOf(tx);
    if (native === undefined) throw new BrownlowEligibilityInfrastructureError();

    const decisionRows = await tx.query<DecisionRow>(
      `SELECT ${DECISION_COLUMNS}
         FROM brownlow_eligibility_decisions d
        WHERE d.season = $1::int
        ORDER BY d.id`,
      [season],
    );
    const decisions = decisionRows.map(decisionViewOf);
    const currentByIdentity = new Map(decisions.filter((d) => d.current).map((d) => [d.playerIdentity, d]));

    const published = await tx.query<{ published: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM brownlow_season_authority a
                       WHERE a.season = $1::int AND a.published_revision IS NOT NULL) AS published`,
      [season],
    );
    const storedRows = await tx.query<{ playerId: number | string; isIneligible: boolean; eligibleRank: number | string | null }>(
      `SELECT b.player_id::int AS "playerId", b.is_ineligible AS "isIneligible", b.eligible_rank::int AS "eligibleRank"
         FROM brownlow_season_votes b
        WHERE b.season = $1::int`,
      [season],
    );
    const storedById = new Map(storedRows.map((row) => [Number(row.playerId), {
      isIneligible: row.isIneligible,
      eligibleRank: row.eligibleRank === null ? null : Number(row.eligibleRank),
    }]));
    // The provider's eligibility, record by record. A NULL (absent, null or non-boolean in the source) is UNKNOWN:
    // it is counted apart and never folded into either flag. Version/batch ids are kept as provenance.
    const stagedRows = await tx.query<{
      playerId: number | string; anyEligible: boolean; anyIneligible: boolean; unknownRecords: number | string;
      observations: number | string; versionSeqs: Array<number | string>; batchIds: Array<number | string>;
    }>(
      `SELECT v.player_id::int AS "playerId",
              COALESCE(bool_or(v.eligible), false) AS "anyEligible",
              COALESCE(bool_or(v.eligible IS NOT NULL AND NOT v.eligible), false) AS "anyIneligible",
              count(*) FILTER (WHERE v.eligible IS NULL)::int AS "unknownRecords",
              count(*)::int AS observations,
              array_agg(DISTINCT v.version_seq ORDER BY v.version_seq) AS "versionSeqs",
              array_agg(DISTINCT v.projected_by_batch_id ORDER BY v.projected_by_batch_id) AS "batchIds"
         FROM staging.afl_api_brownlow_vote v
         JOIN sources s ON s.id = v.source_id
        WHERE s.key = $2
          AND v.family = 'brownlow_match_votes'
          AND v.season = $1::int
          AND v.player_id IS NOT NULL
        GROUP BY v.player_id`,
      [season, BROWNLOW_VOTE_SOURCE_KEY],
    );
    interface StagedProvider { flags: boolean[]; unknown: number; provenance: BrownlowProviderProvenance }
    const stagedById = new Map<number, StagedProvider>(stagedRows.map((row) => {
      const flags: boolean[] = [];
      if (row.anyEligible) flags.push(true);
      if (row.anyIneligible) flags.push(false);
      return [Number(row.playerId), {
        flags,
        unknown: Number(row.unknownRecords),
        provenance: {
          source: BROWNLOW_VOTE_SOURCE_KEY,
          families: ['brownlow_match_votes'],
          observations: Number(row.observations),
          versionSeqs: row.versionSeqs.filter((n) => n !== null).map(Number),
          batchIds: row.batchIds.filter((n) => n !== null).map(Number),
        },
      }] as const;
    }));
    // The staged leaderboard is the second provider record of the same snapshot; fold it in the same way.
    // Mirrors the reconciliation's stored-only fallback: a season with no staged vote records has no provider snapshot.
    const leaderboard = stagedRows.length === 0 ? null : (await loadStagedLeaderboard(tx, season)).board;
    for (const entry of leaderboard?.entries ?? []) {
      if (entry.playerId === null) continue;
      const staged = stagedById.get(entry.playerId) ?? {
        flags: [], unknown: 0,
        provenance: { source: BROWNLOW_VOTE_SOURCE_KEY, families: [], observations: 0, versionSeqs: [], batchIds: [] },
      };
      if (entry.eligible === null) staged.unknown += 1;
      else if (!staged.flags.includes(entry.eligible)) staged.flags.push(entry.eligible);
      staged.provenance = {
        ...staged.provenance,
        families: [...new Set([...staged.provenance.families, 'brownlow_leaderboard'])].sort(),
        observations: staged.provenance.observations + 1,
      };
      stagedById.set(entry.playerId, staged);
    }

    const identities: BrownlowPlayerIdentityView[] = [];
    const players: BrownlowPlayerEligibilityEvidence[] = [];
    for (const playerId of playerIds) {
      const resolved = await resolvePlayerIdentity(native, playerId);
      const identity: BrownlowPlayerIdentityView = !resolved.ok
        ? { playerId, state: 'ambiguous', identity: null }
        : resolved.identity === null
          ? { playerId, state: 'missing', identity: null }
          : { playerId, state: 'resolved', identity: resolved.identity };
      identities.push(identity);
      const current = identity.identity === null ? undefined : currentByIdentity.get(identity.identity);
      players.push({
        playerId,
        decision: current === undefined ? null : { decisionId: current.id, verdict: current.verdict },
        stored: storedById.get(playerId) ?? null,
        stagedFlags: stagedById.get(playerId)?.flags ?? [],
        stagedUnknown: stagedById.get(playerId)?.unknown ?? 0,
        providerProvenance: stagedById.get(playerId)?.provenance ?? null,
      });
    }
    return {
      season,
      seasonAdminPublished: published[0]?.published === true,
      players,
      identities,
      decisions,
    };
}

/**
 * What a publication attempt did (see {@link publishBrownlowEligibilityInTransaction}): `published` wrote every
 * eligibility field; `partial` wrote only the winner flags because unknown eligibility prevents stating the ranks;
 * `withheld` left the stored rows exactly as they were.
 */
export interface BrownlowPublicationSummary {
  state: 'published' | 'unchanged' | 'partial' | 'withheld' | 'no_stored_totals';
  /** Vote-getters whose eligibility is unknown (the reason a publication is partial or withheld). */
  unresolvedPlayerIds: number[];
}

/** Raised, rolling the caller's transaction back, when a publication that must be authoritative cannot be. */
export class BrownlowPublicationRefusedError extends Error {
  readonly code = 'publication_refused_unknown_eligibility' as const;

  constructor(readonly unresolved: readonly BrownlowReviewPlayer[]) {
    super(
      `Brownlow publication refused: ${unresolved.length} vote-getter(s) have unknown eligibility `
      + `(players ${unresolved.map((player) => player.playerId).join(', ')}), so the winner and eligible ranks cannot be published.`,
    );
    this.name = 'BrownlowPublicationRefusedError';
  }
}

export interface BrownlowPublicationRequest {
  season: number;
  registry: SeasonRegistry;
  actorId: number;
  note: string;
  /**
   * What to do when a vote-getter's eligibility is unknown. `withhold` (default) leaves the stored rows exactly
   * as they were and reports why; `refuse` throws {@link BrownlowPublicationRefusedError} so the caller's
   * transaction rolls back (for a caller that must publish authoritatively or not at all).
   */
  onUnresolved?: 'withhold' | 'refuse';
}

/** Project medal and eligibility metadata. Raw votes and their provenance remain intact;
 * the required audit retains the previous eligibility source statement.
 * Shared by audited decisions and the explicit reconciliation rehearsal. The caller owns the
 * transaction; audit failure aborts the projection. No schema addition is needed.
 *
 * BP-2025-ELIGIBILITY-v1: stored eligible ranks and ineligibility flags are authoritative output, so they are
 * written only when every vote-getter's eligibility is known (`rankingDeterminate`); an unknown is never written
 * as ineligible or eligible. While any is unknown only the winner flags follow the determination (a winner it
 * can state, or none, so a stale default winner never survives a leader whose eligibility is in question); the
 * summary says what was done and why. */
export async function publishBrownlowEligibilityInTransaction(
  tx: SqlExecutor,
  request: BrownlowPublicationRequest,
): Promise<{ determination: BrownlowMedalDetermination; changed: boolean; publication: BrownlowPublicationSummary }> {
  const native = nativeTransactionOf(tx);
  if (!native) throw new BrownlowEligibilityInfrastructureError();
  await tx.query('SELECT pg_advisory_xact_lock(717275, 3)');
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), $2::int)', [LOCK_NAMESPACE, request.season]);
  const input = await loadBrownlowReconciliationInput(tx, {
    season: request.season, registry: request.registry, generatedAt: new Date().toISOString(), storedOnlyFallback: true,
  });
  const stored = input.storedTotals ?? [];
  const evidence = await loadEligibilityInTransaction(tx, { season: request.season, playerIds: stored.map((r) => r.playerId) });
  if (evidence.seasonAdminPublished) input.seasonState = 'complete';
  const report = reconcileBrownlowSeason(input);
  let determination = determineBrownlowMedal({ report, ...evidence });
  let winners = determination.status === 'determined' ? determination.winners.map((w) => w.playerId) : [];
  const previous = stored.filter((r) => r.isWinner).map((r) => r.playerId).sort((a, b) => a - b);
  // There is no public projection without authoritative season totals. Staged votes alone
  // remain proposals and never replace historical raw totals.
  if (stored.length === 0) return { determination, changed: false, publication: { state: 'no_stored_totals', unresolvedPlayerIds: [] } };
  if (!determination.rankingDeterminate) {
    if (request.onUnresolved === 'refuse') throw new BrownlowPublicationRefusedError(determination.unresolvedPlayers);
    const unresolvedPlayerIds = determination.unresolvedPlayers.map((player) => player.playerId);
    const staleFlags = stored.filter((row) => row.isWinner !== winners.includes(row.playerId));
    if (staleFlags.length === 0) return { determination, changed: false, publication: { state: 'withheld', unresolvedPlayerIds } };
    for (const row of staleFlags) {
      await tx.query('UPDATE brownlow_season_votes SET is_winner = $3 WHERE season = $1::int AND player_id = $2::int',
        [request.season, row.playerId, winners.includes(row.playerId)]);
    }
    await recomputeBrownlowCareerTotals(native, staleFlags.map((row) => row.playerId));
    await recordDataEdit(native, {
      tableName: 'brownlow_season_authority', rowId: request.season, fieldGroup: 'eligibility_publication',
      oldValues: { winners: previous },
      newValues: { winners, status: determination.status, inputChecksum: determination.inputChecksum,
        decisionIds: evidence.decisions.filter((d) => d.current).map((d) => d.id), basis: determination.basis,
        ranksWithheld: true, unresolvedPlayerIds },
      adminUserId: request.actorId, note: request.note,
      seal: { kind: 'row' },
    });
    return { determination, changed: true, publication: { state: 'partial', unresolvedPlayerIds } };
  }
  const metadata = determination.rawLeaderboard.map((row) => ({
    playerId: row.playerId,
    isIneligible: row.eligibility.status === 'ineligible',
    // Every rank is determinate here (no unknown vote-getter), so this is the exact eligible competition rank.
    eligibleRank: row.eligibleRank,
    isWinner: winners.includes(row.playerId),
  }));
  for (const row of stored) if (!metadata.some((r) => r.playerId === row.playerId)) {
    metadata.push({ playerId: row.playerId, isIneligible: row.isIneligible, eligibleRank: row.eligibleRank, isWinner: false });
  }
  const changed = stored.some((row) => {
    const next = metadata.find((r) => r.playerId === row.playerId);
    return next && (row.isWinner !== next.isWinner || row.isIneligible !== next.isIneligible || row.eligibleRank !== next.eligibleRank);
  });
  if (changed) {
    for (const row of metadata) await tx.query(`UPDATE brownlow_season_votes
      SET is_winner = $3, is_ineligible = $4, eligible_rank = $5::int
      WHERE season = $1::int AND player_id = $2::int
        AND (is_winner, is_ineligible, eligible_rank) IS DISTINCT FROM ($3::boolean, $4::boolean, $5::int)`,
    [request.season, row.playerId, row.isWinner, row.isIneligible, row.eligibleRank]);
    // A ruling can change the stored eligibility population. Until that metadata is projected,
    // the old non-NULL eligible ranks can legitimately disagree with the old stored flags and
    // refuse the winner. Recheck inside this same transaction after projecting the ruling;
    // otherwise the subsequent read determines a winner that we have just published as false.
    // Keep every rank/vote check: retry only an eligible-rank-only refusal and only where an
    // audited decision actually changed a stored ineligibility flag. Arbitrary bad ranks do not
    // gain a general bypass, and no intermediate state can commit.
    const decisionChangedEligibility = evidence.players.some((player) => player.decision !== null
      && stored.some((row) => row.playerId === player.playerId
        && row.isIneligible !== (player.decision?.verdict === 'ineligible')));
    const blockers = report.findings.filter((finding) => finding.severity === 'discrepancy'
      && !isEligibilityEvidenceFinding(finding));
    if (decisionChangedEligibility && determination.status === 'refused_unreconciled_evidence'
      && blockers.length > 0 && blockers.every((finding) => finding.code === 'stored_rank_inconsistent'
        && finding.detail.field === 'eligible_rank')) {
      const refreshed = await loadBrownlowReconciliationInput(tx, {
        season: request.season, registry: request.registry, generatedAt: new Date().toISOString(), storedOnlyFallback: true,
      });
      const refreshedEvidence = await loadEligibilityInTransaction(tx, {
        season: request.season, playerIds: stored.map((row) => row.playerId),
      });
      if (refreshedEvidence.seasonAdminPublished) refreshed.seasonState = 'complete';
      determination = determineBrownlowMedal({ report: reconcileBrownlowSeason(refreshed), ...refreshedEvidence });
      winners = determination.status === 'determined' ? determination.winners.map((winner) => winner.playerId) : [];
      for (const row of metadata) {
        row.isWinner = winners.includes(row.playerId);
        await tx.query(`UPDATE brownlow_season_votes SET is_winner = $3
          WHERE season = $1::int AND player_id = $2::int AND is_winner IS DISTINCT FROM $3::boolean`,
        [request.season, row.playerId, row.isWinner]);
      }
    }
    await recomputeBrownlowCareerTotals(native, stored.map((r) => r.playerId));
    await recordDataEdit(native, {
      tableName: 'brownlow_season_authority', rowId: request.season, fieldGroup: 'eligibility_publication',
      oldValues: { winners: previous, eligibility: stored.map((r) => ({ playerId: r.playerId, isIneligible: r.isIneligible, eligibleRank: r.eligibleRank })) },
      newValues: { winners, status: determination.status, inputChecksum: determination.inputChecksum,
        decisionIds: evidence.decisions.filter((d) => d.current).map((d) => d.id),
        basis: determination.basis, eligibility: metadata,
        // Where each player's eligibility came from, with the retained provider provenance.
        eligibilityEvidence: determination.rawLeaderboard.map((row) => ({
          playerId: row.playerId, status: row.eligibility.status, source: row.eligibility.source,
          provider: row.eligibility.detail.provider, providerProvenance: row.eligibility.detail.providerProvenance,
        })),
        votesTotal: stored.reduce((n, r) => n + r.votes, 0) },
      adminUserId: request.actorId, note: request.note,
      seal: { kind: 'row' },
    });
  }
  return { determination, changed, publication: { state: changed ? 'published' : 'unchanged', unresolvedPlayerIds: [] } };
}

/* ------------------------------------------------------------------ *
 * Recording a decision
 * ------------------------------------------------------------------ */

export const BROWNLOW_ELIGIBILITY_REFUSAL_CODES = [
  'capability_denied',
  'invalid_input',
  'citation_required',
  'note_invalid',
  'unknown_player',
  'identity_missing',
  'identity_ambiguous',
  'player_not_vote_getter',
  'stale_decision',
  'season_sealed',
  'correction_invalid',
] as const;
export type BrownlowEligibilityRefusalCode = (typeof BROWNLOW_ELIGIBILITY_REFUSAL_CODES)[number];

export interface BrownlowEligibilityRefusal {
  readonly code: BrownlowEligibilityRefusalCode;
  readonly message: string;
  readonly season: number | null;
}

export interface BrownlowEligibilityDecisionRequest {
  readonly season: number;
  /** players.id of the player the ruling is about; resolved to the durable identity inside the transaction. */
  readonly playerId: number;
  readonly verdict: BrownlowEligibilityVerdict;
  /** The URL or source reference the ruling rests on (trimmed 1..2000). */
  readonly citation: string;
  /** The administrator's reasoning (trimmed 20..2000). Also the seal correction note for a sealed season. */
  readonly note: string;
  /** The id of the decision the administrator SAW as current (null = none). A different current row is `stale_decision`. */
  readonly expectedCurrentDecisionId: number | null;
  /** auth_users.id of the deciding administrator: `decided_by`, and the correction's actor. */
  readonly decidedBy: number;
  readonly viewer: CapabilityViewer;
  /** The sealed range, built from the season registry by the caller. */
  readonly sealed: SealedSeasons;
  /** The authorised application caller publishes the decision's effect atomically. */
  readonly publicationRegistry?: SeasonRegistry;
  /**
   * With `publicationRegistry`: `withhold` (default) records the decision and leaves the stored rows untouched while
   * any vote-getter's eligibility is still unknown; `require` makes an unknown refuse the publication and roll the
   * decision back with it (the caller then receives a {@link BrownlowPublicationRefusedError}).
   */
  readonly publicationMode?: 'withhold' | 'require';
}

export type BrownlowEligibilityDecisionOutcome =
  | { readonly ok: false; readonly refusal: BrownlowEligibilityRefusal }
  | {
    readonly ok: true;
    readonly decision: BrownlowEligibilityDecisionView;
    /** The decision this one replaced, or null. */
    readonly supersededId: number | null;
    /** What the atomic publication did; absent when the caller asked for none. */
    readonly publication?: BrownlowPublicationSummary;
  };

function refuse(
  code: BrownlowEligibilityRefusalCode,
  message: string,
  season: number | null,
): { readonly ok: false; readonly refusal: BrownlowEligibilityRefusal } {
  return { ok: false, refusal: { code, message, season } };
}

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export type BrownlowEligibilityGate =
  | { readonly ok: false; readonly refusal: BrownlowEligibilityRefusal }
  | { readonly ok: true; readonly citation: string; readonly note: string };

/**
 * Every refusal that can be decided without SQL, in this order: capability, shape (season, player,
 * verdict, actor, expected id), citation, note. Pure and total.
 */
export function checkBrownlowEligibilityDecision(request: BrownlowEligibilityDecisionRequest): BrownlowEligibilityGate {
  const season = Number.isInteger(request.season) ? request.season : null;
  if (!hasCapability(request.viewer, BROWNLOW_ELIGIBILITY_CAPABILITY)) {
    return refuse('capability_denied', `Refused: recording a Brownlow eligibility decision needs the ${BROWNLOW_ELIGIBILITY_CAPABILITY} capability.`, season);
  }
  if (!Number.isInteger(request.season) || request.season < 1897 || request.season > 2100) {
    return refuse('invalid_input', 'Refused: the season must be a whole year from 1897 to 2100.', season);
  }
  if (!isPositiveInt(request.playerId)) {
    return refuse('invalid_input', 'Refused: the player must be identified by a positive player id.', season);
  }
  if (!(BROWNLOW_ELIGIBILITY_VERDICTS as readonly unknown[]).includes(request.verdict)) {
    return refuse('invalid_input', `Refused: the verdict must be one of ${BROWNLOW_ELIGIBILITY_VERDICTS.join(', ')}.`, season);
  }
  if (!isPositiveInt(request.decidedBy)) {
    return refuse('invalid_input', 'Refused: decidedBy must be a positive integer (auth_users.id).', season);
  }
  if (request.expectedCurrentDecisionId !== null && !isPositiveInt(request.expectedCurrentDecisionId)) {
    return refuse('invalid_input', 'Refused: expectedCurrentDecisionId must be null or a positive decision id.', season);
  }
  const citation = typeof request.citation === 'string' ? request.citation.trim() : '';
  if (citation.length < 1 || citation.length > BROWNLOW_CITATION_MAX_LENGTH) {
    return refuse(
      'citation_required',
      `Refused: a decision needs a citation (a URL or source reference) of 1 to ${BROWNLOW_CITATION_MAX_LENGTH} characters.`,
      season,
    );
  }
  const note = typeof request.note === 'string' ? request.note.trim() : '';
  if (note.length < BROWNLOW_DECISION_NOTE_MIN_LENGTH || note.length > BROWNLOW_DECISION_NOTE_MAX_LENGTH) {
    return refuse(
      'note_invalid',
      `Refused: a decision needs a note of ${BROWNLOW_DECISION_NOTE_MIN_LENGTH} to ${BROWNLOW_DECISION_NOTE_MAX_LENGTH} characters recording the reasoning.`,
      season,
    );
  }
  return { ok: true, citation, note };
}

async function currentDecisionId(tx: SqlExecutor, season: number, identity: string): Promise<number | null> {
  const rows = await tx.query<{ id: number | string }>(
    `SELECT d.id::int AS id
       FROM brownlow_eligibility_decisions d
      WHERE d.season = $1::int AND d.player_identity = $2
        AND NOT EXISTS (SELECT 1 FROM brownlow_eligibility_decisions s WHERE s.supersedes_id = d.id)`,
    [season, identity],
  );
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(`brownlow_eligibility_decisions holds ${rows.length} current rows for ${identity} in ${season}; the supersession chain is broken`);
  }
  return Number(rows[0].id);
}

/**
 * Record one eligibility decision, atomically. Resolves to a typed refusal (no row written) or to
 * the new decision; a SQL error rejects and rolls the transaction back. Needs the postgres.js
 * adapter (see the header).
 *
 * Refusals before any SQL: `capability_denied`, `invalid_input`, `citation_required`,
 * `note_invalid`. Inside the transaction, after the per-season advisory lock and before the INSERT:
 * `unknown_player`, `identity_missing`, `identity_ambiguous`, `player_not_vote_getter` (the player
 * has no stored total above zero and no staged API vote in the season), `stale_decision`, and the
 * season seal (`season_sealed`, `correction_invalid`). An OPEN season records basis `open_season`
 * with a NULL correction; a SEALED season is an audited correction (workflow
 * `brownlow_eligibility_decision`, actor = `decidedBy`, the note, evidence reference
 * `brownlow_eligibility:<season>:<identity>`) stored verbatim in `correction`.
 */
export async function recordBrownlowEligibilityDecision(
  executor: TransactionalSqlExecutor,
  request: BrownlowEligibilityDecisionRequest,
): Promise<BrownlowEligibilityDecisionOutcome> {
  const gate = checkBrownlowEligibilityDecision(request);
  if (!gate.ok) return gate;
  const { season, playerId, verdict, decidedBy, expectedCurrentDecisionId } = request;
  const { citation, note } = gate;

  return executor.transaction(async (tx): Promise<BrownlowEligibilityDecisionOutcome> => {
    const native = nativeTransactionOf(tx);
    if (native === undefined) throw new BrownlowEligibilityInfrastructureError();
    await tx.query('SELECT pg_advisory_xact_lock(717275, 3)');
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), $2::int)', [LOCK_NAMESPACE, season]);

    const player = await tx.query<{ id: number | string }>('SELECT p.id::int AS id FROM players p WHERE p.id = $1::int', [playerId]);
    if (player.length === 0) return refuse('unknown_player', `Refused: there is no player with id ${playerId}.`, season);

    const resolved = await resolvePlayerIdentity(native, playerId);
    if (!resolved.ok) return refuse('identity_ambiguous', `Refused: ${resolved.error}`, season);
    if (resolved.identity === null) {
      return refuse(
        'identity_missing',
        `Refused: player ${playerId} holds no durable identity (no AFL Tables profile and no manual identity), so a decision cannot be recorded against them.`,
        season,
      );
    }
    const identity = resolved.identity;

    const polled = await tx.query<{ polled: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM brownlow_season_votes b
                  WHERE b.season = $1::int AND b.player_id = $2::int AND b.votes > 0)
         OR EXISTS (SELECT 1 FROM staging.afl_api_brownlow_vote v
                      JOIN sources s ON s.id = v.source_id
                     WHERE s.key = $3 AND v.family = 'brownlow_match_votes'
                       AND v.season = $1::int AND v.player_id = $2::int)
       ) AS polled`,
      [season, playerId, BROWNLOW_VOTE_SOURCE_KEY],
    );
    if (polled[0]?.polled !== true) {
      return refuse(
        'player_not_vote_getter',
        `Refused: player ${playerId} polled no Brownlow votes in ${season} (no stored total and no staged API vote), so there is nothing to rule on.`,
        season,
      );
    }

    const current = await currentDecisionId(tx, season, identity);
    if (current !== expectedCurrentDecisionId) {
      return refuse(
        'stale_decision',
        `Refused: the current decision for this player changed since you loaded the page (you saw ${expectedCurrentDecisionId === null ? 'none' : `#${expectedCurrentDecisionId}`}, it is now ${current === null ? 'none' : `#${current}`}). Reload and review it first.`,
        season,
      );
    }

    // The season seal. Always offered the correction: an open season ignores it (basis open_season).
    const correction: AuditedCorrection = {
      workflow: BROWNLOW_ELIGIBILITY_WORKFLOW,
      actorUserId: decidedBy,
      note,
      evidenceRef: `brownlow_eligibility:${season}:${identity}`,
    };
    const seal = evaluateSeasonWrite({ season, sealed: request.sealed, correction });
    if (!seal.allowed) return refuse(seal.code, seal.message, season);

    const inserted = await tx.query<DecisionRow>(
      `INSERT INTO brownlow_eligibility_decisions
         (season, player_identity, player_id_at_decision, verdict, citation, note,
          decided_by, basis, correction, supersedes_id)
       VALUES ($1::int, $2, $3::int, $4, $5, $6, $7::int, $8, $9::text::jsonb, $10::bigint)
       RETURNING id::int AS id, season::int AS season, player_identity AS "playerIdentity",
                 player_id_at_decision::int AS "playerIdAtDecision", verdict, citation, note,
                 decided_by::int AS "decidedBy",
                 to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "decidedAt",
                 basis, correction, supersedes_id::int AS "supersedesId", true AS current`,
      [
        season,
        identity,
        playerId,
        verdict,
        citation,
        note,
        decidedBy,
        seal.basis,
        seal.basis === 'audited_correction' ? JSON.stringify(seal.audit) : null,
        current,
      ],
    );
    const publication = request.publicationRegistry
      ? (await publishBrownlowEligibilityInTransaction(tx, {
        season, registry: request.publicationRegistry, actorId: decidedBy, note,
        onUnresolved: request.publicationMode === 'require' ? 'refuse' : 'withhold',
      })).publication
      : undefined;
    return { ok: true, decision: decisionViewOf(inserted[0]), supersededId: current, ...(publication ? { publication } : {}) };
  });
}
